import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Vibration,
} from 'react-native';
import { getNudge, markCompleted } from '../db/nudges';
import { speakNudge, stopSpeech } from '../voice/tts';

/**
 * Incoming Nudgr full-screen overlay.
 * Appears when the recipient has an unhandled, triggered Nudgr.
 * Plays the local TTS voice alert in the foreground.
 */
export default function IncomingNudge({ nudgeId, onDismiss, onOpen }) {
  const [nudge, setNudge] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Vibration.vibrate([0, 600, 300, 600], true);
    getNudge(nudgeId)
      .then((n) => {
        if (active && n) {
          setNudge(n);
          // Automatically speak in-app if voice is enabled for this Nudge
          if (n.voiceStyle && n.voiceStyle !== 'none') {
            speakNudge(n.message, n.voiceStyle);
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      Vibration.cancel();
      stopSpeech();
    };
  }, [nudgeId]);

  const complete = async () => {
    Vibration.cancel();
    stopSpeech();
    try {
      if (nudge) await markCompleted(nudge.id);
    } catch (e) {
      if (__DEV__) console.warn('[incoming-complete]', e.message);
    }
    onDismiss();
  };

  const open = () => {
    if (!nudge) return;
    Vibration.cancel();
    stopSpeech();
    onOpen(nudge.id);
  };

  const handleReplayVoice = () => {
    if (nudge?.message) {
      speakNudge(nudge.message, nudge.voiceStyle || 'normal');
    }
  };

  const hasVoice = nudge?.voiceStyle && nudge?.voiceStyle !== 'none';

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.badge}>📞 NUDGR</Text>
        {loading ? (
          <ActivityIndicator color="#fff" style={{ marginTop: 20 }} />
        ) : (
          <>
            <Text style={styles.sender}>{nudge?.senderName || 'Someone'}</Text>
            <Text style={styles.message}>"{nudge?.message}"</Text>
            {hasVoice && (
              <TouchableOpacity style={styles.voiceButton} onPress={handleReplayVoice}>
                <Text style={styles.voiceButtonText}>🔊 Replay Voice</Text>
              </TouchableOpacity>
            )}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.decline} onPress={complete}>
                <Text style={styles.declineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.open} onPress={open}>
                <Text style={styles.openText}>Open</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  card: {
    width: '88%',
    backgroundColor: '#1b5e20',
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
  },
  badge: { fontSize: 16, fontWeight: 'bold', color: '#a5d6a7', letterSpacing: 2 },
  sender: { fontSize: 30, fontWeight: 'bold', color: '#fff', marginTop: 18 },
  message: {
    fontSize: 18,
    color: '#e8f5e9',
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 18,
  },
  voiceButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  voiceButtonText: { color: '#fff', fontWeight: '600' },
  actions: { flexDirection: 'row', width: '100%' },
  decline: {
    flex: 1,
    backgroundColor: '#c62828',
    borderRadius: 12,
    paddingVertical: 16,
    marginRight: 10,
    alignItems: 'center',
  },
  declineText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  open: {
    flex: 1,
    backgroundColor: '#43a047',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  openText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
