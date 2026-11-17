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
  Switch,
} from 'react-native';
import * as Location from 'expo-location';
import RadiusSlider from './RadiusSlider';
import TimePickerRoller from './TimePickerRoller';
import LocationPickerModal from './LocationPickerModal';
import WaveformBars from './WaveformBars';
import AmbientBackground from './AmbientBackground';
import {
  createNudge,
  updateNudgeDetails,
  NUDGE_REPEAT_MODE,
} from '../db/nudges';
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
import {
  getVoiceUploadUrl,
  uploadVoiceNoteToR2,
  deleteVoiceNote,
} from '../voice/r2Storage';
import { scheduleNudgeTimeAlarm } from '../notifications/localNotifications';

const WEEKDAY_ITEMS = [
  { day: 0, short: 'S', name: 'Sun' },
  { day: 1, short: 'M', name: 'Mon' },
  { day: 2, short: 'T', name: 'Tue' },
  { day: 3, short: 'W', name: 'Wed' },
  { day: 4, short: 'T', name: 'Thu' },
  { day: 5, short: 'F', name: 'Fri' },
  { day: 6, short: 'S', name: 'Sat' },
];

const COOLDOWN_PRESETS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hr' },
  { minutes: 120, label: '2 hrs' },
  { minutes: 240, label: '4 hrs' },
];

function hour24ToTimeState(h24 = 18, m = 0) {
  const period = h24 >= 12 ? 'PM' : 'AM';
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  const formattedMin = m < 10 ? `0${m}` : `${m}`;
  return {
    hour12,
    minute: m,
    period,
    hour24: h24,
    formattedText: `${hour12}:${formattedMin} ${period}`,
  };
}

