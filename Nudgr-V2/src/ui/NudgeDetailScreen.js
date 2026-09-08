import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Button,
  Switch,
  Modal,
  ScrollView,
  Platform,
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
      // User is turning OFF -> Show modal dialog
      setDisableModalVisible(true);
    } else {
      // User is turning ON -> Turn ON immediately
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
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 20 }} color="#2e7d32" />
        <View style={{ marginTop: 12 }}>
          <Button title="Back" onPress={onBack} />
        </View>
      </View>
    );
  }

  if (!nudge) {
    return (
      <View style={styles.container}>
        <Text style={styles.hint}>This Nudgr is no longer available.</Text>
        <View style={{ marginTop: 12 }}>
          <Button title="Back" onPress={onBack} />
        </View>
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
      <View style={styles.header}>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>Nudgr Details</Text>
        </View>
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
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 36 }}>

      {/* Primary ON / OFF Switch Card */}
      <View style={[styles.switchCard, !isActive && styles.switchCardDisabled]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchTitle}>
            Nudgr Alarm is {isActive ? 'ACTIVE' : 'OFF'}
          </Text>
          <Text style={styles.switchSubtitle}>
            {isActive
              ? 'This reminder will trigger when location or schedule conditions are met.'
              : summary.secondaryText || 'This Nudgr is currently disabled.'}
          </Text>
        </View>
        <View style={styles.switchControlBox}>
          <Text style={[styles.switchStateText, isActive ? styles.textOn : styles.textOff]}>
            {isActive ? 'ON' : 'OFF'}
          </Text>
          <Switch
            value={isActive}
            onValueChange={handleToggle}
            trackColor={{ false: '#cbd5e1', true: '#86efac' }}
            thumbColor={isActive ? '#16a34a' : '#f8fafc'}
            ios_backgroundColor="#cbd5e1"
            style={{ transform: Platform.OS === 'ios' ? [{ scaleX: 0.9 }, { scaleY: 0.9 }] : [{ scaleX: 1.1 }, { scaleY: 1.1 }] }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{isReceived ? 'From' : 'To'}</Text>
        <Text style={styles.value}>
          {isReceived ? nudge.senderName || 'Unknown' : nudge.recipientName || 'Unknown'}
        </Text>

        <Text style={styles.label}>Message</Text>
        <Text style={styles.value}>"{nudge.message}"</Text>

        <Text style={styles.label}>Trigger location</Text>
        <Text style={styles.value}>
          📍 {nudge.triggerLabel || 'Custom'}: {nudge.triggerLatitude?.toFixed(4)}, {nudge.triggerLongitude?.toFixed(4)}
        </Text>

        <Text style={styles.label}>Radius</Text>
        <Text style={styles.value}>{nudge.radiusKm?.toFixed(1)} km</Text>

        {nudge.schedule && (
          <>
            <Text style={styles.label}>Schedule</Text>
            <Text style={styles.value}>
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

        <Text style={styles.label}>Alarm Status</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <View style={[styles.badge, isActive ? styles.badgeActive : styles.badgePaused]}>
            <Text style={[styles.badgeText, isActive ? styles.badgeTextActive : styles.badgeTextPaused]}>
              {summary.statusText} • {summary.secondaryText}
            </Text>
          </View>
        </View>

        {hasVoice && (
          <>
            <Text style={styles.label}>Voice Audio</Text>
            <Text style={styles.value}>{voiceStyleName}</Text>
            <TouchableOpacity
              style={styles.voiceButton}
              onPress={isPlaying ? handleStop : () => handlePlay(nudge)}
              activeOpacity={0.8}
            >
              <Text style={styles.voiceButtonText}>
                {isPlaying ? '⏹ Stop Audio' : '🔊 Play Nudgr Message'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

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
          <Text style={styles.doneButtonText}>✓ Mark Done</Text>
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

      <View style={{ marginTop: 12 }}>
        <Button
          title="← Back"
          onPress={async () => {
            await stopNudgeMessage();
            onBack();
          }}
        />
      </View>

      {/* -------------------------------------------------------- */}
      {/* TURN OFF NUDGR CHOICE MODAL */}
      {/* -------------------------------------------------------- */}
      <Modal
        visible={disableModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelDisable}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Turn off Nudgr?</Text>
            <Text style={styles.modalMessage}>
              Choose how you would like to disable this Nudgr:
            </Text>

            <TouchableOpacity
              style={styles.modalOptionBtn}
              onPress={() => handleConfirmDisable(NUDGE_DISABLE_MODE.TODAY)}
              activeOpacity={0.8}
            >
              <View style={styles.optionIconBox}>
                <Text style={styles.optionIcon}>☀️</Text>
              </View>
              <View style={styles.optionTextBox}>
                <Text style={styles.optionTitle}>Today only</Text>
                <Text style={styles.optionSubtitle}>
                  Paused for the rest of today. Automatically turns back ON tomorrow.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalOptionBtn}
              onPress={() => handleConfirmDisable(NUDGE_DISABLE_MODE.MANUAL)}
              activeOpacity={0.8}
            >
              <View style={styles.optionIconBox}>
                <Text style={styles.optionIcon}>⏸️</Text>
              </View>
              <View style={styles.optionTextBox}>
                <Text style={styles.optionTitle}>Turn off until I turn it on</Text>
                <Text style={styles.optionSubtitle}>
                  Stays disabled until you manually toggle the switch back ON.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={handleCancelDisable}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.07)',
    zIndex: 10,
  },
  headerTitleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    fontSize: 32,
    color: '#16a34a',
    fontWeight: '300',
    lineHeight: 34,
  },
  container: { flex: 1, padding: 16, backgroundColor: '#f8fafc' },
  heading: { fontSize: 24, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  switchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#dcfce7',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  switchCardDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    shadowOpacity: 0,
    elevation: 0,
  },
  switchTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 2,
  },
  switchSubtitle: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  switchControlBox: {
    alignItems: 'center',
    marginLeft: 12,
  },
  switchStateText: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
  },
  textOn: {
    color: '#16a34a',
  },
  textOff: {
    color: '#94a3b8',
  },
  card: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  label: { fontSize: 11, fontWeight: '800', color: '#64748b', marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 16, color: '#1e293b', marginTop: 2, fontWeight: '500' },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeActive: {
    backgroundColor: '#dcfce7',
  },
  badgePaused: {
    backgroundColor: '#fee2e2',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#15803d',
  },
  badgeTextPaused: {
    color: '#b91c1c',
  },
  voiceButton: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    alignItems: 'center',
  },
  voiceButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  doneButton: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  doneButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelButton: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  cancelButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  hint: { fontSize: 14, color: '#888', marginTop: 12 },
  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  modalOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  optionIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optionIcon: {
    fontSize: 18,
  },
  optionTextBox: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  optionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  modalCancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748b',
  },
});

