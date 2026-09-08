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
} from 'react-native';
import {
  subscribeSentNudges,
  subscribeReceivedNudges,
  setNudgeEnabled,
  isNudgeActive,
  getNudgeStateSummary,
  NUDGE_DISABLE_MODE,
} from '../db/nudges';

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

    return (
      <TouchableOpacity
        key={n.id}
        style={[styles.card, !isActive && styles.cardDisabled]}
        onPress={() => onOpenNudge(n.id, isReceived)}
        activeOpacity={0.85}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={[styles.personLabel, !isActive && styles.textDisabled]}>
              {isReceived ? `From: ${n.senderName || 'Someone'}` : `To: ${n.recipientName || 'Someone'}`}
            </Text>
            <Text style={[styles.messageText, !isActive && styles.textDisabled]} numberOfLines={2}>
              "{n.message}"
            </Text>
          </View>

          {/* Android-style ON/OFF Switch Control */}
          <View style={styles.switchContainer} pointerEvents="box-none">
            <Text style={[styles.switchLabel, isActive ? styles.switchLabelOn : styles.switchLabelOff]}>
              {isActive ? 'ON' : 'OFF'}
            </Text>
            <Switch
              value={isActive}
              onValueChange={(val) => handleToggle(n, val)}
              trackColor={{ false: '#cbd5e1', true: '#86efac' }}
              thumbColor={isActive ? '#16a34a' : '#f8fafc'}
              ios_backgroundColor="#cbd5e1"
              style={styles.switchControl}
            />
          </View>
        </View>

        {/* Metadata and Subtitle Status */}
        <View style={styles.cardFooter}>
          <Text style={[styles.metaText, !isActive && styles.textDisabled]}>
            📍 Radius: {n.radiusKm?.toFixed(1)} km
            {n.schedule?.afterTimeText ? ` • ⏰ After ${n.schedule.afterTimeText}` : ''}
            {n.voiceStyle && n.voiceStyle !== 'none' ? ` • 🎙️ ${n.voiceStyle}` : ''}
          </Text>

          {summary.secondaryText && (
            <View style={[styles.badge, isActive ? styles.badgeActive : styles.badgePaused]}>
              <Text style={[styles.badgeText, isActive ? styles.badgeTextActive : styles.badgeTextPaused]}>
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
      <View style={styles.header}>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>My Nudgrs</Text>
        </View>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.container}>
        <Text style={styles.subheading}>
          Manage your active reminders and arrival alarms. Toggle the switch to turn ON or OFF.
        </Text>

        {loading && <ActivityIndicator size="large" color="#2e7d32" style={{ marginVertical: 16 }} />}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {received.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>📥 Received Nudgrs</Text>
              {received.map((n) => renderNudge(n, true))}
            </>
          )}

          <Text style={styles.sectionTitle}>📤 Sent Nudgrs</Text>
          {sent.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No Nudgrs sent yet.</Text>
              <Text style={styles.emptySubtext}>Create a Nudgr from the Home Screen to get started.</Text>
            </View>
          ) : (
            sent.map((n) => renderNudge(n, false))
          )}

          <View style={{ marginTop: 20, marginBottom: 30 }}>
            <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.8}>
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
              Choose how you would like to disable "{selectedNudgeForDisable?.message || 'this Nudgr'}":
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
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8fafc',
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  subheading: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 16,
    lineHeight: 18,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    marginTop: 12,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#dcfce7',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    shadowOpacity: 0,
    elevation: 0,
    opacity: 0.75,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardInfo: {
    flex: 1,
    marginRight: 12,
  },
  personLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#334155',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  textDisabled: {
    color: '#64748b',
  },
  switchContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  switchLabel: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  switchLabelOn: {
    color: '#16a34a',
  },
  switchLabelOff: {
    color: '#94a3b8',
  },
  switchControl: {
    transform: Platform.OS === 'ios' ? [{ scaleX: 0.9 }, { scaleY: 0.9 }] : [{ scaleX: 1.1 }, { scaleY: 1.1 }],
  },
  cardFooter: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeActive: {
    backgroundColor: '#dcfce7',
  },
  badgePaused: {
    backgroundColor: '#fee2e2',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#15803d',
  },
  badgeTextPaused: {
    color: '#b91c1c',
  },
  backButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
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

