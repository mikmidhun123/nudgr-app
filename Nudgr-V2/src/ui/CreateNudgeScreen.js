import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Button,
} from 'react-native';
import * as Location from 'expo-location';
import RadiusSlider from './RadiusSlider';
import TimePickerRoller from './TimePickerRoller';
import { createNudge } from '../db/nudges';
import { VOICE_STYLE_LIST, previewVoice, stopSpeech } from '../voice/tts';
import {
  startRecording,
  stopRecording,
  playPreview,
  stopPreview,
  discardRecording,
  requestMicPermission,
  hasMicPermission,
} from '../voice/recorder';
import { getVoiceUploadUrl, uploadVoiceNoteToR2 } from '../voice/r2Storage';
import {
  createAndScheduleTimeTestNudge,
  scheduleNudgeTimeAlarm,
} from '../notifications/localNotifications';

export default function CreateNudgeScreen({ connections, onCreated, onBack }) {
  const [recipientUid, setRecipientUid] = useState(null);
  const [message, setMessage] = useState('');
  const [trigger, setTrigger] = useState(null); // { latitude, longitude, label }
  const [radiusKm, setRadiusKm] = useState(5.0);
  const [schedule, setSchedule] = useState('none'); // 'none' | 'afterTime' | 'tomorrow'
  const [timePickerState, setTimePickerState] = useState({
    hour12: 6,
    minute: 0,
    period: 'PM',
    hour24: 18,
    formattedText: '6:00 PM',
  });
  const [voiceStyle, setVoiceStyle] = useState('normal'); // 'gentle' | 'normal' | 'energetic' | 'urgent' | 'none'
  const [busy, setBusy] = useState(false);
  const [busyStatus, setBusyStatus] = useState(null);
  const [error, setError] = useState(null);

  // Voice Note Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedVoice, setRecordedVoice] = useState(null); // { uri, durationMs, sizeBytes, mimeType }
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [micError, setMicError] = useState(null);

  useEffect(() => {
    return () => {
      stopSpeech();
      stopPreview();
      discardRecording();
    };
  }, []);

  const pickLocation = async () => {
    try {
      const fg = await Location.getForegroundPermissionsAsync();
      let status = fg.status;
      if (status !== 'granted') {
        const res = await Location.requestForegroundPermissionsAsync();
        status = res.status;
      }
      if (status !== 'granted') {
        setError('Location permission is needed to set a trigger.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (loc && loc.coords) {
        setTrigger({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          label: 'My current location',
        });
        setError(null);
      } else {
        setError('Could not retrieve coordinates. Check GPS and try again.');
      }
    } catch (e) {
      setError('Could not get your location. Check GPS and try again.');
    }
  };

  const onPreviewTTS = () => {
    if (voiceStyle === 'none') {
      stopSpeech();
      return;
    }
    const sample = message.trim() ? message.trim() : null;
    previewVoice(voiceStyle, sample);
  };

  const handleTimeChange = (newTime) => {
    setTimePickerState(newTime);
  };

  // -------------------------------------------------------------
  // Voice Recording Handlers
  // -------------------------------------------------------------
  const handleStartRecord = async () => {
    setMicError(null);
    try {
      const hasPerm = await hasMicPermission();
      if (!hasPerm) {
        const granted = await requestMicPermission();
        if (!granted) {
          setMicError('Microphone permission is needed to record a voice note. You can still continue using Text-to-Speech below.');
          return;
        }
      }

      setRecordedVoice(null);
      setRecordingSeconds(0);
      setIsRecording(true);

      await startRecording({
        onDurationUpdate: (seconds) => {
          setRecordingSeconds(seconds);
        },
        onMaxDurationReached: (result) => {
          setIsRecording(false);
          setRecordedVoice(result);
        },
      });
    } catch (err) {
      setIsRecording(false);
      setMicError(err.message || 'Could not start recording. You can still use Text-to-Speech.');
    }
  };

  const handleStopRecord = async () => {
    try {
      const result = await stopRecording();
      setIsRecording(false);
      if (result && result.uri) {
        setRecordedVoice(result);
      }
    } catch (err) {
      setIsRecording(false);
      if (__DEV__) console.warn('[CreateNudge:stopRecord]', err.message);
    }
  };

  const handlePlayPreview = async () => {
    if (!recordedVoice?.uri) return;
    setIsPlayingPreview(true);
    await playPreview(
      recordedVoice.uri,
      () => setIsPlayingPreview(false),
      () => setIsPlayingPreview(false)
    );
  };

  const handleStopPreview = async () => {
    await stopPreview();
    setIsPlayingPreview(false);
  };

  const handleDeleteVoice = async () => {
    await discardRecording();
    setRecordedVoice(null);
    setIsPlayingPreview(false);
    setRecordingSeconds(0);
  };

  // -------------------------------------------------------------
  // Quick Pure Time Trigger Test (Section 1 of Test Protocol)
  // -------------------------------------------------------------
  const runQuickTimeTest = async (seconds = 60) => {
    setBusy(true);
    setBusyStatus(`Scheduling ${seconds}s Time Trigger Test...`);
    setError(null);
    try {
      const res = await createAndScheduleTimeTestNudge({
        message: message.trim() || 'Time trigger test',
        seconds,
      });

      if (res.success) {
        Alert.alert(
          '⏰ Time Trigger Scheduled!',
          `Nudgr ID: ${res.nudgeId}\n` +
          `Notification ID: ${res.notificationId}\n` +
          `Target Time: ${res.targetTime} (${seconds}s from now)\n\n` +
          `👉 TEST PROTOCOL:\n1. Press Home / leave app.\n2. Lock your phone.\n3. Wait until ${res.targetTime} for notification to appear.`,
          [{ text: 'OK', onPress: onBack }]
        );
      } else {
        setError(res.error || 'Failed to schedule time trigger test.');
        Alert.alert('Scheduling Error', res.error || 'Failed to schedule time trigger test.');
      }
    } catch (err) {
      setError(err.message || 'Error running time trigger test.');
    } finally {
      setBusy(false);
      setBusyStatus(null);
    }
  };

  // -------------------------------------------------------------
  // Submit Nudgr
  // -------------------------------------------------------------
  const submitWithData = async (voiceNotePayload = null) => {
    const scheduleData =
      schedule === 'afterTime'
        ? {
            type: 'TIME',
            afterHour: timePickerState.hour24,
            afterMinute: timePickerState.minute,
            afterTimeText: timePickerState.formattedText,
          }
        : schedule === 'tomorrow'
        ? { activeAfter: new Date(new Date().setDate(new Date().getDate() + 1)).getTime() }
        : null;

    // Check if this is a pure time test or self-test (no peer / no GPS required)
    if (recipientUid === 'self_test' || !trigger) {
      const testNudge = {
        id: `test_time_${Date.now()}`,
        senderName: 'Nudgr Time Test',
        message: message.trim() || 'Time trigger test',
        schedule: scheduleData || {
          type: 'TIME',
          delaySeconds: 60,
          targetTimestamp: Date.now() + 60000,
        },
        createdAt: Date.now(),
        enabled: true,
        isLocalTest: true,
      };

      const res = await scheduleNudgeTimeAlarm(testNudge);

      await discardRecording();
      if (res?.success) {
        Alert.alert(
          '⏰ Time Trigger Test Scheduled!',
          `Trigger scheduled for ${res.targetTime} (${res.secondsInFuture}s from now).\n\nLock your phone now and wait for notification!`,
          [{ text: 'OK', onPress: onBack }]
        );
      } else {
        setError(res?.error || 'Failed to schedule test alarm.');
      }
      return;
    }

    const peer = connections.find((c) => c.otherUid === recipientUid);
    const created = await createNudge({
      recipientUid,
      recipientName: peer?.profile?.displayName || peer?.profile?.email || null,
      message,
      triggerLatitude: trigger.latitude,
      triggerLongitude: trigger.longitude,
      triggerLabel: trigger.label,
      radiusKm,
      schedule: scheduleData,
      voiceStyle: voiceStyle || 'normal',
      voiceNote: voiceNotePayload,
    });

    await discardRecording();
    onCreated(created.id);
  };

  const submit = async () => {
    if (!recipientUid) {
      setError('Choose a recipient (or select "Self / Time Test").');
      return;
    }
    if (!message || !message.trim()) {
      setError('Add a text message for your Nudgr.');
      return;
    }
    if (!trigger && schedule === 'none') {
      setError('Set a trigger location, or choose a Schedule time.');
      return;
    }

    setBusy(true);
    setError(null);

    // If a voice note was recorded, upload to Cloudflare R2 first
    if (recordedVoice && recordedVoice.uri) {
      setBusyStatus('Uploading voice note to Cloudflare R2...');
      try {
        const { uploadUrl, storageKey } = await getVoiceUploadUrl(null, {
          durationMs: recordedVoice.durationMs,
          sizeBytes: recordedVoice.sizeBytes,
          mimeType: recordedVoice.mimeType,
        });

        await uploadVoiceNoteToR2(uploadUrl, recordedVoice.uri, recordedVoice.mimeType);

        setBusyStatus('Creating Nudgr...');
        const voiceNotePayload = {
          enabled: true,
          storageKey,
          durationMs: recordedVoice.durationMs,
          sizeBytes: recordedVoice.sizeBytes,
          mimeType: recordedVoice.mimeType || 'audio/m4a',
        };

        await submitWithData(voiceNotePayload);
      } catch (uploadErr) {
        setBusy(false);
        setBusyStatus(null);

        // Handle upload failure gracefully: allow retry or continuing with TTS
        Alert.alert(
          'Voice Note Upload Failed',
          `${uploadErr.message || 'Could not upload audio to Cloudflare R2.'}\n\nWould you like to continue creating your Nudgr using the Text-to-Speech voice instead?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Continue with TTS',
              onPress: async () => {
                setBusy(true);
                setBusyStatus('Creating Nudgr with TTS...');
                try {
                  await submitWithData(null);
                } catch (e) {
                  setError(e.message || 'Could not create Nudgr.');
                } finally {
                  setBusy(false);
                  setBusyStatus(null);
                }
              },
            },
          ]
        );
        return;
      }
    } else {
      // Standard Text + TTS Nudgr
      setBusyStatus('Creating Nudgr...');
      try {
        await submitWithData(null);
      } catch (e) {
        setError(e.message || 'Could not create Nudgr.');
      } finally {
        setBusy(false);
        setBusyStatus(null);
      }
    }
  };

  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>Create Nudgr</Text>
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

      <ScrollView style={styles.container}>

      {/* 🧪 Pure Time Trigger Test Card (No GPS, No Geofence, No Peer Required) */}
      <View style={styles.timeTestCard}>
        <Text style={styles.timeTestTitle}>🧪 Pure Time Trigger Test (1–2 min)</Text>
        <Text style={styles.timeTestSubtitle}>
          Test time-based scheduling directly. Zero dependency on GPS, geofence, another user, or Firebase.
        </Text>
        <View style={styles.timeTestBtnRow}>
          <TouchableOpacity
            style={styles.timeTestBtn}
            onPress={() => runQuickTimeTest(60)}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.timeTestBtnText}>⏱️ 1-Minute Test (+60s)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.timeTestBtn}
            onPress={() => runQuickTimeTest(120)}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.timeTestBtnText}>⏱️ 2-Minute Test (+120s)</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.label}>Recipient</Text>
      {/* Option to test without a peer */}
      <TouchableOpacity
        style={[
          styles.chip,
          recipientUid === 'self_test' && styles.chipActive,
        ]}
        onPress={() => setRecipientUid('self_test')}
      >
        <Text style={[styles.chipText, recipientUid === 'self_test' && styles.chipTextActive]}>
          👤 Self / Test Nudgr (Single device test)
        </Text>
      </TouchableOpacity>

      {connections.length === 0 ? (
        <Text style={styles.hint}>No peer connections. Use "Self / Test Nudgr" above to test on this device.</Text>
      ) : (
        connections.map((c) => (
          <TouchableOpacity
            key={c.otherUid}
            style={[
              styles.chip,
              recipientUid === c.otherUid && styles.chipActive,
            ]}
            onPress={() => setRecipientUid(c.otherUid)}
          >
            <Text style={styles.chipText}>
              {c.profile?.displayName || c.profile?.email || c.otherUid}
            </Text>
          </TouchableOpacity>
        ))
      )}

      <Text style={styles.label}>Message</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        placeholder="I'm almost home ❤️"
        placeholderTextColor="#999"
        value={message}
        onChangeText={setMessage}
        multiline
      />

      {/* -------------------------------------------------------- */}
      {/* OPTIONAL VOICE NOTE SECTION */}
      {/* -------------------------------------------------------- */}
      <Text style={styles.label}>Voice Note (Optional)</Text>
      <View style={styles.voiceNoteCard}>
        {!isRecording && !recordedVoice && (
          <View>
            <TouchableOpacity style={styles.recordButton} onPress={handleStartRecord}>
              <Text style={styles.recordButtonText}>🎙️ Record Voice Note</Text>
            </TouchableOpacity>
            <Text style={styles.voiceNoteHint}>
              Record a personal voice message (up to 60s). It will play automatically when answered.
            </Text>
          </View>
        )}

        {isRecording && (
          <View style={styles.recordingActiveContainer}>
            <View style={styles.recordingRow}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTimer}>
                Recording: {formatTimer(recordingSeconds)} / 01:00
              </Text>
            </View>
            <TouchableOpacity style={styles.stopRecordButton} onPress={handleStopRecord}>
              <Text style={styles.stopRecordButtonText}>⏹ Stop Recording</Text>
            </TouchableOpacity>
          </View>
        )}

        {recordedVoice && !isRecording && (
          <View style={styles.recordedContainer}>
            <Text style={styles.recordedTitle}>
              ✓ Voice note recorded ({Math.round(recordedVoice.durationMs / 1000)}s • {Math.round(recordedVoice.sizeBytes / 1024)} KB)
            </Text>
            <View style={styles.voiceActionsRow}>
              {isPlayingPreview ? (
                <TouchableOpacity style={styles.previewActionBtn} onPress={handleStopPreview}>
                  <Text style={styles.previewActionBtnText}>⏹ Stop</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.previewActionBtn} onPress={handlePlayPreview}>
                  <Text style={styles.previewActionBtnText}>▶ Play</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.reRecordBtn} onPress={handleStartRecord}>
                <Text style={styles.reRecordBtnText}>🔄 Re-record</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteVoiceBtn} onPress={handleDeleteVoice}>
                <Text style={styles.deleteVoiceBtnText}>🗑️ Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {micError && <Text style={styles.micErrorText}>{micError}</Text>}
      </View>

      <Text style={styles.label}>Trigger location</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity style={[styles.secondaryButton, { flex: 1 }]} onPress={pickLocation}>
          <Text style={styles.secondaryButtonText}>Use current location</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { flex: 1, backgroundColor: trigger?.label?.includes('Time') ? '#e8f5e9' : '#f8fafc', borderColor: '#86efac', borderWidth: 1 },
          ]}
          onPress={() => {
            setTrigger({ latitude: 0, longitude: 0, label: 'Pure Time Trigger (No GPS)' });
            setError(null);
          }}
        >
          <Text style={{ color: '#16a34a', fontWeight: '600' }}>⏱️ Skip GPS (Time Only)</Text>
        </TouchableOpacity>
      </View>
      {trigger && (
        <Text style={styles.hint}>
          {trigger.label}: {trigger.latitude.toFixed(4)}, {trigger.longitude.toFixed(4)}
        </Text>
      )}

      <RadiusSlider value={radiusKm} onChange={setRadiusKm} />

      <Text style={styles.label}>Schedule (optional)</Text>

      {/* Option 1: No Schedule */}
      <TouchableOpacity
        style={[styles.chip, schedule === 'none' && styles.chipActive]}
        onPress={() => setSchedule('none')}
      >
        <Text style={[styles.chipText, schedule === 'none' && styles.chipTextActive]}>
          No schedule (trigger on arrival)
        </Text>
      </TouchableOpacity>

      {/* Option 2: Only after [Custom Time] with embedded time roller */}
      <TouchableOpacity
        style={[styles.chip, schedule === 'afterTime' && styles.chipActive]}
        onPress={() => setSchedule('afterTime')}
      >
        <Text style={[styles.chipText, schedule === 'afterTime' && styles.chipTextActive]}>
          Only after {timePickerState.formattedText}
        </Text>
      </TouchableOpacity>

      {schedule === 'afterTime' && (
        <TimePickerRoller
          hour12={timePickerState.hour12}
          minute={timePickerState.minute}
          period={timePickerState.period}
          onChange={handleTimeChange}
        />
      )}

      {/* Option 3: From Tomorrow */}
      <TouchableOpacity
        style={[styles.chip, schedule === 'tomorrow' && styles.chipActive]}
        onPress={() => setSchedule('tomorrow')}
      >
        <Text style={[styles.chipText, schedule === 'tomorrow' && styles.chipTextActive]}>
          From tomorrow
        </Text>
      </TouchableOpacity>

      <Text style={styles.label}>Voice Alert Style (TTS Fallback)</Text>
      <View style={styles.voiceGrid}>
        {VOICE_STYLE_LIST.map((v) => (
          <TouchableOpacity
            key={v.key}
            style={[
              styles.voiceChip,
              voiceStyle === v.key && styles.voiceChipActive,
            ]}
            onPress={() => setVoiceStyle(v.key)}
          >
            <Text style={[styles.voiceChipTitle, voiceStyle === v.key && styles.voiceChipTextActive]}>
              {v.label}
            </Text>
            <Text style={styles.voiceChipDesc}>{v.description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {voiceStyle !== 'none' && (
        <TouchableOpacity style={styles.previewButton} onPress={onPreviewTTS}>
          <Text style={styles.previewButtonText}>🔊 Preview Selected TTS Style</Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={submit}
        disabled={busy}
      >
        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryButtonText}>{busyStatus || 'Creating Nudgr...'}</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>Create Nudgr</Text>
        )}
      </TouchableOpacity>
      <View style={{ marginTop: 12, marginBottom: 28 }}>
        <Button title="Back" onPress={onBack} />
      </View>
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
  container: { padding: 16 },
  heading: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#555', marginTop: 12, marginBottom: 6 },
  hint: { fontSize: 13, color: '#888', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#333',
    textAlignVertical: 'top',
  },
  chip: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  chipActive: { borderColor: '#2e7d32', backgroundColor: '#e8f5e9' },
  chipText: { fontSize: 15, color: '#333' },
  chipTextActive: { fontWeight: 'bold', color: '#1b5e20' },
  secondaryButton: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#2e7d32', fontWeight: '600' },
  voiceNoteCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  recordButton: {
    backgroundColor: '#0284c7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  recordButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  voiceNoteHint: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 6,
    textAlign: 'center',
  },
  recordingActiveContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    marginRight: 8,
  },
  recordingTimer: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ef4444',
  },
  stopRecordButton: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  stopRecordButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  recordedContainer: {
    paddingVertical: 4,
  },
  recordedTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#16a34a',
    marginBottom: 10,
    textAlign: 'center',
  },
  voiceActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  previewActionBtn: {
    flex: 1,
    backgroundColor: '#e0f2fe',
    borderWidth: 1,
    borderColor: '#0284c7',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  previewActionBtnText: {
    color: '#0284c7',
    fontWeight: '700',
  },
  reRecordBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  reRecordBtnText: {
    color: '#475569',
    fontWeight: '600',
  },
  deleteVoiceBtn: {
    flex: 1,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  deleteVoiceBtnText: {
    color: '#dc2626',
    fontWeight: '600',
  },
  micErrorText: {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 6,
  },
  voiceGrid: { marginBottom: 6 },
  voiceChip: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  voiceChipActive: {
    borderColor: '#2e7d32',
    backgroundColor: '#e8f5e9',
  },
  voiceChipTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  voiceChipTextActive: {
    color: '#2e7d32',
  },
  voiceChipDesc: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  previewButton: {
    backgroundColor: '#f1f8e9',
    borderColor: '#a5d6a7',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  previewButtonText: {
    color: '#2e7d32',
    fontWeight: '600',
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c62828', fontSize: 14, marginTop: 12 },
  timeTestCard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#22c55e',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  timeTestTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#15803d',
    marginBottom: 4,
  },
  timeTestSubtitle: {
    fontSize: 12,
    color: '#4b5563',
    lineHeight: 17,
    marginBottom: 10,
  },
  timeTestBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timeTestBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  timeTestBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
