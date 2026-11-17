import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Modal,
  ScrollView,
  Platform,
  Alert,
  StatusBar,
} from 'react-native';
import {
  subscribeSentNudges,
  subscribeReceivedNudges,
  setNudgeEnabled,
  deleteNudge,
  hideReceivedNudge,
  isNudgeActive,
  getNudgeStateSummary,
  NUDGE_DISABLE_MODE,
  NUDGE_REPEAT_MODE,
} from '../db/nudges';
import { removeDeletedNudgeFromGeofenceCache } from '../location/backgroundGeofence';
import { removeNudgeFromOutbox } from '../location/triggerOutbox';
import { cancelNudgeAlarm } from '../notifications/localNotifications';
import SwipeableNudgeCard from './SwipeableNudgeCard';
import AmbientBackground from './AmbientBackground';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDaysTag(days) {
  if (!Array.isArray(days) || days.length === 0 || days.length === 7) return null;
  const sorted = [...days].sort();
  if (sorted.join(',') === '1,2,3,4,5') return 'Weekdays';
  if (sorted.join(',') === '0,6') return 'Weekends';
  return sorted.map((d) => SHORT_DAYS[d]).filter(Boolean).join(', ');
}

function formatRepeatTag(nudge) {
  const mode = nudge?.repeatMode || NUDGE_REPEAT_MODE.ONCE;
  if (mode === NUDGE_REPEAT_MODE.ONCE_PER_DAY) return '1× / day';
  if (mode === NUDGE_REPEAT_MODE.MULTIPLE_PER_DAY) {
    return `Multi · ${nudge?.cooldownMinutes || 30}m`;
  }
  return 'Once';
}

