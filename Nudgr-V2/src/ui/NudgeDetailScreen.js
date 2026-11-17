import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  Modal,
  ScrollView,
  StatusBar,
} from 'react-native';
import {
  getNudge,
  markCompleted,
  deleteNudge,
  hideReceivedNudge,
  setNudgeEnabled,
  isNudgeActive,
  getNudgeStateSummary,
  NUDGE_STATUS,
  NUDGE_DISABLE_MODE,
  NUDGE_REPEAT_MODE,
} from '../db/nudges';
import { removeDeletedNudgeFromGeofenceCache } from '../location/backgroundGeofence';
import { removeNudgeFromOutbox } from '../location/triggerOutbox';
import { cancelNudgeAlarm } from '../notifications/localNotifications';
import { playNudgeMessage, stopNudgeMessage } from '../voice/playback';
import { VOICE_STYLES } from '../voice/tts';
import WaveformBars from './WaveformBars';
import AmbientBackground from './AmbientBackground';
import DeliveryHistory from './DeliveryHistory';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeRepeat(nudge) {
  const mode = nudge?.repeatMode || NUDGE_REPEAT_MODE.ONCE;
  if (mode === NUDGE_REPEAT_MODE.ONCE_PER_DAY) {
    return 'Rings once a day (re-arms automatically tomorrow)';
  }
  if (mode === NUDGE_REPEAT_MODE.MULTIPLE_PER_DAY) {
    const mins = nudge?.cooldownMinutes || 30;
    const exitNote = nudge?.requireExitBeforeRetrigger !== false ? ' after leaving area' : '';
    return `Multiple times a day (${mins} min cooldown${exitNote})`;
  }
  return 'One-time alarm (turns off after ringing)';
}

function describeSchedule(schedule) {
  if (!schedule) return 'Every day · Any time on arrival';
  const parts = [];
  if (Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0 && schedule.daysOfWeek.length < 7) {
    const sorted = [...schedule.daysOfWeek].sort();
    if (sorted.join(',') === '1,2,3,4,5') parts.push('Weekdays');
    else if (sorted.join(',') === '0,6') parts.push('Weekends');
    else parts.push(sorted.map((d) => DAY_NAMES[d]).join(', '));
  } else {
    parts.push('Every day');
  }

  if (schedule.afterTimeText) {
    parts.push(schedule.endHour != null ? schedule.afterTimeText : `After ${schedule.afterTimeText}`);
  } else if (typeof schedule.afterHour === 'number') {
    parts.push(`After ${schedule.afterHour}:00`);
  } else if (schedule.activeAfter) {
    parts.push(`Starts ${new Date(schedule.activeAfter).toLocaleDateString()}`);
  } else {
    parts.push('Any time');
  }

  return parts.join(' · ');
}

