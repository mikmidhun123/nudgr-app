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
  isNudgeActive,
  getNudgeStateSummary,
  NUDGE_DISABLE_MODE,
} from '../db/nudges';
import { THEME } from './theme';

export default function NudgeListScreen({ uid, onOpenNudge, onBack }) {
  const [sent, setSent] = useState([]);
  const [received, setReceived] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const handleToggle = async (nudge, newValue) => {
    if (!newValue) {
      // User is turning OFF an active Nudgr -> Show choice dialog
      setSelectedNudgeForDisable(nudge);
      setDisableModalVisible(true);
    } else {
      // User is turning ON a disabled Nudgr -> Turn ON immediately
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

  const renderNudge = (n, isReceived) => {
    const isActive = isNudgeActive(n);
    const summary = getNudgeStateSummary(n);
    const personName = isReceived ? (n.senderName || 'Someone') : (n.recipientName || 'Someone');

    return (
      <TouchableOpacity
        key={n.id}
        style={[styles.tileCard, !isActive && styles.tileCardDisabled]}
        onPress={() => onOpenNudge(n.id, isReceived)}
        activeOpacity={0.85}
      >
        {/* Visual Hierarchy 1: Sender / Recipient & Switch */}
        <View style={styles.tileHeader}>
          <View style={styles.personRow}>
            <View style={[styles.avatarDot, { backgroundColor: isReceived ? 'rgba(90, 200, 250, 0.25)' : 'rgba(139, 124, 255, 0.25)' }]}>
              <Text style={styles.avatarDotText}>
                {personName[0].toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={styles.personDirection}>
                {isReceived ? 'RECEIVED FROM' : 'SENT TO'}
              </Text>
              <Text style={[styles.personName, !isActive && styles.textDisabled]}>
                {personName}
              </Text>
            </View>
          </View>

          {/* Switch Control */}
          <View style={styles.switchWrapper}>
            <Text style={[styles.switchLabel, isActive ? styles.switchOn : styles.switchOff]}>
              {isActive ? 'ON' : 'OFF'}
            </Text>
            <Switch
              value={isActive}
              onValueChange={(val) => handleToggle(n, val)}
              trackColor={{ false: 'rgba(255,255,255,0.15)', true: 'rgba(139, 124, 255, 0.45)' }}
              thumbColor={isActive ? THEME.colors.accentPrimary : '#94a3b8'}
              ios_backgroundColor="rgba(255,255,255,0.15)"
              style={styles.switchStyle}
            />
          </View>
        </View>

        {/* Visual Hierarchy 2: Message preview */}
        <View style={styles.messageBox}>
          <Text style={[styles.messageText, !isActive && styles.textDisabled]} numberOfLines={2}>
            "{n.message}"
          </Text>
        </View>

        {/* Visual Hierarchy 3 & 4: Location, Schedule & Status Badges */}
        <View style={styles.tileFooter}>
          <View style={styles.tagRow}>
            <View style={styles.locationTag}>
              <Text style={styles.locationTagText}>
                📍 {n.radiusKm?.toFixed(1)} km
              </Text>
            </View>

            {n.schedule?.afterTimeText && (
              <View style={styles.scheduleTag}>
                <Text style={styles.scheduleTagText}>
                  ⏰ After {n.schedule.afterTimeText}
                </Text>
              </View>
            )}

            {n.voiceStyle && n.voiceStyle !== 'none' && (
              <View style={styles.voiceTag}>
                <Text style={styles.voiceTagText}>🎙️ {n.voiceStyle}</Text>
              </View>
            )}
          </View>

          {summary.secondaryText && (
            <View style={[styles.statusBadge, isActive ? styles.badgeActive : styles.badgePaused]}>
              <Text style={[styles.statusBadgeText, isActive ? styles.badgeTextActive : styles.badgeTextPaused]}>
                {summary.secondaryText}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
            Active arrival alarms & reminders. Toggle anytime to pause.
          </Text>
        </View>

        {loading && <ActivityIndicator size="large" color={THEME.colors.accentPrimary} style={{ marginVertical: 24 }} />}

        {/* Received Nudgrs */}
        {received.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>RECEIVED NUDGRS ({received.length})</Text>
            {received.map((n) => renderNudge(n, true))}
          </View>
        )}

        {/* Sent Nudgrs */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>SENT NUDGRS ({sent.length})</Text>
          {sent.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>✉️</Text>
              <Text style={styles.emptyTitle}>No Nudgrs sent yet</Text>
              <Text style={styles.emptySubtext}>
                Create a Nudgr from the home screen to schedule an arrival reminder.
              </Text>
            </View>
          ) : (
            sent.map((n) => renderNudge(n, false))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Turn-off choice dialog in iPhone Glass style */}
      <Modal
        visible={disableModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelDisable}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalGlassCard}>
            <Text style={styles.modalTitle}>Pause this Nudgr?</Text>
            <Text style={styles.modalSubtitle}>
              Choose when this arrival alert should automatically resume:
            </Text>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => handleConfirmDisable(NUDGE_DISABLE_MODE.TODAY)}
              activeOpacity={0.8}
            >
              <View style={styles.modalOptionIconBox}>
                <Text style={styles.modalOptionIcon}>☀️</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalOptionTitle}>Today only</Text>
                <Text style={styles.modalOptionDesc}>
                  Paused for today. Resumes automatically tomorrow morning.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => handleConfirmDisable(NUDGE_DISABLE_MODE.MANUAL)}
              activeOpacity={0.8}
            >
              <View style={styles.modalOptionIconBox}>
                <Text style={styles.modalOptionIcon}>⏸️</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalOptionTitle}>Until turned back on</Text>
                <Text style={styles.modalOptionDesc}>
                  Stays paused until you toggle the switch back ON.
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
    backgroundColor: THEME.colors.bg,
  },
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(7, 10, 18, 0.85)',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.glassBorderSubtle,
    zIndex: 10,
  },
  headerTitleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.3,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  backArrow: {
    fontSize: 28,
    color: THEME.colors.accentPrimary,
    fontWeight: '300',
    lineHeight: 30,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  topSection: {
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  section: {
    marginBottom: 22,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 12,
    marginLeft: 4,
  },

  // --- Floating Glass Tile ---
  tileCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.card,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  tileCardDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    opacity: 0.7,
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
    gap: 10,
    flex: 1,
  },
  avatarDot: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  avatarDotText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  personDirection: {
    fontSize: 9,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.2,
  },
  switchWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  switchLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  switchOn: {
    color: THEME.colors.accentPrimary,
  },
  switchOff: {
    color: THEME.colors.textTertiary,
  },
  switchStyle: {
    transform: Platform.OS === 'ios' ? [{ scaleX: 0.85 }, { scaleY: 0.85 }] : [{ scaleX: 1.05 }, { scaleY: 1.05 }],
  },

  // --- Message ---
  messageBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  messageText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.90)',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  textDisabled: {
    color: THEME.colors.textTertiary,
  },

  // --- Footer tags ---
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
  },
  locationTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  locationTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
  },
  scheduleTag: {
    backgroundColor: 'rgba(139, 124, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 124, 255, 0.25)',
  },
  scheduleTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.accentPrimary,
  },
  voiceTag: {
    backgroundColor: 'rgba(90, 200, 250, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.25)',
  },
  voiceTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.accentSecondary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeActive: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
  },
  badgePaused: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#86efac',
  },
  badgeTextPaused: {
    color: '#fca5a5',
  },

  // --- Empty Card ---
  emptyCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.card,
    padding: 28,
    alignItems: 'center',
    gap: 6,
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  emptySubtext: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },

  // --- Modal Styles ---
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalGlassCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0d111d',
    borderRadius: THEME.radius.cardLg,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderHighlight,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 15,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  modalOptionIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOptionIcon: {
    fontSize: 18,
  },
  modalOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    marginBottom: 2,
  },
  modalOptionDesc: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    lineHeight: 15,
  },
  modalCancel: {
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textSecondary,
  },
});
