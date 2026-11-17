import { AppRegistry, NativeModules } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth, getFirestore, isQaBuild } from '../firebase';
import { isNudgeActive } from '../db/nudges';
import { scheduleAllows, REPEAT_MODE } from './geoUtils';
import { nextSenderWakeup } from '../runtime/scheduling';
import { registerGeofencesForNudges, stopSenderGeofences, evaluateSenderNudges } from './backgroundGeofence';
import { flushTriggerOutbox, pendingTriggerExpiry } from './triggerOutbox';
import { showSenderNudgeTriggeredNotification } from '../notifications/localNotifications';
import { recordRuntimeStatus } from '../diagnostics/runtimeStatus';

const KEY = isQaBuild ? '@nudgr_sender_plan_qa' : '@nudgr_sender_plan';
let plans = Promise.resolve();
export const freshLastLocation = async () => (await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 200 }))?.coords || null;

export function persistSenderPlan(uid, nudges) {
  const operation = plans.then(async () => {
    if (getAuth().currentUser?.uid !== uid) return;
    await AsyncStorage.setItem(KEY, JSON.stringify({ uid, nudges }));
    if (getAuth().currentUser?.uid !== uid) return;
    const deadline = nextSenderWakeup(nudges, Date.now(), await pendingTriggerExpiry(uid));
    await NativeModules.NudgrNativeModule?.scheduleSenderWakeup?.(deadline);
  });
  plans = operation.catch(() => {});
  return operation;
}

export function clearSenderPlan(uid) {
  const operation = plans.then(async () => {
    const plan = JSON.parse(await AsyncStorage.getItem(KEY) || 'null');
    if (plan?.uid !== uid) return;
    await AsyncStorage.removeItem(KEY);
    await NativeModules.NudgrNativeModule?.scheduleSenderWakeup?.(0);
  });
  plans = operation.catch(() => {});
  return operation;
}

export async function runScheduledSenderCheck() {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return;
  try {
    await flushTriggerOutbox(freshLastLocation, showSenderNudgeTriggeredNotification);
    const cached = JSON.parse(await AsyncStorage.getItem(KEY) || 'null');
    let nudges = cached?.uid === uid ? cached.nudges : [];
    try {
      const snapshot = await getFirestore().collection('nudges').where('senderUid', '==', uid).get();
      nudges = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (_) { /* The last owner-scoped plan can still restore physical geofences offline. */ }
    if (getAuth().currentUser?.uid !== uid) return;
    const eligible = nudges.filter(nudge => {
      if (!nudge || nudge.senderUid !== uid) return false;
      const mode = nudge.repeatMode || REPEAT_MODE.ONCE;
      const statusOk = mode === REPEAT_MODE.ONCE ? ['active', 'scheduled'].includes(nudge.status) : nudge.status !== 'cancelled';
      return statusOk && isNudgeActive(nudge) && scheduleAllows(nudge);
    });
    if (eligible.length) {
      await registerGeofencesForNudges(eligible, () => getAuth().currentUser?.uid === uid, false);
      const coords = await freshLastLocation();
      if (coords && getAuth().currentUser?.uid === uid) await evaluateSenderNudges(coords);
    } else await stopSenderGeofences(uid);
    await persistSenderPlan(uid, nudges);
    await recordRuntimeStatus('SENDER_SCHEDULE_CHECK', 'Background sender schedule evaluated');
  } catch (error) {
    await recordRuntimeStatus('SENDER_SCHEDULE_RETRY', error?.code || 'unavailable');
    if (getAuth().currentUser?.uid === uid) await NativeModules.NudgrNativeModule?.scheduleSenderWakeup?.(Date.now() + 60000);
  }
}

AppRegistry.registerHeadlessTask('NudgrSenderSchedule', () => runScheduledSenderCheck);