export default function CreateNudgeScreen({
  connections = [],
  initialNudge = null,
  onCreated,
  onBack,
}) {
  const isEditing = Boolean(initialNudge?.id);
  connections = connections.filter((connection) => connection.verified === true);

  const [recipientUid, setRecipientUid] = useState(initialNudge?.recipientUid || null);
  const [title, setTitle] = useState(initialNudge?.title || '');
  const [message, setMessage] = useState(initialNudge?.message || '');
  const [trigger, setTrigger] = useState(
    initialNudge && typeof initialNudge.triggerLatitude === 'number'
      ? {
          latitude: initialNudge.triggerLatitude,
          longitude: initialNudge.triggerLongitude,
          label: initialNudge.triggerLabel || 'Pinned Location',
        }
      : null
  );
  const [radiusKm, setRadiusKm] = useState(initialNudge?.radiusKm || 5.0);
  const [mapModalVisible, setMapModalVisible] = useState(false);

  // Repeat Preference ('once' | 'once_per_day' | 'multiple_per_day')
  const [repeatMode, setRepeatMode] = useState(
    initialNudge?.repeatMode || NUDGE_REPEAT_MODE.ONCE_PER_DAY
  );
  const [cooldownMinutes, setCooldownMinutes] = useState(
    initialNudge?.cooldownMinutes || 30
  );
  const [requireExitBeforeRetrigger, setRequireExitBeforeRetrigger] = useState(
    initialNudge?.requireExitBeforeRetrigger !== false
  );

  // Schedule & Active Days
  const initialSched = initialNudge?.schedule || null;
  const [schedule, setSchedule] = useState(() => {
    if (!initialSched) return 'none';
    if (typeof initialSched.endHour === 'number') return 'window';
    if (typeof initialSched.startHour === 'number' || typeof initialSched.afterHour === 'number') return 'afterTime';
    if (typeof initialSched.activeAfter === 'number') return 'tomorrow';
    return 'none';
  });
  const [daysOfWeek, setDaysOfWeek] = useState(
    Array.isArray(initialSched?.daysOfWeek) ? initialSched.daysOfWeek : []
  );
  const [timePickerState, setTimePickerState] = useState(() =>
    hour24ToTimeState(
      initialSched?.startHour ?? initialSched?.afterHour ?? 18,
      initialSched?.startMinute ?? initialSched?.afterMinute ?? 0
    )
  );
  const [endTimePickerState, setEndTimePickerState] = useState(() =>
    hour24ToTimeState(initialSched?.endHour ?? 22, initialSched?.endMinute ?? 0)
  );

  const [voiceStyle, setVoiceStyle] = useState(initialNudge?.voiceStyle || 'normal');
  const [existingVoiceNote, setExistingVoiceNote] = useState(initialNudge?.voiceNote || null);
  const [busy, setBusy] = useState(false);
  const [busyStatus, setBusyStatus] = useState(null);
  const [error, setError] = useState(null);

  // Voice Note Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedVoice, setRecordedVoice] = useState(null);
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
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
      if (loc && loc.coords) {
        let label = 'My current location';
        try {
          const rev = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          if (rev && rev.length > 0) {
            const p = rev[0];
            const parts = [p.name || p.street, p.district || p.city].filter(Boolean);
            if (parts.length > 0) label = parts.slice(0, 2).join(', ');
          }
        } catch (_) {}

        setTrigger({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          label,
        });
        setError(null);
      } else {
        setError('Could not retrieve coordinates. Check GPS and try again.');
      }
    } catch (e) {
      setError('Could not get your location. Check GPS and try again.');
    }
  };

  const toggleDayOfWeek = (day) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const selectDayPreset = (preset) => {
    if (preset === 'all') setDaysOfWeek([]);
    else if (preset === 'weekdays') setDaysOfWeek([1, 2, 3, 4, 5]);
    else if (preset === 'weekends') setDaysOfWeek([0, 6]);
  };

  const onPreviewTTS = () => {
    if (voiceStyle === 'none') {
      stopSpeech();
      return;
    }
    const sample = message.trim() ? message.trim() : null;
    previewVoice(voiceStyle, sample);
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
      const started = await startRecording({
        onDurationUpdate: (seconds) => {
          setRecordingSeconds(seconds);
        },
        onMaxDurationReached: (result) => {
          setIsRecording(false);
          setRecordedVoice(result);
        },
      });
      if (started) setIsRecording(true);
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
    setExistingVoiceNote(null);
    setIsPlayingPreview(false);
    setRecordingSeconds(0);
  };

  const buildSchedulePayload = () => {
    const out = {};
    if (daysOfWeek.length > 0 && daysOfWeek.length < 7) {
      out.daysOfWeek = daysOfWeek;
    }

    if (schedule === 'afterTime') {
      out.type = 'TIME';
      out.startHour = timePickerState.hour24;
      out.startMinute = timePickerState.minute;
      out.afterHour = timePickerState.hour24;
      out.afterMinute = timePickerState.minute;
      out.afterTimeText = timePickerState.formattedText;
    } else if (schedule === 'window') {
      out.type = 'WINDOW';
      out.startHour = timePickerState.hour24;
      out.startMinute = timePickerState.minute;
      out.afterHour = timePickerState.hour24;
      out.afterMinute = timePickerState.minute;
      out.endHour = endTimePickerState.hour24;
      out.endMinute = endTimePickerState.minute;
      out.afterTimeText = `${timePickerState.formattedText} – ${endTimePickerState.formattedText}`;
    } else if (schedule === 'tomorrow') {
      const tomorrowStart = new Date();
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      tomorrowStart.setHours(0, 0, 0, 0);
      out.activeAfter = tomorrowStart.getTime();
    }

    return Object.keys(out).length > 0 ? out : null;
  };

  const submitWithData = async (voiceNotePayload = null) => {
    const scheduleData = buildSchedulePayload();

    if (recipientUid === 'self_test') {
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
          'Time Trigger Test Scheduled!',
          `Trigger scheduled for ${res.targetTime} (${res.secondsInFuture}s from now).\n\nLock your phone now and wait for notification!`,
          [{ text: 'OK', onPress: onBack }]
        );
      } else {
        setError(res?.error || 'Failed to schedule test alarm.');
      }
      return;
    }

    if (isEditing && initialNudge?.id) {
      const previousKey = initialNudge.voiceNote?.storageKey;
      const finalVoiceNote = voiceNotePayload !== null ? voiceNotePayload : existingVoiceNote;
      await updateNudgeDetails(initialNudge.id, {
        title,
        message,
        triggerLatitude: trigger.latitude,
        triggerLongitude: trigger.longitude,
        triggerLabel: trigger.label,
        radiusKm,
        schedule: scheduleData,
        repeatMode,
        cooldownMinutes,
        requireExitBeforeRetrigger,
        voiceStyle: voiceStyle || 'normal',
        voiceNote: finalVoiceNote,
      });

      // If sender replaced or deleted an older R2 voice recording during edit, clean it up
      if (previousKey && previousKey !== finalVoiceNote?.storageKey) {
        await deleteVoiceNote(previousKey, initialNudge.id).catch(() => {});
      }

      await discardRecording();
      onCreated(initialNudge.id);
      return;
    }

    const peer = connections.find((c) => c.otherUid === recipientUid);
    const created = await createNudge({
      recipientUid,
      recipientName: peer?.profile?.displayName || peer?.profile?.email || null,
      title,
      message,
      triggerLatitude: trigger.latitude,
      triggerLongitude: trigger.longitude,
      triggerLabel: trigger.label,
      radiusKm,
      schedule: scheduleData,
      repeatMode,
      cooldownMinutes,
      requireExitBeforeRetrigger,
      voiceStyle: voiceStyle || 'normal',
      voiceNote: voiceNotePayload,
    });

    await discardRecording();
    onCreated(created.id);
  };

  const submit = async () => {
    if (!recipientUid) {
      setError('Choose a recipient.');
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
    if (recipientUid !== 'self_test' && !trigger) {
      setError('Set a trigger location for this recipient.');
      return;
    }

    setBusy(true);
    setError(null);

    if (recordedVoice && recordedVoice.uri) {
      setBusyStatus('Uploading voice note to Cloudflare R2...');
      try {
        const { uploadUrl, storageKey } = await getVoiceUploadUrl(initialNudge?.id || null, {
          durationMs: recordedVoice.durationMs,
          sizeBytes: recordedVoice.sizeBytes,
          mimeType: recordedVoice.mimeType,
        });

        await uploadVoiceNoteToR2(uploadUrl, recordedVoice.uri, recordedVoice.mimeType);

        setBusyStatus(isEditing ? 'Updating Nudgr...' : 'Creating Nudgr...');
        const voiceNotePayload = {
          enabled: true,
          storageKey,
          durationMs: recordedVoice.durationMs,
          sizeBytes: recordedVoice.sizeBytes,
          mimeType: recordedVoice.mimeType || 'audio/m4a',
        };

        try {
          await submitWithData(voiceNotePayload);
        } catch (saveErr) {
          // Clean up the newly uploaded R2 object so it is never orphaned
          if (storageKey) {
            await deleteVoiceNote(storageKey, null).catch(() => {});
          }
          setError(saveErr.message || 'Could not save Nudgr.');
        } finally {
          setBusy(false);
          setBusyStatus(null);
        }
      } catch (uploadErr) {
        setBusy(false);
        setBusyStatus(null);

        Alert.alert(
          'Voice Note Upload Failed',
          `${uploadErr.message || 'Could not upload audio to Cloudflare R2.'}\n\nContinue using Text-to-Speech?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Continue with TTS',
              onPress: async () => {
                setBusy(true);
                setBusyStatus('Saving Nudgr with TTS...');
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
      setBusyStatus(isEditing ? 'Updating Nudgr...' : 'Creating Nudgr...');
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
      <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" />
      <AmbientBackground />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>{isEditing ? 'Edit Nudgr' : 'New Nudgr'}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Page Header ── */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{isEditing ? 'Edit Location Alarm' : 'Create a Nudgr'}</Text>
          <Text style={styles.pageSubtitle}>
            Pin a location, choose your geofence area, and set when it should ring.
          </Text>
        </View>

        {/* ── 1. Recipient Panel ── */}
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <View style={styles.panelLabelDot} />
            <Text style={styles.panelLabel}>CONNECTED PERSON</Text>
          </View>

          {connections.length === 0 ? (
            <Text style={styles.hintText}>
              No verified connections yet. Pair with a person in "My Connection" first.
            </Text>
          ) : (
            connections.map((c) => {
              const name =
                c.profile?.displayName ||
                (c.profile?.email ? c.profile.email.split('@')[0] : null) ||
                `Peer (${(c.otherUid || '').slice(0, 6)})`;
              const isSelected = recipientUid === c.otherUid;
              return (
                <TouchableOpacity
                  key={c.otherUid}
                  style={[styles.recipientChip, isSelected && styles.recipientChipActive]}
                  onPress={() => !isEditing && setRecipientUid(c.otherUid)}
                  disabled={isEditing}
                  activeOpacity={0.8}
                >
                  <View style={[styles.recipientAvatar, styles.recipientAvatarPeer]}>
                    <Text style={[styles.recipientAvatarInitial, { color: '#6366F1' }]}>
                      {name[0].toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.recipientName, isSelected && styles.recipientNameActive]}>
                      {name}
                    </Text>
                    <Text style={styles.recipientSub}>{c.status || 'Connected'}</Text>
                  </View>
                  {isSelected && (
                    <View style={styles.selectedBadge}>
                      <Text style={styles.selectedBadgeText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* ── 2. Alarm Title & Message Panel ── */}
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <View style={[styles.panelLabelDot, { backgroundColor: '#10B981' }]} />
            <Text style={styles.panelLabel}>ALARM LABEL & MESSAGE</Text>
          </View>
          <TextInput
            style={styles.titleInput}
            placeholder="Alarm label (optional, e.g. Arriving Home, Office)"
            placeholderTextColor="#94A3B8"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
          <TextInput
            style={styles.messageInput}
            placeholder="e.g. I'm almost home, get the kettle on!"
            placeholderTextColor="#94A3B8"
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* ── 3. Pin Location & Geofence Radius Panel ── */}
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <View style={[styles.panelLabelDot, { backgroundColor: '#6366F1' }]} />
            <Text style={styles.panelLabel}>PIN LOCATION & GEOFENCE AREA</Text>
          </View>

          <View style={styles.locationBtnRow}>
            <TouchableOpacity
              style={[styles.locationBtn, styles.locationBtnPrimary]}
              onPress={() => setMapModalVisible(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.locationBtnIcon}>🗺️</Text>
              <Text style={[styles.locationBtnText, { color: '#6366F1' }]}>
                {trigger ? 'Adjust Pin on Map' : 'Pin on Map'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.locationBtn,
                trigger?.label === 'My current location' && styles.locationBtnActive,
              ]}
              onPress={pickLocation}
              activeOpacity={0.8}
            >
              <Text style={styles.locationBtnIcon}>📍</Text>
              <Text style={styles.locationBtnText}>Current GPS</Text>
            </TouchableOpacity>
          </View>

          {trigger && (
            <TouchableOpacity
              style={styles.locationSelectedCard}
              onPress={() => setMapModalVisible(true)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.locationSelectedTitle}>
                  {trigger.label || 'Pinned Destination'}
                </Text>
                <Text style={styles.locationSelectedCoords}>
                  {trigger.latitude.toFixed(5)}, {trigger.longitude.toFixed(5)} · Tap to view map
                </Text>
              </View>
              <Text style={styles.locationEditBadge}>Edit Pin ›</Text>
            </TouchableOpacity>
          )}

          <RadiusSlider value={radiusKm} onChange={setRadiusKm} />
        </View>

        {/* ── 4. Repeat Preference (Multiple Visits / Daily / Once) ── */}
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <View style={[styles.panelLabelDot, { backgroundColor: '#8B5CF6' }]} />
            <Text style={styles.panelLabel}>REPEAT FREQUENCY (PER VISIT / DAY)</Text>
          </View>
          <Text style={styles.panelHelperText}>
            Choose how this Nudgr behaves when you visit the pinned place multiple times:
          </Text>

          {[
            {
              key: NUDGE_REPEAT_MODE.ONCE_PER_DAY,
              title: 'Once a day',
              desc: 'Rings at most once per calendar day, then re-arms automatically for the next day.',
              badge: '1× / day',
            },
            {
              key: NUDGE_REPEAT_MODE.MULTIPLE_PER_DAY,
              title: 'Multiple times a day',
              desc: 'Rings each time you arrive at this location (after leaving and cooldown).',
              badge: 'Multi',
            },
            {
              key: NUDGE_REPEAT_MODE.ONCE,
              title: 'One-time only',
              desc: 'Rings once on your next arrival and turns off until manually re-armed.',
              badge: '1× total',
            },
          ].map((opt) => {
            const active = repeatMode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.repeatOptionCard, active && styles.repeatOptionCardActive]}
                onPress={() => setRepeatMode(opt.key)}
                activeOpacity={0.82}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.repeatTitleRow}>
                    <Text style={[styles.repeatOptionTitle, active && styles.repeatOptionTitleActive]}>
                      {opt.title}
                    </Text>
                    <View style={[styles.repeatBadge, active && styles.repeatBadgeActive]}>
                      <Text style={[styles.repeatBadgeText, active && styles.repeatBadgeTextActive]}>
                        {opt.badge}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.repeatOptionDesc}>{opt.desc}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {repeatMode === NUDGE_REPEAT_MODE.MULTIPLE_PER_DAY && (
            <View style={styles.multiConfigBox}>
              <Text style={styles.subConfigLabel}>MINIMUM COOLDOWN BETWEEN RINGS</Text>
              <View style={styles.cooldownChipRow}>
                {COOLDOWN_PRESETS.map((item) => {
                  const selected = cooldownMinutes === item.minutes;
                  return (
                    <TouchableOpacity
                      key={item.minutes}
                      style={[styles.cooldownChip, selected && styles.cooldownChipActive]}
                      onPress={() => setCooldownMinutes(item.minutes)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.cooldownChipText, selected && styles.cooldownChipTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.exitToggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.exitToggleTitle}>Require leaving area before re-ringing</Text>
                  <Text style={styles.exitToggleDesc}>
                    Prevents repeated alerts while staying inside the geofence.
                  </Text>
                </View>
                <Switch
                  value={requireExitBeforeRetrigger}
                  onValueChange={setRequireExitBeforeRetrigger}
                  trackColor={{ false: '#E2E8F0', true: '#C7D2FE' }}
                  thumbColor={requireExitBeforeRetrigger ? '#6366F1' : '#94A3B8'}
                />
              </View>
            </View>
          )}
        </View>

        {/* ── 5. When Should This Nudgr Work (Days & Time Window) ── */}
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <View style={[styles.panelLabelDot, { backgroundColor: '#F59E0B' }]} />
            <Text style={styles.panelLabel}>WHEN SHOULD IT WORK (DAYS & TIME)</Text>
          </View>

          {/* Active Days of Week */}
          <View style={styles.daysHeaderRow}>
            <Text style={styles.subConfigLabel}>ACTIVE DAYS</Text>
            <View style={styles.dayPresetsRow}>
              <TouchableOpacity onPress={() => selectDayPreset('all')} style={styles.dayPresetBtn}>
                <Text style={styles.dayPresetText}>Every day</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => selectDayPreset('weekdays')} style={styles.dayPresetBtn}>
                <Text style={styles.dayPresetText}>Weekdays</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => selectDayPreset('weekends')} style={styles.dayPresetBtn}>
                <Text style={styles.dayPresetText}>Weekends</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAY_ITEMS.map((item) => {
              const isSelected = daysOfWeek.length === 0 || daysOfWeek.includes(item.day);
              return (
                <TouchableOpacity
                  key={item.day}
                  style={[styles.weekdayCircle, isSelected && styles.weekdayCircleActive]}
                  onPress={() => toggleDayOfWeek(item.day)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.weekdayText, isSelected && styles.weekdayTextActive]}>
                    {item.short}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Time Window Segmented Control */}
          <Text style={[styles.subConfigLabel, { marginTop: 14, marginBottom: 8 }]}>
            TIME CONDITION
          </Text>
          <View style={styles.segmentedContainer}>
            {[
              { key: 'none', label: 'Any Time' },
              { key: 'afterTime', label: 'After Time' },
              { key: 'window', label: 'Time Window' },
              { key: 'tomorrow', label: 'Tomorrow' },
            ].map((seg) => (
              <TouchableOpacity
                key={seg.key}
                style={[styles.segmentBtn, schedule === seg.key && styles.segmentBtnActive]}
                onPress={() => setSchedule(seg.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, schedule === seg.key && styles.segmentTextActive]}>
                  {seg.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {schedule === 'afterTime' && (
            <TimePickerRoller
              hour12={timePickerState.hour12}
              minute={timePickerState.minute}
              period={timePickerState.period}
              onChange={setTimePickerState}
            />
          )}

          {schedule === 'window' && (
            <View>
              <Text style={styles.windowSubHeader}>START TIME (FROM)</Text>
              <TimePickerRoller
                hour12={timePickerState.hour12}
                minute={timePickerState.minute}
                period={timePickerState.period}
                onChange={setTimePickerState}
              />
              <Text style={[styles.windowSubHeader, { marginTop: 10 }]}>END TIME (UNTIL)</Text>
              <TimePickerRoller
                hour12={endTimePickerState.hour12}
                minute={endTimePickerState.minute}
                period={endTimePickerState.period}
                onChange={setEndTimePickerState}
              />
            </View>
          )}

          {schedule === 'tomorrow' && (
            <View style={styles.scheduleInfoBox}>
              <Text style={styles.scheduleInfoText}>
                Activates starting tomorrow at 12:00 AM local time.
              </Text>
            </View>
          )}
        </View>

        {/* ── 6. Voice & Audio Panel ── */}
        <View style={styles.panel}>
          <View style={styles.panelLabelRow}>
            <View style={[styles.panelLabelDot, { backgroundColor: '#EC4899' }]} />
            <Text style={styles.panelLabel}>VOICE RECORDING OR TTS</Text>
          </View>

          {/* Voice Note Recorder */}
          <View style={styles.voiceNoteBox}>
            {!isRecording && !recordedVoice && !existingVoiceNote?.storageKey && (
              <TouchableOpacity
                style={styles.recordButton}
                onPress={handleStartRecord}
                activeOpacity={0.85}
              >
                <View style={styles.recordButtonIcon}>
                  <Text style={styles.recordButtonIconGlyph}>🎙️</Text>
                </View>
                <Text style={styles.recordButtonText}>Record Personal Voice Note</Text>
              </TouchableOpacity>
            )}

            {isRecording && (
              <View style={styles.recordingRow}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingTimer}>
                  {formatTimer(recordingSeconds)} / 01:00
                </Text>
                <WaveformBars active={true} barCount={12} color="#EF4444" maxHeight={20} />
                <TouchableOpacity
                  style={styles.stopRecordBtn}
                  onPress={handleStopRecord}
                  activeOpacity={0.8}
                >
                  <Text style={styles.stopRecordText}>Stop</Text>
                </TouchableOpacity>
              </View>
            )}

            {(recordedVoice || existingVoiceNote?.storageKey) && !isRecording && (
              <View style={styles.recordedCard}>
                <View style={styles.recordedHeader}>
                  <View style={styles.recordedCheckIcon}>
                    <Text style={styles.recordedCheckGlyph}>✓</Text>
                  </View>
                  <Text style={styles.recordedLabel}>
                    {recordedVoice
                      ? `Voice note ready — ${Math.round(recordedVoice.durationMs / 1000)}s`
                      : `Saved R2 voice note — ${Math.round((existingVoiceNote.durationMs || 5000) / 1000)}s`}
                  </Text>
                </View>
                {isPlayingPreview && (
                  <WaveformBars active={true} barCount={18} color="#059669" maxHeight={20} style={{ marginVertical: 4 }} />
                )}
                <View style={styles.recordedActionRow}>
                  {recordedVoice && (
                    isPlayingPreview ? (
                      <TouchableOpacity style={styles.voiceActionBtn} onPress={handleStopPreview}>
                        <Text style={styles.voiceActionText}>Stop</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.voiceActionBtn} onPress={handlePlayPreview}>
                        <Text style={styles.voiceActionText}>Play</Text>
                      </TouchableOpacity>
                    )
                  )}
                  <TouchableOpacity style={styles.voiceActionBtn} onPress={handleStartRecord}>
                    <Text style={styles.voiceActionText}>Re-record</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.voiceActionBtn, styles.deleteBtnStyle]}
                    onPress={handleDeleteVoice}
                  >
                    <Text style={[styles.voiceActionText, { color: '#DC2626' }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {micError && <Text style={styles.micErrorText}>{micError}</Text>}
          </View>

          {/* TTS Style Selector */}
          <Text style={styles.panelSubLabel}>TEXT-TO-SPEECH FALLBACK / VOICE STYLE</Text>
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
              <Text style={styles.previewTtsText}>Preview Selected TTS Voice</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Error ── */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ── Submit Button ── */}
        <TouchableOpacity
          style={styles.submitButton}
          onPress={submit}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.submitButtonText}>{busyStatus || 'Saving Nudgr...'}</Text>
            </View>
          ) : (
            <Text style={styles.submitButtonText}>
              {isEditing ? 'Save Changes' : 'Create Nudgr'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Interactive Map Picker Modal */}
      <LocationPickerModal
        visible={mapModalVisible}
        initialTrigger={trigger}
        radiusKm={radiusKm}
        onRadiusChange={setRadiusKm}
        onClose={() => setMapModalVisible(false)}
        onConfirm={(picked) => {
          setTrigger({
            latitude: picked.latitude,
            longitude: picked.longitude,
            label: picked.label,
          });
          if (typeof picked.radiusKm === 'number') {
            setRadiusKm(picked.radiusKm);
          }
          setError(null);
          setMapModalVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F7FC',
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 20,
    marginBottom: 4,
  },
  headerTitleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 25,
  },
  backArrow: {
    fontSize: 26,
    color: '#0F172A',
    fontWeight: '300',
    lineHeight: 28,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
  },
  pageHeader: {
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 20,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 26,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  panelLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  panelLabelDot: {
    width: 4,
    height: 14,
    borderRadius: 2,
    backgroundColor: '#6366F1',
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.1,
  },
  panelHelperText: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
    lineHeight: 18,
  },
  panelSubLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.0,
    marginTop: 16,
    marginBottom: 10,
  },
  recipientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  recipientChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  recipientAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipientAvatarPeer: {
    backgroundColor: '#EEF2FF',
  },
  recipientAvatarInitial: {
    fontSize: 16,
    fontWeight: '800',
    color: '#6366F1',
  },
  recipientName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  recipientNameActive: {
    color: '#6366F1',
  },
  recipientSub: {
    fontSize: 12,
    color: '#64748B',
  },
  selectedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  hintText: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  titleInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 10,
  },
  messageInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#0F172A',
    minHeight: 90,
    textAlignVertical: 'top',
  },
  locationBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  locationBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 8,
  },
  locationBtnPrimary: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  locationBtnActive: {
    backgroundColor: '#ECFDF5',
    borderColor: 'rgba(167, 243, 208, 0.9)',
  },
  locationBtnIcon: {
    fontSize: 15,
  },
  locationBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  locationSelectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.85)',
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  locationSelectedTitle: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '700',
  },
  locationSelectedCoords: {
    fontSize: 12,
    color: '#047857',
    marginTop: 2,
  },
  locationEditBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },
  repeatOptionCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  repeatOptionCardActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  repeatTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  repeatOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  repeatOptionTitleActive: {
    color: '#6366F1',
  },
  repeatBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
  },
  repeatBadgeActive: {
    backgroundColor: '#6366F1',
  },
  repeatBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  repeatBadgeTextActive: {
    color: '#FFFFFF',
  },
  repeatOptionDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
  },
  multiConfigBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    padding: 14,
    marginTop: 4,
  },
  subConfigLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 1.0,
    marginBottom: 8,
  },
  cooldownChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  cooldownChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
  },
  cooldownChipActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  cooldownChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  cooldownChipTextActive: {
    color: '#FFFFFF',
  },
  exitToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
  },
  exitToggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  exitToggleDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  daysHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dayPresetsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayPresetBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dayPresetText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6366F1',
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  weekdayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayCircleActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  weekdayText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  weekdayTextActive: {
    color: '#FFFFFF',
  },
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#EEF2FF',
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 14,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 12,
  },
  segmentBtnActive: {
    backgroundColor: '#6366F1',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  segmentText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  windowSubHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6366F1',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  scheduleInfoBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  scheduleInfoText: {
    fontSize: 13,
    color: '#64748B',
  },
  voiceNoteBox: {
    marginBottom: 16,
  },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 18,
    paddingVertical: 14,
  },
  recordButtonIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonIconGlyph: {
    fontSize: 18,
  },
  recordButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6366F1',
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.9)',
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recordingTimer: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
  stopRecordBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  stopRecordText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  recordedCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.85)',
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  recordedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordedCheckIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordedCheckGlyph: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '900',
  },
  recordedLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
    flex: 1,
  },
  recordedActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  voiceActionBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  voiceActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  deleteBtnStyle: {
    borderColor: 'rgba(254, 202, 202, 0.8)',
    backgroundColor: '#FEF2F2',
  },
  micErrorText: {
    fontSize: 12,
    color: '#DC2626',
    marginTop: 8,
  },
  voiceStyleRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 2,
  },
  voiceCard: {
    width: 122,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 14,
  },
  voiceCardActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  voiceCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  voiceCardTitleActive: {
    color: '#6366F1',
  },
  voiceCardDesc: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },
  previewTtsBtn: {
    marginTop: 14,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  previewTtsText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6366F1',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.8)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: '#6366F1',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
    marginTop: 8,
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
