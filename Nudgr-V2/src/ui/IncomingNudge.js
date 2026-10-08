import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Vibration,
  BackHandler,
  ScrollView,
  Platform,
  StatusBar,
  AppState,
} from 'react-native';
import { getNudge, markCompleted } from '../db/nudges';
import { INCOMING_STATES, getIncomingState, setIncomingState, clearIncomingState } from '../notifications/incomingState';
import { startRingtone, stopRingtone } from '../notifications/ringtone';
import { dismissIncomingNudgeNotification } from '../notifications/localNotifications';
import { playNudgeMessage, stopNudgeMessage } from '../voice/playback';
import { VOICE_STYLES } from '../voice/tts';
import { THEME } from './theme';

const RINGING_TIMEOUT_MS = 30000;
const ANDROID_STATUS_BAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

/**
 * Incoming Nudgr full-screen experience with iPhone-inspired Glassmorphism.
 */
export default function IncomingNudge({ nudgeId, startAnswered = false, onDismiss, onAnswer }) {
  const [nudge, setNudge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(startAnswered ? INCOMING_STATES.ANSWERED : INCOMING_STATES.RINGING);
  const [playbackStatus, setPlaybackStatus] = useState('idle');
  const [playbackType, setPlaybackType] = useState(null);

  const stateRef = useRef(state);
  const timeoutRef = useRef(null);
  const mountedRef = useRef(true);
  const ringtoneStartedRef = useRef(false);
  const autoPlayedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timeoutRef.current);
      stopRingtone();
      stopNudgeMessage();
      Vibration.cancel();
    };
  }, []);

  useEffect(() => {
    if (!nudgeId) return;
    let active = true;
    let appStateSub;

    const initialize = async () => {
      try {
        if (!startAnswered) {
          await setIncomingState(nudgeId, INCOMING_STATES.RINGING, '');
        }
        const nudgeData = await getNudge(nudgeId);
        if (!active || !mountedRef.current) return;
        if (!nudgeData) {
          cleanup(INCOMING_STATES.MISSED);
          return;
        }
        setNudge(nudgeData);
        setLoading(false);

        if (startAnswered) {
          stopAllRinging();
          setState(INCOMING_STATES.ANSWERED);
          stateRef.current = INCOMING_STATES.ANSWERED;
          await setIncomingState(nudgeId, INCOMING_STATES.ANSWERED, nudgeData.senderName || 'Someone');
        } else {
          await setIncomingState(nudgeId, INCOMING_STATES.RINGING, nudgeData.senderName || 'Someone');
          const ringing = await getIncomingState(nudgeId);
          if (!active || !mountedRef.current || stateRef.current !== INCOMING_STATES.RINGING) return;
          if (ringing && ringing.state !== INCOMING_STATES.RINGING) {
            cleanup(INCOMING_STATES.MISSED);
            return;
          }

          const ringInForeground = async () => {
            if (AppState.currentState !== 'active' || !active || !mountedRef.current ||
                stateRef.current !== INCOMING_STATES.RINGING || ringtoneStartedRef.current) return;
            ringtoneStartedRef.current = true;
            const started = await startRingtone();
            if (!active || !mountedRef.current || stateRef.current !== INCOMING_STATES.RINGING) return;
            // Keep native ringing until foreground audio is actually playing.
            if (started) await dismissIncomingNudgeNotification(nudgeId);
            Vibration.vibrate([0, 800, 200, 800], true);
          };
          appStateSub = AppState.addEventListener('change', () => { ringInForeground(); });
          await ringInForeground();

          timeoutRef.current = setTimeout(() => {
            if (mountedRef.current && stateRef.current === INCOMING_STATES.RINGING) {
              handleTimeout();
            }
          }, Math.max(0, RINGING_TIMEOUT_MS - (Date.now() - (ringing?.timestamp || Date.now()))));
        }
      } catch (e) {
        if (__DEV__) console.warn('[IncomingNudge] init error:', e.message);
        if (active && mountedRef.current) cleanup(INCOMING_STATES.MISSED);
      }
    };
    initialize();
    return () => {
      active = false;
      appStateSub?.remove();
    };
  }, [nudgeId, startAnswered]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stateRef.current === INCOMING_STATES.RINGING) {
        handleDecline();
        return true;
      }
      if (stateRef.current === INCOMING_STATES.ANSWERED) {
        handleFinish();
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, []);

  useEffect(() => {
    if (state === INCOMING_STATES.ANSWERED && nudge && !autoPlayedRef.current) {
      autoPlayedRef.current = true;
      startAutoPlayback(nudge);
    }
  }, [state, nudge]);

  const startAutoPlayback = useCallback(async (nudgeData) => {
    if (!nudgeData) return;
    setPlaybackStatus('playing');

    await playNudgeMessage({
      nudge: nudgeData,
      onStart: (info) => {
        if (mountedRef.current) {
          setPlaybackType(info?.type || 'tts');
          setPlaybackStatus('playing');
        }
      },
      onDone: () => {
        if (mountedRef.current) {
          setPlaybackStatus('completed');
          markCompleted(nudgeData.id).catch(() => {});
        }
      },
      onError: (err) => {
        if (__DEV__) console.warn('[IncomingNudge:playback]', err?.message || err);
        if (mountedRef.current) {
          setPlaybackStatus('error');
        }
      },
    });
  }, []);

  const stopAllRinging = useCallback(() => {
    stopRingtone();
    Vibration.cancel();
    clearTimeout(timeoutRef.current);
    dismissIncomingNudgeNotification(nudgeId);
  }, [nudgeId]);

  const cleanup = useCallback((finalState) => {
    stopAllRinging();
    stopNudgeMessage();
    setState(finalState);
    stateRef.current = finalState;
    setIncomingState(nudgeId, finalState, nudge?.senderName || '');
    clearIncomingState();
    if (finalState === INCOMING_STATES.ANSWERED) {
      if (onAnswer) onAnswer(nudgeId);
    } else {
      if (onDismiss) onDismiss();
    }
  }, [nudgeId, nudge, onAnswer, onDismiss, stopAllRinging]);

  const handleAnswer = useCallback(() => {
    if (stateRef.current !== INCOMING_STATES.RINGING) return;
    stopAllRinging();
    setState(INCOMING_STATES.ANSWERED);
    stateRef.current = INCOMING_STATES.ANSWERED;
    setIncomingState(nudgeId, INCOMING_STATES.ANSWERED, nudge?.senderName || 'Someone');
  }, [nudgeId, nudge, stopAllRinging]);

  const handleDecline = useCallback(() => {
    if (stateRef.current !== INCOMING_STATES.RINGING) return;
    cleanup(INCOMING_STATES.DECLINED);
  }, [cleanup]);

  const handleTimeout = useCallback(() => {
    if (stateRef.current !== INCOMING_STATES.RINGING) return;
    cleanup(INCOMING_STATES.MISSED);
  }, [cleanup]);

  const handleReplay = useCallback(() => {
    if (!nudge) return;
    startAutoPlayback(nudge);
  }, [nudge, startAutoPlayback]);

  const handleStopAudio = useCallback(async () => {
    await stopNudgeMessage();
    setPlaybackStatus('idle');
  }, []);

  const handleFinish = useCallback(async () => {
    await stopNudgeMessage();
    if (nudge?.id) {
      await markCompleted(nudge.id).catch(() => {});
    }
    clearIncomingState();
    if (onDismiss) onDismiss();
  }, [nudge, onDismiss]);

  const getSenderInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  if (loading) {
    return (
      <View style={styles.fullscreen}>
        <StatusBar backgroundColor="#070A12" barStyle="light-content" />
        <ActivityIndicator color={THEME.colors.accentPrimary} size="large" />
        <Text style={styles.loadingText}>Incoming Nudgr…</Text>
      </View>
    );
  }

  // -------------------------------------------------------------
  // 1. INCOMING RINGING STATE — iPhone Glass Call Screen
  // -------------------------------------------------------------
  if (state === INCOMING_STATES.RINGING) {
    const senderName = nudge?.senderName || 'Someone';
    const initials = getSenderInitials(senderName);
    const nudgeMessage = nudge?.message || 'Arrived at destination';
    const locationLabel = nudge?.triggerLabel || 'Arrival Location';

    return (
      <View style={styles.fullscreen}>
        <StatusBar backgroundColor="#070A12" barStyle="light-content" />

        {/* Ambient Glow Orbs */}
        <View style={styles.glowTop} pointerEvents="none" />
        <View style={styles.glowBottom} pointerEvents="none" />

        {/* Top Header Badge */}
        <View style={[styles.topSection, { paddingTop: ANDROID_STATUS_BAR_HEIGHT + 24 }]}>
          <View style={styles.appPill}>
            <View style={styles.appPillDot} />
            <Text style={styles.badge}>NUDGR CALL</Text>
          </View>
          <Text style={styles.incomingLabel}>Location Arrival Alert</Text>
        </View>

        {/* Center: Large Avatar & Sender */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarRing}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          </View>
          <Text style={styles.senderName}>{senderName}</Text>
          <View style={styles.locationTag}>
            <Text style={styles.locationText}>📍 {locationLabel}</Text>
          </View>
        </View>

        {/* Translucent Glass Message Card */}
        <View style={styles.glassMessageCard}>
          <Text style={styles.messagePreviewLabel}>MESSAGE</Text>
          <Text style={styles.messagePreviewText} numberOfLines={3}>
            "{nudgeMessage}"
          </Text>
        </View>

        {/* Bottom Glass Call Actions */}
        <View style={styles.actionsSection}>
          <View style={styles.actions}>
            {/* Decline Action */}
            <View style={styles.btnWrapper}>
              <TouchableOpacity
                style={styles.declineBtn}
                onPress={handleDecline}
                activeOpacity={0.8}
              >
                <Text style={styles.declineIcon}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.btnLabel}>Decline</Text>
            </View>

            {/* Answer Action */}
            <View style={styles.btnWrapper}>
              <TouchableOpacity
                style={styles.answerBtn}
                onPress={handleAnswer}
                activeOpacity={0.8}
              >
                <Text style={styles.answerIcon}>✓</Text>
              </TouchableOpacity>
              <Text style={styles.btnLabel}>Answer</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------
  // 2. ACTIVE FULL-SCREEN PLAYBACK (Answered Mode)
  // -------------------------------------------------------------
  if (state === INCOMING_STATES.ANSWERED) {
    const voiceLabel =
      nudge?.voiceNote?.enabled || nudge?.voiceUrl || nudge?.audioUrl
        ? 'Personal Voice Note'
        : VOICE_STYLES[nudge?.voiceStyle]?.label || 'Standard Voice';

    return (
      <View style={styles.fullscreen}>
        <StatusBar backgroundColor="#070A12" barStyle="light-content" />
        <View style={[styles.activeCard, { paddingTop: ANDROID_STATUS_BAR_HEIGHT + 20 }]}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.activeHeader}>
              <View style={styles.appPill}>
                <View style={[styles.appPillDot, { backgroundColor: THEME.colors.success }]} />
                <Text style={[styles.badge, { color: THEME.colors.success }]}>NUDGR CONNECTED</Text>
              </View>
              <Text style={styles.activeSubtitle}>Active Arrival Message</Text>
            </View>

            <Text style={styles.activeSender}>From {nudge?.senderName || 'Someone'}</Text>

            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>
                📍 {nudge?.triggerLabel || 'Location'}: {nudge?.triggerLatitude?.toFixed(4)}, {nudge?.triggerLongitude?.toFixed(4)} ({nudge?.radiusKm?.toFixed(1)} km)
              </Text>
            </View>

            {/* Message Body */}
            <View style={styles.messageBox}>
              <Text style={styles.messageLabel}>MESSAGE</Text>
              <Text style={styles.messageText}>{nudge?.message || 'Arrived at your location!'}</Text>
            </View>

            {/* Playback Status Bar */}
            <View style={styles.playbackBox}>
              <View style={styles.playbackHeader}>
                <Text style={styles.voiceTypeTag}>🎙️ {voiceLabel}</Text>
                {playbackStatus === 'playing' && (
                  <View style={styles.statusLive}>
                    <ActivityIndicator size="small" color={THEME.colors.accentSecondary} style={{ marginRight: 6 }} />
                    <Text style={styles.statusLiveText}>Playing audio…</Text>
                  </View>
                )}
                {playbackStatus === 'completed' && (
                  <Text style={styles.statusCompletedText}>✓ Delivered & Played</Text>
                )}
                {playbackStatus === 'idle' && (
                  <Text style={styles.statusIdleText}>Ready</Text>
                )}
              </View>

              <View style={styles.playbackControls}>
                {playbackStatus === 'playing' ? (
                  <TouchableOpacity style={styles.controlBtn} onPress={handleStopAudio} activeOpacity={0.8}>
                    <Text style={styles.controlBtnText}>⏹ Stop</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.controlBtn} onPress={handleReplay} activeOpacity={0.8}>
                    <Text style={styles.controlBtnText}>🔊 Replay Message</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Finish Button */}
            <TouchableOpacity style={styles.finishButton} onPress={handleFinish} activeOpacity={0.85}>
              <Text style={styles.finishButtonText}>✓ Finish & Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  fullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#070A12',
    zIndex: 9999,
    elevation: 20,
    justifyContent: 'center',
  },
  glowTop: {
    position: 'absolute',
    top: -80,
    left: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(139, 124, 255, 0.12)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: 60,
    right: -40,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(90, 200, 250, 0.10)',
  },
  loadingText: {
    color: THEME.colors.textSecondary,
    fontSize: 15,
    marginTop: 16,
    textAlign: 'center',
  },

  // --- Top Section ---
  topSection: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  appPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: THEME.radius.pill,
    gap: 8,
    marginBottom: 8,
  },
  appPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.colors.accentPrimary,
  },
  badge: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.accentPrimary,
    letterSpacing: 2,
  },
  incomingLabel: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    letterSpacing: 0.5,
  },

  // --- Avatar Section ---
  avatarSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  avatarRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: 'rgba(139, 124, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
  },
  avatarCircle: {
    width: 114,
    height: 114,
    borderRadius: 57,
    backgroundColor: 'rgba(139, 124, 255, 0.15)',
    borderWidth: 3,
    borderColor: THEME.colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 42,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 2,
  },
  senderName: {
    fontSize: 34,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 24,
    letterSpacing: -0.5,
  },
  locationTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: THEME.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  locationText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    fontWeight: '600',
  },

  // --- Message Card ---
  glassMessageCard: {
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: THEME.colors.bgCardElevated,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderHighlight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  messagePreviewLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.accentSecondary,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  messagePreviewText: {
    fontSize: 16,
    color: '#ffffff',
    lineHeight: 22,
    fontWeight: '500',
    fontStyle: 'italic',
  },

  // --- Actions ---
  actionsSection: {
    paddingBottom: 48,
    paddingHorizontal: 36,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  btnWrapper: {
    alignItems: 'center',
    gap: 8,
  },
  declineBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 69, 58, 0.22)',
    borderWidth: 1.5,
    borderColor: THEME.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.colors.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  declineIcon: {
    fontSize: 26,
    color: '#ffffff',
    fontWeight: '700',
  },
  answerBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(48, 209, 88, 0.25)',
    borderWidth: 1.5,
    borderColor: THEME.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.colors.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  answerIcon: {
    fontSize: 26,
    color: '#ffffff',
    fontWeight: '700',
  },
  btnLabel: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    fontWeight: '600',
  },

  // --- Answered State Card ---
  activeCard: {
    flex: 1,
    backgroundColor: '#070A12',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingBottom: 40,
  },
  activeHeader: {
    alignItems: 'center',
    marginBottom: 6,
  },
  activeSubtitle: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  activeSender: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  locationBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: THEME.colors.glassBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  locationBadgeText: {
    fontSize: 12,
    color: THEME.colors.accentSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  messageBox: {
    width: '100%',
    backgroundColor: THEME.colors.bgCard,
    borderRadius: THEME.radius.card,
    padding: 18,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    marginBottom: 16,
  },
  messageLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  messageText: {
    fontSize: 17,
    color: '#ffffff',
    lineHeight: 24,
    fontWeight: '500',
  },
  playbackBox: {
    width: '100%',
    backgroundColor: THEME.colors.bgCard,
    borderRadius: THEME.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.25)',
    marginBottom: 22,
  },
  playbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  voiceTypeTag: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.accentSecondary,
  },
  statusLive: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLiveText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.accentSecondary,
  },
  statusCompletedText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.success,
  },
  statusIdleText: {
    fontSize: 12,
    color: THEME.colors.textTertiary,
  },
  playbackControls: {
    flexDirection: 'row',
  },
  controlBtn: {
    flex: 1,
    backgroundColor: 'rgba(90, 200, 250, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.3)',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  controlBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.accentSecondary,
  },
  finishButton: {
    width: '100%',
    ...THEME.buttonPrimary,
    borderRadius: THEME.radius.button,
    paddingVertical: 16,
  },
  finishButtonText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
});
