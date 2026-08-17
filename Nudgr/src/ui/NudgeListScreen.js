import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {
  subscribeSentNudges,
  subscribeReceivedNudges,
  NUDGE_STATUS,
} from '../db/nudges';

const STATUS_LABEL = {
  scheduled: 'Scheduled',
  active: 'Active',
  triggered: 'Triggered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function NudgeListScreen({ uid, onOpenNudge, onBack }) {
  const [sent, setSent] = useState([]);
  const [received, setReceived] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const renderNudge = (n, isReceived) => (
    <TouchableOpacity
      key={n.id}
      style={styles.card}
      onPress={() => onOpenNudge(n.id, isReceived)}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>
          {isReceived ? `From: ${n.senderName || 'Unknown'}` : `To: ${n.recipientName || 'Unknown'}`}
        </Text>
        <Text style={[styles.status, statusColor(n.status)]}>{STATUS_LABEL[n.status] || n.status}</Text>
      </View>
      <Text style={styles.message} numberOfLines={2}>
        {n.message}
      </Text>
      <Text style={styles.meta}>
        Radius: {n.radiusKm?.toFixed(1)} km{n.schedule?.afterTimeText ? ` • ⏰ After ${n.schedule.afterTimeText}` : ''}{n.voiceStyle && n.voiceStyle !== 'none' ? ` • 🔊 ${n.voiceStyle}` : ''}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>My Nudgrs</Text>
      {loading && <ActivityIndicator style={{ marginVertical: 12 }} />}

      {received.length > 0 && (
        <>
          <Text style={styles.section}>Received</Text>
          {received.map((n) => renderNudge(n, true))}
        </>
      )}

      <Text style={styles.section}>Sent</Text>
      {sent.length === 0 ? (
        <Text style={styles.hint}>No Nudgrs sent yet.</Text>
      ) : (
        sent.map((n) => renderNudge(n, false))
      )}

      <View style={{ marginTop: 12 }}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function statusColor(status) {
  switch (status) {
    case NUDGE_STATUS.TRIGGERED:
      return styles.statusTriggered;
    case NUDGE_STATUS.ACTIVE:
    case NUDGE_STATUS.SCHEDULED:
      return styles.statusActive;
    case NUDGE_STATUS.COMPLETED:
      return styles.statusDone;
    default:
      return styles.statusActive;
  }
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  heading: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  section: { fontSize: 15, fontWeight: '700', color: '#555', marginTop: 12, marginBottom: 6 },
  hint: { fontSize: 13, color: '#888', marginBottom: 8 },
  card: {
    backgroundColor: '#f8f9fa',
    padding: 14,
    borderRadius: 8,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  status: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusActive: { backgroundColor: '#e3f2fd', color: '#1565c0' },
  statusTriggered: { backgroundColor: '#ffe0b2', color: '#e65100' },
  statusDone: { backgroundColor: '#e8f5e9', color: '#2e7d32' },
  message: { fontSize: 14, color: '#444', marginTop: 6 },
  meta: { fontSize: 12, color: '#888', marginTop: 6 },
  backButton: { backgroundColor: '#2e7d32', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  backButtonText: { color: '#fff', fontWeight: '600' },
});
