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
  Platform,
  StatusBar,
} from 'react-native';
import {
  getNudge,
  markCompleted,
  cancelNudge,
  setNudgeEnabled,
  isNudgeActive,
  getNudgeStateSummary,
  NUDGE_STATUS,
  NUDGE_DISABLE_MODE,
} from '../db/nudges';
import { playNudgeMessage, stopNudgeMessage } from '../voice/playback';
import { VOICE_STYLES } from '../voice/tts';
import { THEME } from './theme';

export default function NudgeDetailScreen({ nudgeId, isReceived, autoPlay = false, onBack }) {
  const [nudge, setNudge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
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
        setNudge((prev) => (prev ? { ...prev, enabled: true, disableMode: null } : null));
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

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bg} />
        <ActivityIndicator size="large" color={THEME.colors.accentPrimary} />
      </View>
    );
  }

  if (!nudge) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bg} />
        <Text style={styles.missingText}>This Nudgr is no longer available.</Text>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.8}>
          <Text style={styles.backButtonText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isActive = isNudgeActive(nudge);
  const summary = getNudgeStateSummary(nudge);
  const voiceUrl = nudge.voiceUrl || nudge.audioUrl;
  const isVoiceNote = !!(nudge.voiceNote?.enabled || voiceUrl);
  const hasVoice = isVoiceNote || (nudge.voiceStyle && nudge.voiceStyle !== 'none');
  const voiceStyleName = isVoiceNote
    ? 'Recorded Voice Note'
    : VOICE_STYLES[nudge.voiceStyle]?.label || 'Normal';

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={async () => {
            await stopNudgeMessage();
            onBack();
          }}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>Nudgr Details</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Primary ON / OFF Switch Floating Glass Card */}
        <View style={[styles.switchGlassCard, !isActive && styles.cardMuted]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>
              Alarm is {isActive ? 'ACTIVE' : 'PAUSED'}
            </Text>
            <Text style={styles.switchSubtitle}>
              {isActive
                ? 'Reminder triggers when location or schedule conditions are met.'
                : summary.secondaryText || 'This Nudgr is currently disabled.'}
            </Text>
          </View>
          <View style={styles.switchControlWrapper}>
            <Text style={[styles.switchLabelText, isActive ? styles.labelActive : styles.labelMuted]}>
              {isActive ? 'ON' : 'OFF'}
            </Text>
            <Switch
              value={isActive}
              onValueChange={handleToggle}
              trackColor={{ false: 'rgba(255,255,255,0.15)', true: 'rgba(139, 124, 255, 0.45)' }}
              thumbColor={isActive ? THEME.colors.accentPrimary : '#94a3b8'}
              ios_backgroundColor="rgba(255,255,255,0.15)"
              style={{ transform: Platform.OS === 'ios' ? [{ scaleX: 0.9 }, { scaleY: 0.9 }] : [{ scaleX: 1.05 }, { scaleY: 1.05 }] }}
            />
          </View>
        </View>

        {/* Detailed Information Glass Card */}
        <View style={styles.detailsGlassCard}>
          <Text style={styles.infoLabel}>{isReceived ? 'RECEIVED FROM' : 'SENT TO'}</Text>
          <Text style={styles.infoValue}>
            {isReceived ? nudge.senderName || 'Unknown' : nudge.recipientName || 'Unknown'}
          </Text>

          <View style={styles.fieldDivider} />

          <Text style={styles.infoLabel}>MESSAGE</Text>
          <View style={styles.messageBox}>
            <Text style={styles.messageText}>"{nudge.message}"</Text>
          </View>

          <View style={styles.fieldDivider} />

          <Text style={styles.infoLabel}>TRIGGER LOCATION & RADIUS</Text>
          <Text style={styles.infoValue}>
            📍 {nudge.triggerLabel || 'Arrival Location'}: {nudge.triggerLatitude?.toFixed(4)}, {nudge.triggerLongitude?.toFixed(4)}
          </Text>
          <Text style={styles.infoSubValue}>
            Radius: {nudge.radiusKm?.toFixed(1)} km
          </Text>

          {nudge.schedule && (
            <>
              <View style={styles.fieldDivider} />
              <Text style={styles.infoLabel}>SCHEDULE</Text>
              <Text style={styles.infoValue}>
                {nudge.schedule.afterTimeText
                  ? `⏰ Only after ${nudge.schedule.afterTimeText}`
                  : typeof nudge.schedule.afterHour === 'number'
                  ? `⏰ Only after ${nudge.schedule.afterHour}:00`
                  : nudge.schedule.activeAfter
                  ? `📅 From ${new Date(nudge.schedule.activeAfter).toLocaleDateString()}`
                  : 'Active'}
              </Text>
            </>
          )}

          <View style={styles.fieldDivider} />

          <Text style={styles.infoLabel}>STATUS</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, isActive ? styles.badgeActive : styles.badgePaused]}>
              <Text style={[styles.statusBadgeText, isActive ? styles.badgeTextActive : styles.badgeTextPaused]}>
                {summary.statusText} • {summary.secondaryText}
              </Text>
            </View>
          </View>

          {hasVoice && (
            <>
              <View style={styles.fieldDivider} />
              <Text style={styles.infoLabel}>VOICE AUDIO</Text>
              <Text style={styles.infoValue}>{voiceStyleName}</Text>
              <TouchableOpacity
                style={styles.voiceButton}
                onPress={isPlaying ? handleStop : () => handlePlay(nudge)}
                activeOpacity={0.8}
              >
                <Text style={styles.voiceButtonText}>
                  {isPlaying ? '⏹ Stop Audio' : '🔊 Play Voice Message'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Action Buttons */}
        {isReceived && nudge.status !== NUDGE_STATUS.COMPLETED && (
          <TouchableOpacity
            style={styles.doneButton}
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
            <Text style={styles.doneButtonText}>✓ Mark Completed</Text>
          </TouchableOpacity>
        )}

        {!isReceived && nudge.status === NUDGE_STATUS.ACTIVE && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={async () => {
              try {
                await stopNudgeMessage();
                await cancelNudge(nudge.id);
                onBack();
              } catch (e) {
                Alert.alert('Could not update', 'Please try again.');
              }
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.cancelButtonText}>Cancel Nudgr</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Turn off Modal */}
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
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  missingText: {
    fontSize: 16,
    color: THEME.colors.textSecondary,
    marginBottom: 16,
    textAlign: 'center',
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

  // --- Switch Glass Card ---
  switchGlassCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: 'rgba(139, 124, 255, 0.3)',
    borderRadius: THEME.radius.card,
    padding: 18,
    marginBottom: 16,
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  cardMuted: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowOpacity: 0,
    elevation: 0,
  },
  switchTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    marginBottom: 3,
  },
  switchSubtitle: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    lineHeight: 16,
  },
  switchControlWrapper: {
    alignItems: 'center',
    marginLeft: 12,
  },
  switchLabelText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  labelActive: {
    color: THEME.colors.accentPrimary,
  },
  labelMuted: {
    color: THEME.colors.textTertiary,
  },

  // --- Details Glass Card ---
  detailsGlassCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.card,
    padding: 20,
    marginBottom: 18,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.2,
  },
  infoSubValue: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: THEME.colors.glassBorderSubtle,
    marginVertical: 14,
  },
  messageBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
  },
  messageText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.95)',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  statusRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
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
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#86efac',
  },
  badgeTextPaused: {
    color: '#fca5a5',
  },
  voiceButton: {
    backgroundColor: 'rgba(90, 200, 250, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.35)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  voiceButtonText: {
    color: THEME.colors.accentSecondary,
    fontWeight: '700',
    fontSize: 14,
  },

  // --- Actions ---
  doneButton: {
    backgroundColor: 'rgba(48, 209, 88, 0.20)',
    borderWidth: 1,
    borderColor: THEME.colors.success,
    borderRadius: THEME.radius.button,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  doneButtonText: {
    color: '#86efac',
    fontSize: 16,
    fontWeight: '800',
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: THEME.colors.danger,
    borderRadius: THEME.radius.button,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  cancelButtonText: {
    color: '#fca5a5',
    fontSize: 16,
    fontWeight: '800',
  },
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  backButtonText: {
    color: THEME.colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
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
