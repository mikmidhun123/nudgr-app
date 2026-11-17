import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { getFirestore } from '../firebase';
import { subscribeTriggerEvents } from '../db/triggers';
import { timestampMillis } from '../runtime/incoming';

function DeliveryAttempt({ nudgeId, event }) {
  const [receipts, setReceipts] = useState([]);
  useEffect(() => getFirestore().collection('nudges').doc(nudgeId).collection('triggerEvents').doc(event.id)
    .collection('receipts').onSnapshot(snapshot => setReceipts(snapshot.docs.map(doc => doc.data())), () => setReceipts([])), [nudgeId, event.id]);
  const time = timestampMillis(event.createdAt || event.triggeredAt);
  const accepted = event.status === 'FCM_SENT' || event.fcmSuccessCount > 0;
  const transport = accepted ? `${event.fcmSuccessCount || 1} token(s) accepted by FCM`
    : event.status === 'EXPIRED' ? 'Expired before acceptance'
    : event.status === 'FCM_FAILED' ? 'Push not accepted' : 'Sending';
  const actions = receipts.map(receipt => ({ RECEIVED: 'Received on device', ANSWERED: 'Answered', DECLINED: 'Declined', MISSED: 'Missed' })[receipt.state]).filter(Boolean);
  return <View style={{ marginTop: 12 }}>
    <Text style={{ color: '#64748B', fontSize: 12 }}>{time ? new Date(time).toLocaleString() : 'Arrival'}</Text>
    <Text style={{ color: '#334155', fontSize: 13, marginTop: 4 }}>{transport}{event.deliveryPending ? ' · Retry pending' : ''}</Text>
    <Text style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>{actions.length ? actions.join(' · ') : 'No device acknowledgement yet'}</Text>
    {event.error && <Text style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>{String(event.error).replaceAll('_', ' ').toLowerCase()}</Text>}
  </View>;
}

export default function DeliveryHistory({ nudgeId }) {
  const [events, setEvents] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => subscribeTriggerEvents(nudgeId, list => { setEvents(list.slice(0, 10)); setUnavailable(false); }, () => setUnavailable(true)), [nudgeId]);
  return <View style={{ marginTop: 22, padding: 20, borderRadius: 18, backgroundColor: '#FFFFFF' }}>
    <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', letterSpacing: 1 }}>DELIVERY HISTORY</Text>
    {!events.length && <Text style={{ fontSize: 13, color: '#64748B', marginTop: 12 }}>{unavailable ? 'History is temporarily unavailable.' : 'No arrivals yet.'}</Text>}
    {events.map(event => <DeliveryAttempt key={event.id} nudgeId={nudgeId} event={event} />)}
  </View>;
}