export default function NudgeListScreen({ uid, onOpenNudge, onBack }) {
  const [sent, setSent] = useState([]);
  const [received, setReceived] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  // Turn-off Modal State
  const [selectedNudgeForDisable, setSelectedNudgeForDisable] = useState(null);
  const [disableModalVisible, setDisableModalVisible] = useState(false);

  useEffect(() => {
    const unsubSent = subscribeSentNudges(uid, (list) => {
      setSent(list);
      setLoading(false);
    });
    const unsubRecv = subscribeReceivedNudges(uid, (list) => {
      setReceived(list);
      setLoading(false);
    });
    return () => {
      unsubSent();
      unsubRecv();
    };
  }, [uid]);

  const visibleReceived = received.filter(
    (n) => !n.recipientHidden && n.disableMode !== 'recipient_hidden'
  );

  const handleToggle = async (nudge, newValue) => {
    if (!newValue) {
      setSelectedNudgeForDisable(nudge);
      setDisableModalVisible(true);
    } else {
      try {
        await setNudgeEnabled(nudge.id, true);
      } catch (e) {
        console.error('[NUDGE_TOGGLE_ERROR]', e);
        Alert.alert('Could not update Nudgr', e.message || 'Please try again.');
      }
    }
  };

  const handleConfirmDisable = async (mode) => {
    if (!selectedNudgeForDisable) return;
    const nudgeId = selectedNudgeForDisable.id;
    setDisableModalVisible(false);
    setSelectedNudgeForDisable(null);
    try {
      await setNudgeEnabled(nudgeId, false, mode);
    } catch (e) {
      console.error('[NUDGE_DISABLE_ERROR]', e);
      Alert.alert('Could not update Nudgr', e.message || 'Please try again.');
    }
  };

  const handleCancelDisable = () => {
    setDisableModalVisible(false);
    setSelectedNudgeForDisable(null);
  };

  const handleSwipeSentDelete = (nudge) => {
    const hasVoice = Boolean(nudge?.voiceNote?.storageKey);
    Alert.alert(
      'Delete this Nudgr?',
      hasVoice
        ? 'This permanently deletes this location alarm and removes its recorded voice note from Cloudflare R2.'
        : 'This permanently deletes this location alarm and its delivery history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(nudge.id);
            try {
              await deleteNudge(nudge.id);
              await Promise.all([
                removeDeletedNudgeFromGeofenceCache(nudge.id),
                removeNudgeFromOutbox(nudge.id),
                cancelNudgeAlarm(nudge.id),
              ]);
            } catch (e) {
              Alert.alert('Could not delete Nudgr', e.message || 'Please try again.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const handleSwipeReceivedHide = async (nudge) => {
    try {
      await hideReceivedNudge(nudge.id);
    } catch (e) {
      Alert.alert('Could not hide Nudgr', e.message || 'Please try again.');
    }
  };

  const renderNudge = (n, isReceived) => {
    const isActive = isNudgeActive(n);
    const summary = getNudgeStateSummary(n);
    const personName = isReceived ? (n.senderName || 'Someone') : (n.recipientName || 'Someone');
    const personInitial = personName[0].toUpperCase();
    const daysText = formatDaysTag(n.schedule?.daysOfWeek);
    const repeatText = formatRepeatTag(n);
    const isDeleting = deletingId === n.id;

    return (
      <SwipeableNudgeCard
        key={n.id}
        isReceived={isReceived}
        disabled={isDeleting}
        onSwipeRightAction={() =>
          isReceived ? handleSwipeReceivedHide(n) : handleSwipeSentDelete(n)
        }
      >
        <TouchableOpacity
          style={[styles.tileCard, !isActive && styles.tileCardDisabled]}
          onPress={() => onOpenNudge(n.id, isReceived)}
          disabled={isDeleting}
          activeOpacity={0.85}
        >
          {/* ── Tile Top Row ── */}
          <View style={styles.tileHeader}>
            <View style={styles.personRow}>
              <View
                style={[
                  styles.avatarCircle,
                  { backgroundColor: isReceived ? '#ECFDF5' : '#EEF2FF' },
                  { borderColor: isReceived ? 'rgba(167, 243, 208, 0.85)' : '#C7D2FE' },
                ]}
              >
                <Text
                  style={[
                    styles.avatarInitial,
                    { color: isReceived ? '#059669' : '#6366F1' },
                  ]}
                >
                  {personInitial}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.personDirection}>
                  {isReceived ? 'FROM' : 'TO'}
                </Text>
                <Text style={[styles.personName, !isActive && styles.textMuted]} numberOfLines={1}>
                  {personName}
                </Text>
                {n.title ? (
                  <Text style={styles.alarmTitleText} numberOfLines={1}>
                    {n.title}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Toggle Switch */}
            <View style={styles.switchWrapper}>
              {isDeleting ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <>
                  <Text
                    style={[
                      styles.switchLabel,
                      isActive ? styles.switchLabelOn : styles.switchLabelOff,
                    ]}
                  >
                    {isActive ? 'ON' : 'OFF'}
                  </Text>
                  <Switch
                    value={isActive}
                    onValueChange={(val) => handleToggle(n, val)}
                    trackColor={{ false: '#E2E8F0', true: '#C7D2FE' }}
                    thumbColor={isActive ? '#6366F1' : '#94A3B8'}
                    ios_backgroundColor="#E2E8F0"
                    style={styles.switchStyle}
                  />
                </>
              )}
            </View>
          </View>

          {/* ── Message Preview ── */}
          <View style={styles.messageBox}>
            <Text style={[styles.messageText, !isActive && styles.textMuted]} numberOfLines={2}>
              "{n.message}"
            </Text>
          </View>

          {/* ── Footer Tags ── */}
          <View style={styles.tileFooter}>
            <View style={styles.tagRow}>
              {n.triggerLabel && (
                <View style={styles.tag}>
                  <Text style={styles.tagText} numberOfLines={1}>
                    📍 {n.triggerLabel} ({n.radiusKm?.toFixed(1)} km)
                  </Text>
                </View>
              )}
              {!n.triggerLabel && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{n.radiusKm?.toFixed(1)} km</Text>
                </View>
              )}

              <View style={[styles.tag, styles.tagPurple]}>
                <Text style={[styles.tagText, { color: '#6366F1' }]}>{repeatText}</Text>
              </View>

              {daysText && (
                <View style={[styles.tag, styles.tagPurple]}>
                  <Text style={[styles.tagText, { color: '#6366F1' }]}>{daysText}</Text>
                </View>
              )}

              {n.schedule?.afterTimeText && (
                <View style={[styles.tag, styles.tagPurple]}>
                  <Text style={[styles.tagText, { color: '#6366F1' }]}>
                    {n.schedule.endHour != null
                      ? n.schedule.afterTimeText
                      : `After ${n.schedule.afterTimeText}`}
                  </Text>
                </View>
              )}

              {n.voiceNote?.storageKey ? (
                <View style={[styles.tag, styles.tagTeal]}>
                  <Text style={[styles.tagText, { color: '#059669' }]}>🎙️ Voice</Text>
                </View>
              ) : (
                n.voiceStyle &&
                n.voiceStyle !== 'none' && (
                  <View style={[styles.tag, styles.tagTeal]}>
                    <Text style={[styles.tagText, { color: '#059669' }]}>{n.voiceStyle}</Text>
                  </View>
                )
              )}
            </View>

            {summary.secondaryText && (
              <View
                style={[
                  styles.statusPill,
                  isActive ? styles.statusPillActive : styles.statusPillPaused,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    isActive ? styles.statusTextActive : styles.statusTextPaused,
                  ]}
                >
                  {summary.secondaryText}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </SwipeableNudgeCard>
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" />
      <AmbientBackground />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>My Nudgrs</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topSection}>
          <Text style={styles.pageTitle}>My Nudgrs</Text>
          <Text style={styles.pageSubtitle}>
            Slide a Nudgr left-to-right to delete (sent) or hide (received). Toggle anytime to pause.
          </Text>
        </View>

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#6366F1" />
            <Text style={styles.loadingText}>Loading nudgrs…</Text>
          </View>
        )}

        {/* ── Received Section ── */}
        {visibleReceived.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <View style={[styles.sectionDot, { backgroundColor: '#10B981' }]} />
              <Text style={styles.sectionHeader}>
                RECEIVED ({visibleReceived.length})
              </Text>
            </View>
            {visibleReceived.map((n) => renderNudge(n, true))}
          </View>
        )}

        {/* ── Sent Section ── */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <View style={[styles.sectionDot, { backgroundColor: '#6366F1' }]} />
            <Text style={styles.sectionHeader}>
              SENT ({sent.length})
            </Text>
          </View>
          {sent.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconBox}>
                <Text style={styles.emptyIconGlyph}>✉</Text>
              </View>
              <Text style={styles.emptyTitle}>No Nudgrs sent yet</Text>
              <Text style={styles.emptySubtext}>
                Create a Nudgr from the home screen to schedule a location arrival alarm.
              </Text>
            </View>
          ) : (
            sent.map((n) => renderNudge(n, false))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Pause Modal ── */}
      <Modal
        visible={disableModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelDisable}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconBox}>
              <Text style={styles.modalIconGlyph}>⏸</Text>
            </View>
            <Text style={styles.modalTitle}>Pause this Nudgr?</Text>
            <Text style={styles.modalSubtitle}>
              Choose when this arrival alert should automatically resume:
            </Text>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => handleConfirmDisable(NUDGE_DISABLE_MODE.TODAY)}
              activeOpacity={0.8}
            >
              <View style={[styles.modalOptionIcon, { backgroundColor: '#FFFBEB' }]}>
                <Text style={styles.modalOptionIconGlyph}>◑</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalOptionTitle}>Today only</Text>
                <Text style={styles.modalOptionDesc}>
                  Resumes automatically tomorrow morning.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => handleConfirmDisable(NUDGE_DISABLE_MODE.MANUAL)}
              activeOpacity={0.8}
            >
              <View style={[styles.modalOptionIcon, { backgroundColor: '#FEF2F2' }]}>
                <Text style={styles.modalOptionIconGlyph}>◻</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalOptionTitle}>Until turned back on</Text>
                <Text style={styles.modalOptionDesc}>
                  Stays paused until you toggle the switch ON.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={handleCancelDisable}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F7FC',
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 20,
    marginBottom: 4,
  },
  headerTitleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 25,
  },
  backArrow: {
    fontSize: 26,
    color: '#0F172A',
    fontWeight: '300',
    lineHeight: 28,
  },
  container: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
  },
  topSection: {
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 20,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    paddingVertical: 28,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
  },
  section: {
    marginBottom: 20,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionDot: {
    width: 4,
    height: 14,
    borderRadius: 2,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.1,
  },
  tileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    padding: 18,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  tileCardDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    opacity: 0.82,
    shadowOpacity: 0,
    elevation: 0,
  },
  tileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatarInitial: {
    fontSize: 17,
    fontWeight: '800',
  },
  personDirection: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  alarmTitleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6366F1',
    marginTop: 1,
  },
  textMuted: {
    color: '#94A3B8',
  },
  switchWrapper: {
    alignItems: 'center',
    paddingLeft: 8,
  },
  switchLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  switchLabelOn: {
    color: '#6366F1',
  },
  switchLabelOff: {
    color: '#94A3B8',
  },
  switchStyle: {
    transform: Platform.OS === 'ios' ? [{ scaleX: 0.85 }, { scaleY: 0.85 }] : [{ scaleX: 1.05 }, { scaleY: 1.05 }],
  },
  messageBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 13,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  messageText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#0F172A',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    flex: 1,
  },
  tag: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tagPurple: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  tagTeal: {
    backgroundColor: '#ECFDF5',
    borderColor: 'rgba(167, 243, 208, 0.8)',
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusPillActive: {
    backgroundColor: '#ECFDF5',
    borderColor: 'rgba(167, 243, 208, 0.8)',
  },
  statusPillPaused: {
    backgroundColor: '#FFFBEB',
    borderColor: 'rgba(253, 230, 138, 0.8)',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextActive: {
    color: '#059669',
  },
  statusTextPaused: {
    color: '#D97706',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    padding: 28,
    alignItems: 'center',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyIconGlyph: {
    fontSize: 24,
    color: '#6366F1',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    padding: 24,
    width: '100%',
    maxWidth: 360,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 28,
    elevation: 10,
  },
  modalIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    alignSelf: 'center',
  },
  modalIconGlyph: {
    fontSize: 20,
    color: '#6366F1',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  modalOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOptionIconGlyph: {
    fontSize: 16,
    color: '#0F172A',
  },
  modalOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  modalOptionDesc: {
    fontSize: 12,
    color: '#64748B',
  },
  modalCancel: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
});
