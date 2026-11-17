import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { getAuth, isQaBuild } from '../firebase';
import { createTriggerEvent } from '../db/triggers';
import { getNudge, isNudgeActive } from '../db/nudges';
import { calculateDistanceMeters, scheduleAllows } from './geoUtils';
import { recordRuntimeStatus } from '../diagnostics/runtimeStatus';

const KEY = isQaBuild ? '@nudgr_trigger_outbox_qa' : '@nudgr_trigger_outbox';
const TTL = 300000;
let operations = Promise.resolve();
const serial = action => { const result = operations.then(action); operations = result.catch(() => {}); return result; };
const read = async () => JSON.parse(await AsyncStorage.getItem(KEY) || '[]');
const save = entries => AsyncStorage.setItem(KEY, JSON.stringify(entries));
export const isTransientTriggerError = error => /unavailable|deadline|network|timeout|aborted/i.test(error?.code || error?.message || '');

export function queueTriggerIntent({
  uid,
  nudgeId,
  recipientUid,
  recipientName = null,
  triggerLabel = null,
  title = null,
  coords = null,
  observedAtMs = Date.now(),
}) {
  return serial(async () => {
    if (!uid || uid !== getAuth().currentUser?.uid) return;
    const entries = (await read()).filter(entry => entry.observedAtMs + TTL > Date.now());
    const previous = entries.find(entry => entry.uid === uid && entry.nudgeId === nudgeId);
    if (!previous) {
      entries.push({ uid, nudgeId, recipientUid, recipientName, triggerLabel, title, coords, observedAtMs });
    } else if (!previous.coords && coords) {
      previous.coords = coords;
    }
    await save(entries.slice(-100));
    await NativeModules.NudgrNativeModule?.scheduleSenderWakeup?.(Date.now() + 30000);
    await recordRuntimeStatus('TRIGGER_QUEUED', 'Arrival is waiting for connectivity or a fresh location', { nudgeId });
  });
}

export function removeNudgeFromOutbox(nudgeId) {
  if (!nudgeId) return Promise.resolve();
  return serial(async () => {
    const entries = (await read()).filter(entry => entry.nudgeId !== nudgeId);
    await save(entries);
  });
}

export async function pendingTriggerExpiry(uid) {
  const entries = (await read()).filter(entry => entry.uid === uid && entry.observedAtMs + TTL > Date.now());
  return entries.length ? Math.min(...entries.map(entry => entry.observedAtMs + TTL)) : 0;
}

export async function flushTriggerOutbox(resolveFreshLocation, onTriggered = null) {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return;
  for (const entry of await read()) {
    if (entry.uid !== uid) continue;
    let remove = entry.observedAtMs + TTL <= Date.now();
    if (!remove) {
      try {
        let coords = entry.coords;
        let fetchedNudge = null;
        if (!coords) {
          coords = await resolveFreshLocation();
          if (!coords) continue;
          fetchedNudge = await getNudge(entry.nudgeId);
          if (
            !fetchedNudge ||
            !isNudgeActive(fetchedNudge) ||
            !scheduleAllows(fetchedNudge) ||
            calculateDistanceMeters(coords.latitude, coords.longitude, fetchedNudge.triggerLatitude, fetchedNudge.triggerLongitude) > fetchedNudge.radiusKm * 1000
          ) {
            remove = true;
          }
        }
        if (!remove && getAuth().currentUser?.uid === uid) {
          const result = await createTriggerEvent(entry.nudgeId, {
            senderUid: uid,
            recipientUid: entry.recipientUid,
            triggerLatitude: coords.latitude,
            triggerLongitude: coords.longitude,
            observedAtMs: entry.observedAtMs,
          });
          if (result?.created && typeof onTriggered === 'function') {
            await onTriggered({
              nudgeId: entry.nudgeId,
              triggerEventId: result.id,
              recipientName: entry.recipientName || fetchedNudge?.recipientName || 'your connection',
              triggerLabel: entry.triggerLabel || fetchedNudge?.triggerLabel || '',
              title: entry.title || fetchedNudge?.title || '',
            }).catch(() => {});
          }
          remove = true;
        }
      } catch (error) {
        remove = !isTransientTriggerError(error);
      }
    } else await recordRuntimeStatus('TRIGGER_EXPIRED', 'Queued arrival expired without a send', { nudgeId: entry.nudgeId });
    if (remove) await serial(async () => save((await read()).filter(current =>
      !(current.uid === entry.uid && current.nudgeId === entry.nudgeId && current.observedAtMs === entry.observedAtMs))));
  }
}
