import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Button,
} from 'react-native';
import * as Location from 'expo-location';
import RadiusSlider from './RadiusSlider';
import TimePickerRoller from './TimePickerRoller';
import { createNudge } from '../db/nudges';
import { VOICE_STYLE_LIST, previewVoice, stopSpeech } from '../voice/tts';

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
  const [error, setError] = useState(null);

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

  const onPreview = () => {
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

  const submit = async () => {
    if (!recipientUid) {
      setError('Choose a recipient.');
      return;
    }
    if (!trigger) {
      setError('Set a trigger location.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scheduleData =
        schedule === 'afterTime'
          ? {
              afterHour: timePickerState.hour24,
              afterMinute: timePickerState.minute,
              afterTimeText: timePickerState.formattedText,
            }
          : schedule === 'tomorrow'
          ? { activeAfter: new Date(new Date().setDate(new Date().getDate() + 1)).getTime() }
          : null;

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
      });

      onCreated(created.id);
    } catch (e) {
      setError(e.message || 'Could not create Nudgr.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Create Nudgr</Text>

      <Text style={styles.label}>Recipient</Text>
      {connections.length === 0 ? (
        <Text style={styles.hint}>Connect to someone first.</Text>
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

      <Text style={styles.label}>Trigger location</Text>
      <TouchableOpacity style={styles.secondaryButton} onPress={pickLocation}>
        <Text style={styles.secondaryButtonText}>Use current location</Text>
      </TouchableOpacity>
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

      <Text style={styles.label}>Voice Alert Style (Optional Local TTS)</Text>
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
        <TouchableOpacity style={styles.previewButton} onPress={onPreview}>
          <Text style={styles.previewButtonText}>🔊 Preview Selected Voice Style</Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={submit}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create Nudgr</Text>}
      </TouchableOpacity>
      <View style={{ marginTop: 12, marginBottom: 28 }}>
        <Button title="Back" onPress={onBack} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
