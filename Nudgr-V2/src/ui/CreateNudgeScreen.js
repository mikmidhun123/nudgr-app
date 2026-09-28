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
  StatusBar,
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
import { THEME } from './theme';

export default function CreateNudgeScreen({ connections = [], onCreated, onBack }) {
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
          setMicError('Microphone permission is needed to record a voice note.');
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
      setMicError(err.message || 'Could not start recording. You can still use TTS.');
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

  // Quick pure time test
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
          `Target Time: ${res.targetTime} (${seconds}s from now)\n\n` +
          `Lock your phone now to verify background delivery!`,
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

        Alert.alert(
          'Voice Note Upload Failed',
          `${uploadErr.message || 'Could not upload audio to Cloudflare R2.'}\n\nContinue creating using Text-to-Speech?`,
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
          <Text style={styles.headerTitle}>Create Nudgr</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Apple-style Form Header */}
        <View style={styles.formHeader}>
          <Text style={styles.formTitle}>Create Nudgr</Text>
          <Text style={styles.formSubtitle}>
            Send a reminder that arrives at the right place.
          </Text>
        </View>

        {/* 1. Recipient Panel */}
        <View style={styles.glassPanel}>
          <Text style={styles.panelLabel}>RECIPIENT</Text>

          {/* Self / Local Test Chip */}
          <TouchableOpacity
            style={[
              styles.recipientChip,
              recipientUid === 'self_test' && styles.recipientChipActive,
            ]}
            onPress={() => setRecipientUid('self_test')}
            activeOpacity={0.8}
          >
            <View style={styles.recipientAvatar}>
              <Text style={styles.recipientAvatarText}>👤</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.recipientName, recipientUid === 'self_test' && styles.textActive]}>
                Self / Single-Device Test
              </Text>
              <Text style={styles.recipientSub}>Test notification on this phone</Text>
            </View>
            {recipientUid === 'self_test' && <Text style={styles.checkIcon}>✓</Text>}
          </TouchableOpacity>

          {connections.length === 0 ? (
            <Text style={styles.hintText}>
              No peer connections. Select "Self / Single-Device Test" above to test.
            </Text>
          ) : (
            connections.map((c) => {
              const name = c.profile?.displayName || c.profile?.email || c.otherUid;
              const isSelected = recipientUid === c.otherUid;
              return (
                <TouchableOpacity
                  key={c.otherUid}
                  style={[
                    styles.recipientChip,
                    isSelected && styles.recipientChipActive,
                  ]}
                  onPress={() => setRecipientUid(c.otherUid)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.recipientAvatar, { backgroundColor: 'rgba(139, 124, 255, 0.15)' }]}>
                    <Text style={[styles.recipientAvatarText, { color: THEME.colors.accentPrimary }]}>
                      {name[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.recipientName, isSelected && styles.textActive]}>
                      {name}
                    </Text>
                    <Text style={styles.recipientSub}>{c.status || 'Connected'}</Text>
                  </View>
                  {isSelected && <Text style={styles.checkIcon}>✓</Text>}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* 2. Message Panel */}
        <View style={styles.glassPanel}>
          <Text style={styles.panelLabel}>MESSAGE</Text>
          <TextInput
            style={styles.messageInput}
            placeholder="e.g. I'm almost home ❤️"
            placeholderTextColor={THEME.colors.textTertiary}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* 3. Location & Radius Panel */}
        <View style={styles.glassPanel}>
          <Text style={styles.panelLabel}>LOCATION & RADIUS</Text>

          <View style={styles.locationBtnRow}>
            <TouchableOpacity
              style={[
                styles.locationBtn,
                trigger?.label === 'My current location' && styles.locationBtnActive,
              ]}
              onPress={pickLocation}
              activeOpacity={0.8}
            >
              <Text style={styles.locationBtnIcon}>📍</Text>
              <Text style={styles.locationBtnText}>Use Current Location</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.locationBtn,
                trigger?.label?.includes('Time') && styles.locationBtnActive,
              ]}
              onPress={() => {
                setTrigger({ latitude: 0, longitude: 0, label: 'Pure Time Trigger (No GPS)' });
                setError(null);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.locationBtnIcon}>⏱️</Text>
              <Text style={styles.locationBtnText}>Skip GPS (Time Only)</Text>
            </TouchableOpacity>
          </View>

          {trigger && (
            <View style={styles.locationSelectedBadge}>
              <Text style={styles.locationBadgeText}>
                ✓ {trigger.label} {trigger.latitude !== 0 ? `(${trigger.latitude.toFixed(3)}, ${trigger.longitude.toFixed(3)})` : ''}
              </Text>
            </View>
          )}

          {/* Embedded Glass Radius Slider */}
          <RadiusSlider value={radiusKm} onChange={setRadiusKm} />
        </View>

        {/* 4. Schedule Panel */}
        <View style={styles.glassPanel}>
          <Text style={styles.panelLabel}>SCHEDULE (OPTIONAL)</Text>

          {/* Segmented Control */}
          <View style={styles.segmentedContainer}>
            <TouchableOpacity
              style={[styles.segmentBtn, schedule === 'none' && styles.segmentBtnActive]}
              onPress={() => setSchedule('none')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, schedule === 'none' && styles.segmentTextActive]}>
                On Arrival
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.segmentBtn, schedule === 'afterTime' && styles.segmentBtnActive]}
              onPress={() => setSchedule('afterTime')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, schedule === 'afterTime' && styles.segmentTextActive]}>
                After Time
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.segmentBtn, schedule === 'tomorrow' && styles.segmentBtnActive]}
              onPress={() => setSchedule('tomorrow')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, schedule === 'tomorrow' && styles.segmentTextActive]}>
                Tomorrow
              </Text>
            </TouchableOpacity>
          </View>

          {schedule === 'afterTime' && (
            <TimePickerRoller
              hour12={timePickerState.hour12}
              minute={timePickerState.minute}
              period={timePickerState.period}
              onChange={handleTimeChange}
            />
          )}

          {schedule === 'tomorrow' && (
            <View style={styles.scheduleInfoBox}>
              <Text style={styles.scheduleInfoText}>
                📅 This Nudgr will become active starting tomorrow.
              </Text>
            </View>
          )}
        </View>

        {/* 5. Voice Options Panel */}
        <View style={styles.glassPanel}>
          <Text style={styles.panelLabel}>VOICE & AUDIO</Text>

          {/* Voice Note Recorder Section */}
          <View style={styles.voiceNoteBox}>
            {!isRecording && !recordedVoice && (
              <TouchableOpacity
                style={styles.recordButton}
                onPress={handleStartRecord}
                activeOpacity={0.85}
              >
                <Text style={styles.recordButtonIcon}>🎙️</Text>
                <Text style={styles.recordButtonText}>Record Personal Voice Note</Text>
              </TouchableOpacity>
            )}

            {isRecording && (
              <View style={styles.recordingRow}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingTimer}>
                  Recording: {formatTimer(recordingSeconds)} / 01:00
                </Text>
                <TouchableOpacity
                  style={styles.stopRecordBtn}
                  onPress={handleStopRecord}
                  activeOpacity={0.8}
                >
                  <Text style={styles.stopRecordText}>⏹ Stop</Text>
                </TouchableOpacity>
              </View>
            )}

            {recordedVoice && !isRecording && (
              <View style={styles.recordedCard}>
                <Text style={styles.recordedLabel}>
                  ✓ Voice note ready ({Math.round(recordedVoice.durationMs / 1000)}s)
                </Text>
                <View style={styles.recordedActionRow}>
                  {isPlayingPreview ? (
                    <TouchableOpacity style={styles.voiceActionBtn} onPress={handleStopPreview}>
                      <Text style={styles.voiceActionText}>⏹ Stop</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.voiceActionBtn} onPress={handlePlayPreview}>
                      <Text style={styles.voiceActionText}>▶ Play</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.voiceActionBtn} onPress={handleStartRecord}>
                    <Text style={styles.voiceActionText}>🔄 Re-record</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.voiceActionBtn, styles.deleteBtn]} onPress={handleDeleteVoice}>
                    <Text style={[styles.voiceActionText, { color: THEME.colors.danger }]}>🗑️ Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {micError && <Text style={styles.micErrorText}>{micError}</Text>}
          </View>

          {/* Horizontal Voice Style Cards */}
          <Text style={[styles.panelSubLabel, { marginTop: 14 }]}>TEXT-TO-SPEECH STYLE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.voiceStyleRow}>
            {VOICE_STYLE_LIST.map((v) => {
              const isSelected = voiceStyle === v.key;
              return (
                <TouchableOpacity
                  key={v.key}
                  style={[styles.voiceCard, isSelected && styles.voiceCardActive]}
                  onPress={() => setVoiceStyle(v.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.voiceCardTitle, isSelected && styles.voiceCardTitleActive]}>
                    {v.label}
                  </Text>
                  <Text style={styles.voiceCardDesc} numberOfLines={2}>{v.description}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {voiceStyle !== 'none' && (
            <TouchableOpacity style={styles.previewTtsBtn} onPress={onPreviewTTS} activeOpacity={0.8}>
              <Text style={styles.previewTtsText}>🔊 Preview Selected Voice</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 6. Quick Test Panel */}
        <View style={[styles.glassPanel, { borderColor: 'rgba(90, 200, 250, 0.25)' }]}>
          <Text style={[styles.panelLabel, { color: THEME.colors.accentSecondary }]}>
            🧪 QUICK TIME TRIGGER TEST
          </Text>
          <Text style={styles.testSubtitle}>
            Test phone alert delivery without needing GPS or peer pairing.
          </Text>
          <View style={styles.testBtnRow}>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={() => runQuickTimeTest(60)}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.testBtnText}>⏱️ 1-Min (+60s)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={() => runQuickTimeTest(120)}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.testBtnText}>⏱️ 2-Min (+120s)</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Primary Action Button */}
        <TouchableOpacity
          style={styles.submitButton}
          onPress={submit}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.submitButtonText}>{busyStatus || 'Creating Nudgr...'}</Text>
            </View>
          ) : (
            <Text style={styles.submitButtonText}>Create Nudgr</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
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
    paddingBottom: 48,
  },
  formHeader: {
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.5,
  },
  formSubtitle: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },

  // --- Glass Panel Base ---
  glassPanel: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.card,
    padding: 18,
    marginBottom: 16,
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  panelSubLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 8,
  },

  // --- Recipient Chips ---
  recipientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  recipientChipActive: {
    backgroundColor: 'rgba(139, 124, 255, 0.15)',
    borderColor: THEME.colors.accentPrimary,
  },
  recipientAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipientAvatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  recipientName: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  recipientSub: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginTop: 1,
  },
  textActive: {
    color: '#ffffff',
  },
  checkIcon: {
    color: THEME.colors.accentPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  hintText: {
    fontSize: 12,
    color: THEME.colors.textTertiary,
    fontStyle: 'italic',
  },

  // --- Message Input ---
  messageInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: THEME.colors.textPrimary,
    minHeight: 90,
    textAlignVertical: 'top',
  },

  // --- Location Controls ---
  locationBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  locationBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  locationBtnActive: {
    backgroundColor: 'rgba(139, 124, 255, 0.16)',
    borderColor: THEME.colors.accentPrimary,
  },
  locationBtnIcon: {
    fontSize: 14,
  },
  locationBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  locationSelectedBadge: {
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  locationBadgeText: {
    fontSize: 12,
    color: '#86efac',
    fontWeight: '600',
  },

  // --- Segmented Control ---
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 11,
  },
  segmentBtnActive: {
    backgroundColor: THEME.colors.accentPrimary,
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  scheduleInfoBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    padding: 12,
    borderRadius: 12,
  },
  scheduleInfoText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },

  // --- Voice Controls ---
  voiceNoteBox: {
    marginBottom: 8,
  },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(90, 200, 250, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.3)',
    borderRadius: 14,
    paddingVertical: 12,
  },
  recordButtonIcon: {
    fontSize: 18,
  },
  recordButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.accentSecondary,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    borderRadius: 14,
    padding: 12,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: THEME.colors.danger,
    marginRight: 6,
  },
  recordingTimer: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
  },
  stopRecordBtn: {
    backgroundColor: THEME.colors.danger,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  stopRecordText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  recordedCard: {
    backgroundColor: 'rgba(48, 209, 88, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.25)',
    borderRadius: 14,
    padding: 12,
  },
  recordedLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#86efac',
    marginBottom: 8,
  },
  recordedActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  voiceActionBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  voiceActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  deleteBtn: {
    borderColor: 'rgba(255, 69, 58, 0.3)',
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
  },
  micErrorText: {
    fontSize: 12,
    color: THEME.colors.danger,
    marginTop: 6,
  },

  // --- Voice Style Horizontal Cards ---
  voiceStyleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  voiceCard: {
    width: 120,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 14,
    padding: 12,
  },
  voiceCardActive: {
    backgroundColor: 'rgba(139, 124, 255, 0.18)',
    borderColor: THEME.colors.accentPrimary,
  },
  voiceCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    marginBottom: 4,
  },
  voiceCardTitleActive: {
    color: '#ffffff',
  },
  voiceCardDesc: {
    fontSize: 11,
    color: THEME.colors.textTertiary,
    lineHeight: 14,
  },
  previewTtsBtn: {
    marginTop: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  previewTtsText: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.accentPrimary,
  },

  // --- Quick Test Panel ---
  testSubtitle: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginBottom: 10,
    lineHeight: 16,
  },
  testBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  testBtn: {
    flex: 1,
    backgroundColor: 'rgba(90, 200, 250, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.3)',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  testBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.accentSecondary,
  },

  // --- Submit & Error ---
  errorBox: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#fca5a5',
    fontWeight: '600',
  },
  submitButton: {
    ...THEME.buttonPrimary,
    borderRadius: THEME.radius.button,
    marginTop: 8,
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
