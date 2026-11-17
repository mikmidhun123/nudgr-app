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
import { isNativeNotificationActive } from '../notifications/nativeNotificationBridge';
import { INCOMING_STATES, getIncomingState, setIncomingState, clearIncomingState } from '../notifications/incomingState';
import { startRingtone, stopRingtone } from '../notifications/ringtone';
import { dismissIncomingNudgeNotification } from '../notifications/localNotifications';
import { playNudgeMessage, stopNudgeMessage } from '../voice/playback';
import { VOICE_STYLES } from '../voice/tts';
import RadarPulse from './RadarPulse';
import WaveformBars from './WaveformBars';
import AmbientBackground from './AmbientBackground';
import { THEME } from './theme';

const RINGING_TIMEOUT_MS = 30000;
const ANDROID_STATUS_BAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

/**
 * Incoming Nudgr full-screen experience — premium dark call-screen design.
 */
export default function IncomingNudge({ nudgeId, startAnswered = false, onDismiss, onAnswer }) {
  const [nudge, setNudge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(startAnswered ? INCOMING_STATES.ANSWERED : INCOMING_STATES.RINGING);
  const [playbackStatus, setPlaybackStatus] = useState('idle');
  const [, setPlaybackType] = useState(null);

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
            const nativeRinging = await isNativeNotificationActive(nudgeId);
            if (!active || !mountedRef.current || stateRef.current !== INCOMING_STATES.RINGING) return;
            if (nativeRinging) return;
            ringtoneStartedRef.current = true;
            const started = await startRingtone();
            if (!active || !mountedRef.current || stateRef.current !== INCOMING_STATES.RINGING) return;
            // Keep native ringing until foreground audio is actually playing.
            if (started) await dismissIncomingNudgeNotification(nudgeId);
            Vibration.vibrate([0, 800, 200, 800], true);
          };
          appStateSub = AppState.addEventListener('change', async next => {
            if (next !== 'active') {
              ringtoneStartedRef.current = false;
              stopRingtone(); Vibration.cancel();
              return;
            }
            const latest = await getIncomingState(nudgeId);
            if (!active || !mountedRef.current) return;
            if (latest && latest.state !== INCOMING_STATES.RINGING) { cleanup(INCOMING_STATES.MISSED); return; }
            ringInForeground();
          });
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
          markCompleted(nudgeData.id, nudgeData.lastTriggerEventId).catch(() => {});
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
      await markCompleted(nudge.id, nudge.lastTriggerEventId).catch(() => {});
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

  // ── Loading State ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.fullscreen}>
        <AmbientBackground />
        <StatusBar backgroundColor="#F6F7FC" barStyle="dark-content" />
        <ActivityIndicator color={THEME.colors.accentPrimary} size="large" />
        <Text style={styles.loadingText}>Incoming Nudgr…</Text>
      </View>
    );
  }

  // ── RINGING STATE ────────────────────────────────────────────────────────
  if (state === INCOMING_STATES.RINGING) {
    const senderName = nudge?.senderName || 'Someone';
    const initials = getSenderInitials(senderName);
    const nudgeMessage = nudge?.message || 'Arrived at destination';
    const locationLabel = nudge?.triggerLabel || 'Arrival Location';

    return (
      <View style={styles.fullscreen}>
        <AmbientBackground />
        <StatusBar backgroundColor="#F6F7FC" barStyle="dark-content" />

        {/* ── Top Badge ── */}
        <View style={[styles.topSection, { paddingTop: ANDROID_STATUS_BAR_HEIGHT + 28 }]}>
          <View style={styles.incomingPill}>
            <View style={styles.incomingPillDot} />
            <Text style={styles.incomingPillText}>NUDGR CALL</Text>
          </View>
          <Text style={styles.incomingTypeLabel}>Location Arrival Alert</Text>
        </View>

        {/* ── Avatar Section ── */}
        <View style={styles.avatarSection}>
          <View style={{ marginBottom: 20 }}>
            <RadarPulse active={true} size={156} color={THEME.colors.accentPrimary}>
              {/* Outer glow ring */}
              <View style={[styles.avatarOuterRing, { marginBottom: 0 }]}>
                {/* Inner ring */}
                <View style={styles.avatarInnerRing}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                </View>
              </View>
            </RadarPulse>
          </View>

          <Text style={styles.senderName}>{senderName}</Text>

          <View style={styles.locationPill}>
            <Text style={styles.locationPillIcon}>◎</Text>
            <Text style={styles.locationPillText}>{locationLabel}</Text>
          </View>
        </View>

        {/* ── Message Preview Card ── */}
        <View style={styles.messageCard}>
          <Text style={styles.messageCardLabel}>MESSAGE</Text>
          <Text style={styles.messageCardText} numberOfLines={3}>
            "{nudgeMessage}"
          </Text>
        </View>

        {/* ── Call Actions ── */}
        <View style={styles.actionsSection}>
          <View style={styles.actionsRow}>
            {/* Decline */}
            <View style={styles.actionButtonWrapper}>
              <TouchableOpacity
                style={styles.declineButton}
                onPress={handleDecline}
                activeOpacity={0.8}
              >
                <Text style={styles.declineIcon}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Decline</Text>
            </View>

            {/* Answer */}
            <View style={styles.actionButtonWrapper}>
              <TouchableOpacity
                style={styles.answerButton}
                onPress={handleAnswer}
                activeOpacity={0.8}
              >
                <Text style={styles.answerIcon}>✓</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Answer</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // ── ANSWERED / ACTIVE PLAYBACK STATE ────────────────────────────────────
  if (state === INCOMING_STATES.ANSWERED) {
    const voiceLabel =
      nudge?.voiceNote?.enabled || nudge?.voiceUrl || nudge?.audioUrl
        ? 'Personal Voice Note'
        : VOICE_STYLES[nudge?.voiceStyle]?.label || 'Standard Voice';

    return (
      <View style={styles.fullscreen}>
        <AmbientBackground />
        <StatusBar backgroundColor="#F6F7FC" barStyle="dark-content" />

        <View style={[styles.answeredContainer, { paddingTop: ANDROID_STATUS_BAR_HEIGHT + 20 }]}>
          <ScrollView contentContainerStyle={styles.answeredScrollContent} showsVerticalScrollIndicator={false}>

            {/* ── Header Badge ── */}
            <View style={styles.answeredHeaderBadge}>
              <View style={[styles.incomingPillDot, { backgroundColor: THEME.colors.mint }]} />
              <Text style={[styles.incomingPillText, { color: THEME.colors.mint }]}>CONNECTED</Text>
            </View>
            <Text style={styles.answeredSubtitle}>Active Arrival Message</Text>

            {/* ── Sender ── */}
            <View style={styles.answeredSenderRow}>
              <View style={styles.answeredSenderAvatar}>
                <Text style={styles.answeredSenderInitial}>
                  {getSenderInitials(nudge?.senderName || 'S')}
                </Text>
              </View>
              <View>
                <Text style={styles.answeredFromLabel}>From</Text>
                <Text style={styles.answeredSenderName}>{nudge?.senderName || 'Someone'}</Text>
              </View>
            </View>

            {/* ── Location Badge ── */}
            <View style={styles.answeredLocationBadge}>
              <Text style={styles.answeredLocationText}>
                {nudge?.triggerLabel || 'Location'} · {nudge?.radiusKm?.toFixed(1)} km radius
              </Text>
            </View>

            {/* ── Message Box ── */}
            <View style={styles.answeredMessageBox}>
              <Text style={styles.answeredMessageLabel}>MESSAGE</Text>
              <Text style={styles.answeredMessageText}>{nudge?.message || 'Arrived at your location!'}</Text>
            </View>

            {/* ── Playback Box ── */}
            <View style={styles.playbackBox}>
              <View style={styles.playbackHeader}>
                <View style={styles.playbackVoiceTag}>
                  <Text style={styles.playbackVoiceIcon}>◉</Text>
                  <Text style={styles.playbackVoiceLabel}>{voiceLabel}</Text>
                </View>
                <View style={styles.playbackStatusBadge}>
                  {playbackStatus === 'playing' && (
                    <>
                      <ActivityIndicator size="small" color={THEME.colors.accentPrimary} style={{ marginRight: 6 }} />
                      <Text style={styles.playbackStatusText}>Playing…</Text>
                    </>
                  )}
                  {playbackStatus === 'completed' && (
                    <Text style={[styles.playbackStatusText, { color: THEME.colors.mint }]}>
                      Delivered
                    </Text>
                  )}
                  {playbackStatus === 'idle' && (
                    <Text style={[styles.playbackStatusText, { color: THEME.colors.textTertiary }]}>
                      Ready
                    </Text>
                  )}
                </View>
              </View>

              {playbackStatus === 'playing' && (
                <WaveformBars
                  active={true}
                  barCount={22}
                  color={THEME.colors.accentPrimary}
                  maxHeight={24}
                  style={{ marginBottom: 14 }}
                />
              )}

              <View style={styles.playbackControls}>
                {playbackStatus === 'playing' ? (
                  <TouchableOpacity style={styles.playbackBtn} onPress={handleStopAudio} activeOpacity={0.8}>
                    <Text style={styles.playbackBtnIcon}>■</Text>
                    <Text style={styles.playbackBtnText}>Stop</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.playbackBtn} onPress={handleReplay} activeOpacity={0.8}>
                    <Text style={styles.playbackBtnIcon}>▶</Text>
                    <Text style={styles.playbackBtnText}>Replay Message</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* ── Finish Button ── */}
            <TouchableOpacity style={styles.finishButton} onPress={handleFinish} activeOpacity={0.85}>
              <Text style={styles.finishButtonText}>Finish & Close</Text>
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
    backgroundColor: THEME.colors.bg,
    zIndex: 9999,
    elevation: 20,
    justifyContent: 'center',
  },

  loadingText: {
    color: THEME.colors.textSecondary,
    fontSize: 15,
    marginTop: 16,
    textAlign: 'center',
  },

  // ── Top Section ───────────────────────────────────────────────────────────
  topSection: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  incomingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderSubtle,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: THEME.radius.pill,
    gap: 8,
    marginBottom: 8,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  incomingPillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.colors.accentPrimary,
  },
  incomingPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: THEME.colors.accentPrimary,
    letterSpacing: 2,
  },
  incomingTypeLabel: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    letterSpacing: 0.3,
  },

  // ── Avatar Section ────────────────────────────────────────────────────────
  avatarSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  avatarOuterRing: {
    width: 152,
    height: 152,
    borderRadius: 76,
    borderWidth: 1.5,
    borderColor: 'rgba(99, 102, 241, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  avatarInnerRing: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: 'rgba(99, 102, 241, 0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.20,
    shadowRadius: 16,
    elevation: 4,
  },
  avatarCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: THEME.colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 38,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1,
  },
  senderName: {
    fontSize: 30,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 24,
    letterSpacing: -0.6,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderSubtle,
    borderRadius: THEME.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  locationPillIcon: {
    fontSize: 12,
    color: THEME.colors.mint,
    fontWeight: '700',
  },
  locationPillText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    fontWeight: '600',
  },

  // ── Message Card ──────────────────────────────────────────────────────────
  messageCard: {
    marginHorizontal: 24,
    marginBottom: 28,
    ...THEME.glassCardHero,
    padding: 20,
  },
  messageCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  messageCardText: {
    fontSize: 16,
    color: THEME.colors.textPrimary,
    lineHeight: 23,
    fontStyle: 'italic',
  },

  // ── Call Actions ──────────────────────────────────────────────────────────
  actionsSection: {
    paddingBottom: 48,
    paddingHorizontal: 36,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  actionButtonWrapper: {
    alignItems: 'center',
    gap: 10,
  },
  declineButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 8,
  },
  declineIcon: {
    fontSize: 26,
    color: '#ffffff',
    fontWeight: '800',
  },
  answerButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 8,
  },
  answerIcon: {
    fontSize: 28,
    color: '#ffffff',
    fontWeight: '800',
  },
  actionLabel: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    fontWeight: '700',
  },

  // ── Answered State ────────────────────────────────────────────────────────
  answeredContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  answeredScrollContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  answeredHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: THEME.colors.mintBg,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: THEME.radius.pill,
    marginBottom: 6,
  },
  answeredSubtitle: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginBottom: 20,
    letterSpacing: 0.3,
  },
  answeredSenderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    alignSelf: 'flex-start',
    width: '100%',
  },
  answeredSenderAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: THEME.colors.lavenderBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answeredSenderInitial: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.accentPrimary,
  },
  answeredFromLabel: {
    fontSize: 11,
    color: THEME.colors.textTertiary,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 1,
  },
  answeredSenderName: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.4,
  },
  answeredLocationBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: THEME.colors.glassBorderSubtle,
    borderWidth: 1,
    borderRadius: THEME.radius.xs,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 16,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  answeredLocationText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    fontWeight: '600',
  },
  answeredMessageBox: {
    width: '100%',
    ...THEME.glassCard,
    padding: 18,
    marginBottom: 16,
  },
  answeredMessageLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  answeredMessageText: {
    fontSize: 17,
    color: THEME.colors.textPrimary,
    lineHeight: 24,
    fontWeight: '500',
  },

  // ── Playback Controls ─────────────────────────────────────────────────────
  playbackBox: {
    width: '100%',
    ...THEME.glassCard,
    padding: 16,
    marginBottom: 24,
  },
  playbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  playbackVoiceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playbackVoiceIcon: {
    fontSize: 12,
    color: THEME.colors.accentPrimary,
    fontWeight: '700',
  },
  playbackVoiceLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  playbackStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playbackStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.accentPrimary,
  },
  playbackControls: {
    flexDirection: 'row',
  },
  playbackBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: THEME.colors.lavenderBg,
    borderRadius: THEME.radius.xs,
    paddingVertical: 12,
  },
  playbackBtnIcon: {
    fontSize: 14,
    color: THEME.colors.accentPrimary,
    fontWeight: '700',
  },
  playbackBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.accentPrimary,
  },

  // ── Finish Button ─────────────────────────────────────────────────────────
  finishButton: {
    width: '100%',
    ...THEME.buttonPrimary,
    borderRadius: THEME.radius.button,
    paddingVertical: 16,
  },
  finishButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
});