export default function NudgeDetailScreen({
  nudgeId,
  isReceived,
  autoPlay = false,
  onEdit,
  onBack,
}) {
  const [nudge, setNudge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const autoPlayedRef = useRef(false);

  // Turn-off Modal State
  const [disableModalVisible, setDisableModalVisible] = useState(false);

  useEffect(() => {
    let active = true;
    getNudge(nudgeId)
      .then((n) => {
        if (active) {
          setNudge(n);
          if (autoPlay && !autoPlayedRef.current && n) {
            autoPlayedRef.current = true;
            handlePlay(n);
          }
        }
      })
      .catch(() => {
        if (active) setNudge(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      stopNudgeMessage();
    };
  }, [nudgeId, autoPlay]);

  const handlePlay = (nudgeData = nudge) => {
    if (!nudgeData) return;
    setIsPlaying(true);
    playNudgeMessage({
      nudge: nudgeData,
      onStart: () => setIsPlaying(true),
      onDone: () => setIsPlaying(false),
      onError: () => setIsPlaying(false),
    });
  };

  const handleStop = async () => {
    await stopNudgeMessage();
    setIsPlaying(false);
  };

  const handleToggle = async (newValue) => {
    if (!nudge) return;
    if (!newValue) {
      setDisableModalVisible(true);
    } else {
      try {
        await setNudgeEnabled(nudge.id, true);
        setNudge((prev) =>
          prev
            ? {
                ...prev,
                enabled: true,
                status: NUDGE_STATUS.ACTIVE,
                disableMode: null,
                recipientHidden: false,
              }
            : null
        );
      } catch (e) {
        console.error('[NUDGE_DETAIL_TOGGLE_ERROR]', e);
        Alert.alert('Could not update Nudgr', e.message || 'Please try again.');
      }
    }
  };

  const handleConfirmDisable = async (mode) => {
    if (!nudge) return;
    setDisableModalVisible(false);
    try {
      await setNudgeEnabled(nudge.id, false, mode);
      setNudge((prev) => (prev ? { ...prev, enabled: false, disableMode: mode } : null));
    } catch (e) {
      console.error('[NUDGE_DETAIL_DISABLE_ERROR]', e);
      Alert.alert('Could not update Nudgr', e.message || 'Please try again.');
    }
  };

  const handleCancelDisable = () => {
    setDisableModalVisible(false);
  };

  const handleDeleteNudge = () => {
    if (!nudge) return;
    const hasVoice = Boolean(nudge.voiceNote?.storageKey);
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
            setDeleting(true);
            try {
              await stopNudgeMessage();
              await deleteNudge(nudge.id);
              await Promise.all([
                removeDeletedNudgeFromGeofenceCache(nudge.id),
                removeNudgeFromOutbox(nudge.id),
                cancelNudgeAlarm(nudge.id),
              ]);
              onBack();
            } catch (e) {
              setDeleting(false);
              Alert.alert('Could not delete Nudgr', e.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" />
        <AmbientBackground />
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading Nudgr details…</Text>
      </View>
    );
  }

  if (!nudge) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" />
        <AmbientBackground />
        <View style={styles.missingIconBox}>
          <Text style={styles.missingIconGlyph}>✕</Text>
        </View>
        <Text style={styles.missingText}>Nudgr not found or deleted.</Text>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.8}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isActive = isNudgeActive(nudge);
  const summary = getNudgeStateSummary(nudge);
  const hasVoice =
    (nudge.voiceStyle && nudge.voiceStyle !== 'none') ||
    (nudge.voiceNote && nudge.voiceNote.storageKey);
  const voiceStyleName = nudge.voiceNote?.storageKey
    ? `Recorded Voice Note (${Math.round((nudge.voiceNote.durationMs || 5000) / 1000)}s)`
    : VOICE_STYLES[nudge.voiceStyle]?.label || nudge.voiceStyle || 'Normal';
  const isOneShot = (nudge.repeatMode || NUDGE_REPEAT_MODE.ONCE) === NUDGE_REPEAT_MODE.ONCE;

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
          <Text style={styles.headerTitle}>Nudgr Details</Text>
        </View>
        {!isReceived && onEdit ? (
          <TouchableOpacity
            onPress={() => onEdit(nudge)}
            style={styles.editHeaderBtn}
            activeOpacity={0.75}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.editHeaderText}>Edit</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Status Card ── */}
        <View style={[styles.statusCard, !isActive && styles.statusCardMuted]}>
          <View style={{ flex: 1 }}>
            <View style={styles.statusTopRow}>
              <View
                style={[
                  styles.statusIndicator,
                  isActive ? styles.statusIndicatorActive : styles.statusIndicatorMuted,
                ]}
              />
              <Text style={styles.statusTitle}>
                {isActive ? 'ACTIVE ALARM' : 'PAUSED / OFF'}
              </Text>
            </View>
            <Text style={styles.statusDescription}>
              {summary.statusText}
              {summary.secondaryText ? ` · ${summary.secondaryText}` : ''}
            </Text>
          </View>

          {/* Toggle Switch */}
          <View style={styles.toggleWrapper}>
            <Text
              style={[
                styles.toggleLabel,
                isActive ? styles.toggleLabelOn : styles.toggleLabelOff,
              ]}
            >
              {isActive ? 'ON' : 'OFF'}
            </Text>
            <Switch
              value={isActive}
              onValueChange={handleToggle}
              trackColor={{ false: '#E2E8F0', true: '#C7D2FE' }}
              thumbColor={isActive ? '#6366F1' : '#94A3B8'}
              ios_backgroundColor="#E2E8F0"
            />
          </View>
        </View>

        {/* ── Details Card ── */}
        <View style={styles.detailsCard}>
          {nudge.title ? (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>ALARM LABEL</Text>
                <Text style={styles.fieldValue}>{nudge.title}</Text>
              </View>
              <View style={styles.fieldDivider} />
            </>
          ) : null}

          {/* From / To */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{isReceived ? 'FROM' : 'TO'}</Text>
            <View style={styles.personRowDetail}>
              <View
                style={[
                  styles.personAvatarDetail,
                  { backgroundColor: isReceived ? '#ECFDF5' : '#EEF2FF' },
                  { borderColor: isReceived ? 'rgba(167, 243, 208, 0.85)' : '#C7D2FE' },
                ]}
              >
                <Text
                  style={[
                    styles.personAvatarInitial,
                    { color: isReceived ? '#059669' : '#6366F1' },
                  ]}
                >
                  {(isReceived ? nudge.senderName || 'U' : nudge.recipientName || 'U')[0].toUpperCase()}
                </Text>
              </View>
              <Text style={styles.fieldValue}>
                {isReceived ? nudge.senderName || 'Unknown' : nudge.recipientName || 'Unknown'}
              </Text>
            </View>
          </View>

          <View style={styles.fieldDivider} />

          {/* Message */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>MESSAGE</Text>
            <View style={styles.messageBox}>
              <Text style={styles.messageText}>"{nudge.message}"</Text>
            </View>
          </View>

          <View style={styles.fieldDivider} />

          {/* Location */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TRIGGER LOCATION & GEOFENCE</Text>
            <Text style={styles.fieldValue}>
              {nudge.triggerLabel || 'Arrival Location'}
            </Text>
            <Text style={styles.fieldSubValue}>
              {nudge.triggerLatitude?.toFixed(4)}, {nudge.triggerLongitude?.toFixed(4)} ·{' '}
              {nudge.radiusKm?.toFixed(1)} km radius
            </Text>
          </View>

          <View style={styles.fieldDivider} />

          {/* Repeat Frequency */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>REPEAT PREFERENCE</Text>
            <Text style={styles.fieldValue}>{describeRepeat(nudge)}</Text>
          </View>

          <View style={styles.fieldDivider} />

          {/* Schedule & Days */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>ACTIVE DAYS & TIME</Text>
            <Text style={styles.fieldValue}>{describeSchedule(nudge.schedule)}</Text>
          </View>

          <View style={styles.fieldDivider} />

          {/* Status */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>STATUS</Text>
            <View
              style={[
                styles.statusBadge,
                isActive ? styles.statusBadgeActive : styles.statusBadgePaused,
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  isActive ? styles.statusBadgeTextActive : styles.statusBadgeTextPaused,
                ]}
              >
                {summary.statusText}
                {summary.secondaryText ? ` · ${summary.secondaryText}` : ''}
              </Text>
            </View>
          </View>

          {/* Voice Audio */}
          {hasVoice && (
            <>
              <View style={styles.fieldDivider} />
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>VOICE AUDIO</Text>
                <Text style={styles.fieldValue}>{voiceStyleName}</Text>
                {isPlaying && (
                  <WaveformBars
                    active={true}
                    barCount={20}
                    color="#059669"
                    maxHeight={22}
                    style={{ marginTop: 10 }}
                  />
                )}
                <TouchableOpacity
                  style={styles.voicePlayerBtn}
                  onPress={isPlaying ? handleStop : () => handlePlay(nudge)}
                  activeOpacity={0.8}
                >
                  <View style={styles.voicePlayerIconBox}>
                    <Text style={styles.voicePlayerIconGlyph}>
                      {isPlaying ? '■' : '▶'}
                    </Text>
                  </View>
                  <Text style={styles.voicePlayerText}>
                    {isPlaying ? 'Stop Audio' : 'Play Voice Message'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        <DeliveryHistory nudgeId={nudgeId} />

        {/* ── Action Buttons ── */}
        {isReceived && isOneShot && nudge.status !== NUDGE_STATUS.COMPLETED && (
          <TouchableOpacity
            style={styles.completeButton}
            onPress={async () => {
              try {
                await stopNudgeMessage();
                await markCompleted(nudge.id);
                onBack();
              } catch (e) {
                Alert.alert('Could not update', 'Please try again.');
              }
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.completeButtonText}>Mark as Completed</Text>
          </TouchableOpacity>
        )}

        {isReceived && (
          <TouchableOpacity
            style={styles.hideButton}
            onPress={async () => {
              try {
                await stopNudgeMessage();
                await hideReceivedNudge(nudge.id);
                onBack();
              } catch (e) {
                Alert.alert('Could not hide Nudgr', 'Please try again.');
              }
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.hideButtonText}>
              Hide from My List (Shows again if Sender turns ON)
            </Text>
          </TouchableOpacity>
        )}

        {!isReceived && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleDeleteNudge}
            disabled={deleting}
            activeOpacity={0.85}
          >
            {deleting ? (
              <ActivityIndicator color="#DC2626" size="small" />
            ) : (
              <Text style={styles.cancelButtonText}>
                Delete Nudgr {nudge.voiceNote?.storageKey ? '& R2 Voice Note' : ''}
              </Text>
            )}
          </TouchableOpacity>
        )}

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
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 8,
  },
  missingIconBox: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  missingIconGlyph: {
    fontSize: 26,
    color: '#94A3B8',
    fontWeight: '700',
  },
  missingText: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
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
  editHeaderBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  editHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6366F1',
  },
  container: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 26,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  statusCardMuted: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    shadowOpacity: 0,
    elevation: 0,
  },
  statusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusIndicatorActive: {
    backgroundColor: '#10B981',
  },
  statusIndicatorMuted: {
    backgroundColor: '#94A3B8',
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  statusDescription: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    paddingLeft: 16,
  },
  toggleWrapper: {
    alignItems: 'center',
    marginLeft: 12,
  },
  toggleLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  toggleLabelOn: {
    color: '#6366F1',
  },
  toggleLabelOff: {
    color: '#94A3B8',
  },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    padding: 22,
    marginBottom: 16,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  fieldGroup: {
    paddingVertical: 3,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  fieldValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  fieldSubValue: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 3,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 14,
  },
  personRowDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personAvatarDetail: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  personAvatarInitial: {
    fontSize: 16,
    fontWeight: '800',
  },
  messageBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  messageText: {
    fontSize: 15,
    color: '#0F172A',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusBadgeActive: {
    backgroundColor: '#ECFDF5',
    borderColor: 'rgba(167, 243, 208, 0.85)',
  },
  statusBadgePaused: {
    backgroundColor: '#FEF2F2',
    borderColor: 'rgba(254, 202, 202, 0.8)',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadgeTextActive: {
    color: '#059669',
  },
  statusBadgeTextPaused: {
    color: '#DC2626',
  },
  voicePlayerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.85)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  voicePlayerIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voicePlayerIconGlyph: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '900',
  },
  voicePlayerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#059669',
  },
  completeButton: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.9)',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  completeButtonText: {
    color: '#059669',
    fontSize: 15,
    fontWeight: '700',
  },
  hideButton: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: 'rgba(253, 230, 138, 0.9)',
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  hideButtonText: {
    color: '#B45309',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelButton: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.9)',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  cancelButtonText: {
    color: '#DC2626',
    fontSize: 16,
    fontWeight: '700',
  },
  backButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 13,
  },
  backButtonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 28,
    elevation: 10,
  },
  modalIconBox: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalIconGlyph: {
    fontSize: 22,
    color: '#6366F1',
    fontWeight: '700',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  modalOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOptionIconGlyph: {
    fontSize: 18,
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
