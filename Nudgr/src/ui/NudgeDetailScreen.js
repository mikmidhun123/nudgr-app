import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Button,
} from 'react-native';
import {
  getNudge,
  markCompleted,
  cancelNudge,
  NUDGE_STATUS,
} from '../db/nudges';
import { speakNudge, stopSpeech, VOICE_STYLES } from '../voice/tts';

const STATUS_LABEL = {
  scheduled: 'Scheduled',
  active: 'Active',
  triggered: 'Triggered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function NudgeDetailScreen({ nudgeId, isReceived, onBack }) {
  const [nudge, setNudge] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getNudge(nudgeId)
      .then((n) => {
        if (active) setNudge(n);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      stopSpeech();
    };
  }, [nudgeId]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 20 }} />
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

  const handleSpeak = () => {
    speakNudge(nudge.message, nudge.voiceStyle || 'normal');
  };

  const hasVoice = nudge.voiceStyle && nudge.voiceStyle !== 'none';
  const voiceStyleName = VOICE_STYLES[nudge.voiceStyle]?.label || 'Normal';

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Nudgr detail</Text>

      <View style={styles.card}>
        <Text style={styles.label}>{isReceived ? 'From' : 'To'}</Text>
        <Text style={styles.value}>
          {isReceived ? nudge.senderName || 'Unknown' : nudge.recipientName || 'Unknown'}
        </Text>

        <Text style={styles.label}>Message</Text>
        <Text style={styles.value}>{nudge.message}</Text>

        <Text style={styles.label}>Trigger location</Text>
        <Text style={styles.value}>
          {nudge.triggerLabel || 'Custom'}: {nudge.triggerLatitude?.toFixed(4)}, {nudge.triggerLongitude?.toFixed(4)}
        </Text>

        <Text style={styles.label}>Radius</Text>
        <Text style={styles.value}>{nudge.radiusKm?.toFixed(1)} km</Text>

        {nudge.schedule && (
          <>
            <Text style={styles.label}>Schedule</Text>
            <Text style={styles.value}>
              {nudge.schedule.afterTimeText
                ? `Only after ${nudge.schedule.afterTimeText}`
                : typeof nudge.schedule.afterHour === 'number'
                ? `Only after ${nudge.schedule.afterHour}:00`
                : nudge.schedule.activeAfter
                ? `From ${new Date(nudge.schedule.activeAfter).toLocaleDateString()}`
                : 'Active'}
            </Text>
          </>
        )}

        <Text style={styles.label}>Status</Text>
        <Text style={styles.value}>{STATUS_LABEL[nudge.status] || nudge.status}</Text>

        {hasVoice && (
          <>
            <Text style={styles.label}>Voice Style</Text>
            <Text style={styles.value}>{voiceStyleName}</Text>
            <TouchableOpacity style={styles.voiceButton} onPress={handleSpeak}>
              <Text style={styles.voiceButtonText}>🔊 Speak Nudgr</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {isReceived && nudge.status !== NUDGE_STATUS.COMPLETED && (
        <TouchableOpacity
          style={styles.doneButton}
          onPress={async () => {
            try {
              stopSpeech();
              await markCompleted(nudge.id);
              onBack();
            } catch (e) {
              Alert.alert('Could not update', 'Please try again.');
            }
          }}
        >
          <Text style={styles.doneButtonText}>Mark done</Text>
        </TouchableOpacity>
      )}

      {!isReceived && nudge.status === NUDGE_STATUS.ACTIVE && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={async () => {
            try {
              stopSpeech();
              await cancelNudge(nudge.id);
              onBack();
            } catch (e) {
              Alert.alert('Could not update', 'Please try again.');
            }
          }}
        >
          <Text style={styles.cancelButtonText}>Cancel Nudgr</Text>
        </TouchableOpacity>
      )}

      <View style={{ marginTop: 12 }}>
        <Button
          title="Back"
          onPress={() => {
            stopSpeech();
            onBack();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  heading: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  card: { backgroundColor: '#f8f9fa', padding: 14, borderRadius: 8, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: 'bold', color: '#666', marginTop: 8, textTransform: 'uppercase' },
  value: { fontSize: 16, color: '#333', marginTop: 2 },
  voiceButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 10,
    alignItems: 'center',
  },
  voiceButtonText: { color: '#fff', fontWeight: '600' },
  doneButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  doneButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelButton: {
    backgroundColor: '#c62828',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  cancelButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  hint: { fontSize: 14, color: '#888', marginTop: 12 },
});
