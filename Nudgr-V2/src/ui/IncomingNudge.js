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
} from 'react-native';
import { getNudge, markCompleted } from '../db/nudges';
import { INCOMING_STATES, setIncomingState, clearIncomingState } from '../notifications/incomingState';
import { startRingtone, stopRingtone } from '../notifications/ringtone';
import { dismissIncomingNudgeNotification } from '../notifications/localNotifications';
import { playNudgeMessage, stopNudgeMessage } from '../voice/playback';
import { VOICE_STYLES } from '../voice/tts';

const RINGING_TIMEOUT_MS = 30000;

/**
 * Incoming Nudgr full-screen experience.
 * Handles both the Ringing call alert and the Active full-screen playback upon Answer.
 */
export default function IncomingNudge({ nudgeId, startAnswered = false, onDismiss, onAnswer }) {
  const [nudge, setNudge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(startAnswered ? INCOMING_STATES.ANSWERED : INCOMING_STATES.RINGING);
  const [playbackStatus, setPlaybackStatus] = useState('idle'); // 'idle' | 'playing' | 'completed' | 'error'
  const [playbackType, setPlaybackType] = useState(null); // 'voice_note' | 'tts' | 'silent'

  const timeoutRef = useRef(null);
  const mountedRef = useRef(true);
  const ringtoneStartedRef = useRef(false);
  const autoPlayedRef = useRef(false);

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

  // Initialize Nudgr document
  useEffect(() => {
    if (!nudgeId) return;
    let active = true;

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
          setState(INCOMING_STATES.ANSWERED);
          await setIncomingState(nudgeId, INCOMING_STATES.ANSWERED, nudgeData.senderName || 'Someone');
        } else {
          await setIncomingState(nudgeId, INCOMING_STATES.RINGING, nudgeData.senderName || 'Someone');

          if (!ringtoneStartedRef.current) {
            ringtoneStartedRef.current = true;
            await startRingtone();
          }
          Vibration.vibrate([0, 800, 200, 800], true);

          timeoutRef.current = setTimeout(() => {
            if (mountedRef.current && state === INCOMING_STATES.RINGING) {
              handleTimeout();
            }
          }, RINGING_TIMEOUT_MS);
        }
      } catch (e) {
        if (__DEV__) console.warn('[IncomingNudge] init error:', e.message);
        if (active && mountedRef.current) cleanup(INCOMING_STATES.MISSED);
      }
    };
    initialize();
    return () => {
      active = false;
    };
  }, [nudgeId, startAnswered]);

  // Intercept Android hardware back button
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state === INCOMING_STATES.RINGING) {
        handleDecline();
        return true;
      }
      if (state === INCOMING_STATES.ANSWERED) {
        handleFinish();
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, [state]);

  // Automatic audio playback when transitioning to ANSWERED state
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
          // Automatically mark Nudgr completed in Firestore upon successful delivery
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
    clearIncomingState();
    if (finalState === INCOMING_STATES.ANSWERED) {
      if (onAnswer) onAnswer(nudgeId);
    } else {
      if (onDismiss) onDismiss();
    }
  }, [nudgeId, onAnswer, onDismiss, stopAllRinging]);

  const handleAnswer = useCallback(() => {
    if (state !== INCOMING_STATES.RINGING) return;
    stopAllRinging();
    setState(INCOMING_STATES.ANSWERED);
    setIncomingState(nudgeId, INCOMING_STATES.ANSWERED, nudge?.senderName || 'Someone');
  }, [state, nudgeId, nudge, stopAllRinging]);

  const handleDecline = useCallback(() => {
    if (state !== INCOMING_STATES.RINGING) return;
    cleanup(INCOMING_STATES.DECLINED);
  }, [state, cleanup]);

  const handleTimeout = useCallback(() => {
    if (state !== INCOMING_STATES.RINGING) return;
    cleanup(INCOMING_STATES.MISSED);
  }, [state, cleanup]);

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

  if (loading) {
    return (
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.badge}>NUDGR</Text>
          <ActivityIndicator color="#4ade80" size="large" style={{ marginTop: 24 }} />
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------
  // 1. INCOMING RINGING STATE (Call-Style Alert)
  // -------------------------------------------------------------
  if (state === INCOMING_STATES.RINGING) {
    return (
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.card} pointerEvents="box-only">
          <Text style={styles.badge}>NUDGR</Text>
          <Text style={styles.subtitle}>Incoming Nudgr</Text>
          <Text style={styles.sender}>{nudge?.senderName || 'Someone'}</Text>
          <Text style={styles.locationSnippet}>
            {nudge?.triggerLabel || 'Arrival Location'} • {nudge?.radiusKm ? `${nudge.radiusKm.toFixed(1)} km radius` : ''}
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity 
              style={styles.decline} 
              onPress={handleDecline}
              activeOpacity={0.8}
            >
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.answer} 
              onPress={handleAnswer}
              activeOpacity={0.8}
            >
              <Text style={styles.answerText}>Answer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------
  // 2. ACTIVE FULL-SCREEN NUDGR EXPERIENCE (Phase 5 Playback)
  // -------------------------------------------------------------
  if (state === INCOMING_STATES.ANSWERED) {
    const voiceLabel =
      nudge?.voiceNote?.enabled || nudge?.voiceUrl || nudge?.audioUrl
        ? 'Voice Note'
        : VOICE_STYLES[nudge?.voiceStyle]?.label || 'Normal Voice';

    return (
      <View style={styles.overlay}>
        <View style={styles.activeCard}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.activeHeader}>
              <Text style={styles.badge}>NUDGR</Text>
              <Text style={styles.activeSubtitle}>Active Nudgr</Text>
            </View>

            <Text style={styles.activeSender}>From {nudge?.senderName || 'Someone'}</Text>

            <View style={styles.locationBadge}>
              <Text style={styles.locationText}>
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
                    <ActivityIndicator size="small" color="#4ade80" style={{ marginRight: 6 }} />
                    <Text style={styles.statusLiveText}>Playing audio...</Text>
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
                  <TouchableOpacity style={styles.controlBtn} onPress={handleStopAudio}>
                    <Text style={styles.controlBtnText}>⏹ Stop</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.controlBtn} onPress={handleReplay}>
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 7, 15, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  card: {
    width: '90%',
    maxWidth: 360,
    backgroundColor: '#121626',
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2e7d32',
    shadowColor: '#2e7d32',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  activeCard: {
    width: '92%',
    maxWidth: 390,
    maxHeight: '90%',
    backgroundColor: '#121626',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#2e7d32',
    shadowColor: '#2e7d32',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  activeHeader: {
    alignItems: 'center',
    marginBottom: 4,
  },
  badge: { 
    fontSize: 18, 
    fontWeight: '800', 
    color: '#4ade80', 
    letterSpacing: 4,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#94a3b8',
    marginBottom: 12,
  },
  activeSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sender: { 
    fontSize: 34, 
    fontWeight: '700', 
    color: '#fff', 
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'center',
  },
  activeSender: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  locationSnippet: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 28,
    textAlign: 'center',
  },
  locationBadge: {
    backgroundColor: 'rgba(46, 125, 50, 0.2)',
    borderColor: '#2e7d32',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  locationText: {
    fontSize: 12,
    color: '#86efac',
    fontWeight: '600',
    textAlign: 'center',
  },
  messageBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
  },
  messageLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 6,
  },
  messageText: {
    fontSize: 18,
    color: '#f8fafc',
    lineHeight: 26,
    fontWeight: '500',
  },
  playbackBox: {
    width: '100%',
    backgroundColor: '#1a2238',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.3)',
    marginBottom: 20,
  },
  playbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  voiceTypeTag: {
    fontSize: 13,
    fontWeight: '700',
    color: '#86efac',
  },
  statusLive: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLiveText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4ade80',
  },
  statusCompletedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4ade80',
  },
  statusIdleText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  playbackControls: {
    flexDirection: 'row',
    gap: 10,
  },
  controlBtn: {
    flex: 1,
    backgroundColor: 'rgba(74, 222, 128, 0.15)',
    borderWidth: 1,
    borderColor: '#4ade80',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  controlBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4ade80',
  },
  finishButton: {
    width: '100%',
    backgroundColor: '#16a34a',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  finishButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  actions: { 
    flexDirection: 'row', 
    width: '100%',
    gap: 16,
  },
  decline: {
    flex: 1,
    backgroundColor: '#dc2626',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  declineText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  answer: {
    flex: 1,
    backgroundColor: '#16a34a',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  answerText: { color: '#fff', fontWeight: '700', fontSize: 18 },
});

