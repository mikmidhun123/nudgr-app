import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Platform, BackHandler, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { attachFirebaseFoundation, getAuth } from './src/firebase';
import { createSessionManager } from './src/runtime/session';
import { parseIncoming, timestampMillis, DELIVERY_TTL_MS } from './src/runtime/incoming';
import { getLatestTriggerEvent } from './src/db/triggers';
import { stopNudgeMessage } from './src/voice/playback';
import './src/location/scheduledSender';
import './src/location/backgroundGeofence'; // registers the background task at load
import {
  setupNotificationChannels,
  checkAndRequestNotificationPermissions,
  showIncomingNudgeNotification,
  dismissIncomingNudgeNotification,
} from './src/notifications/localNotifications';
import { ensureUserProfile, subscribeUserProfile } from './src/db/users';
import {
  syncFcmToken,
  removeFcmToken,
  attachFcmTokenRefresh,
} from './src/fcm/tokens';
import { attachFcmListeners } from './src/fcm/delivery';
import { startTriggerEngine } from './src/location/triggerEngine';
import {
  getInitialNativeAction,
  clearNativeAccountState,
  flushNativeReceipts,
  setNativeLockscreenAllowed,
  clearInitialNativeAction,
  showNativeIncomingNotification,
  recordNativeIncoming,
  addNativeActionListener,
} from './src/notifications/nativeNotificationBridge';
import { getNudge, subscribeReceivedNudges, NUDGE_STATUS } from './src/db/nudges';
import ErrorBoundary from './src/ui/ErrorBoundary';
import AuthScreen from './src/ui/AuthScreen';
import HomeScreen from './src/ui/HomeScreen';
import CreateNudgeScreen from './src/ui/CreateNudgeScreen';
import NudgeListScreen from './src/ui/NudgeListScreen';
import NudgeDetailScreen from './src/ui/NudgeDetailScreen';
import IncomingNudge from './src/ui/IncomingNudge';
import ProfileScreen from './src/ui/ProfileScreen';
import MyConnectionScreen from './src/ui/MyConnectionScreen';
import { getActiveRingingState, getIncomingState, setIncomingState, INCOMING_STATES } from './src/notifications/incomingState';
import { recordRuntimeStatus } from './src/diagnostics/runtimeStatus';

// Register background message handler at module scope for headless FCM wakeups.
// This MUST execute before any React component mounts.
// Android service and headless JS share one native poster, so an asynchronous
// Expo post cannot replace the call actions/full-screen intent.
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  try {
    console.log('[FCM_BACKGROUND_RECEIVED] Background message handler started');
    const data = parseIncoming(remoteMessage?.data, getAuth().currentUser?.uid, remoteMessage?.sentTime);
    if (!data) return;
    const { nudgeId, senderName, message } = data;
    await recordRuntimeStatus('FCM_RECEIVED_BACKGROUND', 'Background FCM message received', { nudgeId });

    if (nudgeId) {
      const nativeHandled = typeof showNativeIncomingNotification === 'function'
        ? await showNativeIncomingNotification({ ...data, triggerId: data.triggerEventId })
        : null;
      if (nativeHandled !== null) {
        console.log(`[FCM_HANDLER_NATIVE] nudgeId=${nudgeId} handled=${nativeHandled}`);
        await recordRuntimeStatus('INCOMING_NOTIFICATION', nativeHandled ? 'Incoming handled by Android native poster' : 'Android notification blocked', { nudgeId });
      } else {
        console.log(`[FCM_HANDLER_STARTED] nudgeId=${nudgeId} creating fallback local notification with actions`);
        const notifId = await showIncomingNudgeNotification({
          nudgeId,
          senderName,
          message,
          replaceNativeNotification: Platform.OS === 'android' && !!remoteMessage?.notification,
        });
        console.log(`[FCM_NOTIFICATION_CREATED] nudgeId=${nudgeId} notificationId=${notifId || 'FAILED'}`);
        await recordRuntimeStatus('INCOMING_NOTIFICATION', notifId ? 'Call-style incoming notification posted' : 'Incoming notification failed', { nudgeId, notificationId: notifId });
      }
    } else {
      console.warn('[FCM_RECEIVED_BACKGROUND] No nudgeId in background message data');
    }
  } catch (err) {
    console.error(`[FCM_HANDLER_FAILED] Background handler error: ${err.message}`);
    await recordRuntimeStatus('FCM_BACKGROUND_FAILED', err.message);
  }
});

function NudgrApp() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);
  const [navStack, setNavStack] = useState([{ name: 'home' }]);
  const navStackRef = useRef(navStack);
  const lastNavTimeRef = useRef(0);

  useEffect(() => {
    navStackRef.current = navStack;
  }, [navStack]);

  const currentRoute = navStack[navStack.length - 1] || { name: 'home' };
  const screen = currentRoute.name;
  const detail = currentRoute.params;

  const navigate = useCallback((name, params = null) => {
    const now = Date.now();
    if (now - lastNavTimeRef.current < 250) return;
    lastNavTimeRef.current = now;

    setNavStack((prev) => {
      const current = prev[prev.length - 1];
      if (current && current.name === name) {
        if (JSON.stringify(current.params || null) === JSON.stringify(params || null)) {
          return prev;
        }
      }
      return [...prev, { name, params }];
    });
  }, []);

  const goBack = useCallback(() => {
    lastNavTimeRef.current = 0;
    setNavStack((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  // Handle Android hardware back press
  useEffect(() => {
    const onBackPress = () => {
      if (incomingRef.current) {
        dismissIncoming();
        return true;
      }

      if (navStackRef.current.length > 1) {
        goBack();
        return true;
      }

      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [goBack]);
  const [connections, setConnections] = useState([]);
  const [incomingNudgeId, setIncomingNudgeId] = useState(null);

  const sessionsRef = useRef(createSessionManager(error => console.warn('[session:cleanup]', error?.message)));
  const pendingIncomingRef = useRef(null);
  const incomingRef = useRef(null);
  const currentUserRef = useRef(null);
  const handledTriggeredNudgesRef = useRef(new Set());

  const showIncoming = async (id, startAnswered = false) => {
    const nudgeId = typeof id === 'object' ? id.id : id;
    const uid = getAuth().currentUser?.uid;
    if (!uid) { pendingIncomingRef.current = { id: nudgeId, startAnswered }; return; }
    if (!nudgeId) return;
    try {
      const nudge = await getNudge(nudgeId);
      if (!nudge || nudge.recipientUid !== uid || getAuth().currentUser?.uid !== uid) return;
      const existing = await getIncomingState(nudgeId);
      const hasRecentTrigger = Boolean(nudge.lastTriggerEventId) &&
        (nudge.status === NUDGE_STATUS.TRIGGERED || (nudge.lastTriggerExpiresAtMs && nudge.lastTriggerExpiresAtMs > Date.now()));
      if (!hasRecentTrigger && !(startAnswered && existing?.state === INCOMING_STATES.ANSWERED)) return;
      let triggerId = nudge.lastTriggerEventId || existing?.triggerId;
      let expiresAt = nudge.lastTriggerExpiresAtMs || existing?.expiresAt || timestampMillis(nudge.lastTriggeredAt || nudge.triggeredAt) + DELIVERY_TTL_MS;
      if (!triggerId || !expiresAt) {
        const event = await getLatestTriggerEvent(nudgeId);
        triggerId = event?.id;
        expiresAt = timestampMillis(event?.createdAt) + DELIVERY_TTL_MS;
      }
      const incoming = parseIncoming({ ...nudge, nudgeId, triggerEventId: triggerId, expiresAt }, uid);
      if (!incoming || getAuth().currentUser?.uid !== uid) return;
      if (existing && existing.state !== INCOMING_STATES.RINGING && !(startAnswered && existing.state === INCOMING_STATES.ANSWERED)) return;
      await recordNativeIncoming(nudgeId, triggerId, incoming.senderName, uid, expiresAt);
      await showNativeIncomingNotification({ ...incoming, triggerId });
      if (getAuth().currentUser?.uid !== uid) return;
      if (incomingRef.current?.id === nudgeId && incomingRef.current?.triggerId === triggerId && !startAnswered) return;
      incomingRef.current = { id: nudgeId, triggerId };
      setIncomingNudgeId({ id: nudgeId, triggerId, startAnswered });
    } catch (error) { console.warn('[incoming:lookup]', error?.code || 'unavailable'); }
  };

  const dismissIncoming = (nudgeId = null, triggerId = null) => {
    const activeId = incomingRef.current?.id;
    if (nudgeId && nudgeId !== activeId) return;
    if (triggerId && triggerId !== incomingRef.current?.triggerId) return;
    incomingRef.current = null;
    setIncomingNudgeId(null);
    setNativeLockscreenAllowed(false);
    dismissIncomingNudgeNotification(nudgeId || activeId);
  };

  const handleAnswerAction = (nudgeId) => {
    showIncoming(nudgeId, true);
  };

  // Initialise Firebase foundation and notification channels once.
  useEffect(() => {
    attachFirebaseFoundation();
    setupNotificationChannels();
    checkAndRequestNotificationPermissions().then((res) => {
      console.log('[NOTIFICATION_DEBUG] App init notification permission result:', JSON.stringify(res));
    });

    const handleNotificationResponse = (response) => {
      const data = response?.notification?.request?.content?.data;
      console.log('[NOTIFICATION_DEBUG] User interacted with notification:', JSON.stringify(data));

      if (data?.test) {
        console.log('[NOTIFICATION_DEBUG] Tapped test notification');
        return;
      }

      const nudgeId = data?.nudgeId;
      const actionId = data?.action?.split('.').pop() || response?.actionIdentifier;

      if (nudgeId) {
        console.log(`[FCM_NOTIFICATION_ACTION] nudgeId=${nudgeId} actionId=${actionId || 'DEFAULT_TAP'}`);
        if (actionId === 'ANSWER' || data?.startAnswered) {
          handleAnswerAction(nudgeId);
        } else if (actionId === 'DECLINE') {
          setIncomingState(nudgeId, INCOMING_STATES.DECLINED, '');
          handledTriggeredNudgesRef.current.add(nudgeId);
          dismissIncoming(nudgeId);
        } else if (data?.type === 'nudge_incoming' || actionId === 'OPEN') {
          showIncoming(nudgeId);
        } else {
          dismissIncoming();
          navigate('detail', { id: nudgeId, isReceived: data?.isReceived !== false });
        }
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          console.log('[NOTIFICATION_DEBUG] Cold start from local notification response');
          handleNotificationResponse(response);
        }
      })
      .catch((e) => {
        console.warn('[NOTIFICATION_DEBUG] getLastNotificationResponseAsync error:', e?.message || e);
      });

    const restoreState = async () => {
      const active = await getActiveRingingState();
      if (active) {
        console.log('[NOTIFICATION_DEBUG] Restoring ringing state on app start for:', active.nudgeId);
        showIncoming(active.nudgeId);
      }
    };
    restoreState();

    messaging().getInitialNotification().then((remoteMessage) => {
      if (remoteMessage?.data?.nudgeId) {
        console.log('[NOTIFICATION_DEBUG] Cold start from FCM notification:', remoteMessage.data);
        showIncoming(remoteMessage.data.nudgeId);
      }
    });

    const bgNotificationSub = messaging().onNotificationOpenedApp((remoteMessage) => {
      if (remoteMessage?.data?.nudgeId) {
        console.log('[NOTIFICATION_DEBUG] Opened app from background via FCM:', remoteMessage.data);
        showIncoming(remoteMessage.data.nudgeId);
      }
    });

    const handleNativeAction = (event) => {
      if (!event || !event.nudgeId) return;
      const { nudgeId, startAnswered } = event;
      const action = event.action?.split('.').pop();
      console.log(`[NATIVE_NOTIFICATION_ACTION] nudgeId=${nudgeId} action=${action || 'DEFAULT'} startAnswered=${startAnswered}`);
      if (action === 'ANSWER' || startAnswered) {
        handleAnswerAction(nudgeId);
      } else if (action === 'DECLINE' || action === 'DISMISSED') {
        setIncomingState(nudgeId, INCOMING_STATES.DECLINED, '');
        handledTriggeredNudgesRef.current.add(nudgeId);
        dismissIncoming(nudgeId);
      } else {
        showIncoming(nudgeId);
      }
    };

    const nativeActionSub = addNativeActionListener(handleNativeAction);

    getInitialNativeAction().then((initial) => {
      if (initial && initial.nudgeId) {
        console.log('[NOTIFICATION_DEBUG] Cold start from native notification action:', JSON.stringify(initial));
        handleNativeAction(initial);
        clearInitialNativeAction();
      }
    });

    return () => {
      responseSub.remove();
      bgNotificationSub();
      nativeActionSub();
    };
  }, []);

  // A session owns all listeners; delayed initialization cannot revive an old account.
  useEffect(() => {
    const unsub = getAuth().onAuthStateChanged(async firebaseUser => {
      const previousUid = currentUserRef.current?.uid;
      const scope = sessionsRef.current.begin(firebaseUser?.uid || null);
      currentUserRef.current = firebaseUser;
      handledTriggeredNudgesRef.current.clear();
      setConnections([]); setProfile(null); setNavStack([{ name: 'home' }]);
      setUser(firebaseUser); setReady(false);
      if (previousUid && previousUid !== firebaseUser?.uid) {
        pendingIncomingRef.current = null;
        dismissIncoming();
        clearNativeAccountState();
        stopNudgeMessage().catch(() => {});
      }
      if (!firebaseUser) {
        await AsyncStorage.removeItem('nudgr_active_uid').catch(() => {});
        if (scope.isCurrent()) setReady(true);
        return;
      }
      const uid = firebaseUser.uid;
      await AsyncStorage.setItem('nudgr_active_uid', uid).catch(() => {});
      if (!scope.isCurrent()) return;
      if (!scope.isCurrent() || getAuth().currentUser?.uid !== uid) return;
      ensureUserProfile(firebaseUser).catch(error => { if (__DEV__) console.warn('[profile]', error.code); });
      syncFcmToken(firebaseUser).catch(error => { if (__DEV__) console.warn('[token]', error.code); });
      scope.addCleanup(attachFcmTokenRefresh());
      flushNativeReceipts();
      startSession(uid, scope);
      setReady(true);
      const pending = pendingIncomingRef.current;
      pendingIncomingRef.current = null;
      if (pending) showIncoming(pending.id, pending.startAnswered);
      const initial = await getInitialNativeAction();
      if (scope.isCurrent() && initial?.nudgeId) {
        await showIncoming(initial.nudgeId, initial.startAnswered);
        clearInitialNativeAction();
      }
    });
    return () => { unsub(); sessionsRef.current.invalidate(); };
  }, []);

  const startSession = (uid, scope) => {
    const current = () => scope.isCurrent() && getAuth().currentUser?.uid === uid;
    scope.addCleanup(subscribeUserProfile(uid, value => { if (current()) setProfile(value); }));
    scope.addCleanup(startTriggerEngine({ uid }));
    scope.addCleanup(subscribeReceivedNudges(uid, list => {
      if (!current()) return;
      const nowMs = Date.now();
      for (const nudge of list) {
        const isActiveRing =
          nudge.status === NUDGE_STATUS.TRIGGERED ||
          (Boolean(nudge.lastTriggerEventId) && nudge.lastTriggerExpiresAtMs && nudge.lastTriggerExpiresAtMs > nowMs);
        if (!isActiveRing) continue;
        const key = `${nudge.id}:${nudge.lastTriggerEventId || timestampMillis(nudge.lastTriggeredAt)}`;
        if (handledTriggeredNudgesRef.current.has(key)) continue;
        handledTriggeredNudgesRef.current.add(key);
        showIncoming(nudge.id);
      }
    }));
    scope.addCleanup(attachFcmListeners({
      onNudgeMessage: async (nudgeId, info) => {
        if (!current()) return;
        const incoming = parseIncoming(info?.data, uid, info?.sentTime);
        if (!incoming) return;
        try { await recordNativeIncoming(nudgeId, incoming.triggerEventId, incoming.senderName, uid, incoming.expiresAt); }
        catch (_) { return; }
        if (!current()) return;
        showIncoming(nudgeId);
      },
      onNudgeOpened: (nudgeId, info) => {
        if (current() && parseIncoming(info?.data, uid, info?.sentTime)) showIncoming(nudgeId);
      },
    }));
    import('./src/db/connections').then(({ subscribeConnections }) => {
      if (!current()) return;
      scope.addCleanup(subscribeConnections(uid, list => { if (current()) setConnections(list); }, () => {}));
    });
  };

  const openIncoming = (nudgeId) => {
    dismissIncoming();
    navigate('detail', { id: nudgeId, isReceived: true });
  };

  if (!ready) {
    return (
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.center}>
        <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" translucent={false} />
        <View style={styles.loadingLogoBox}>
          <Text style={styles.loadingLogoText}>N</Text>
        </View>
        <ActivityIndicator size="small" color="#6366F1" style={{ marginTop: 24 }} />
        <Text style={styles.loadingLabel}>Nudgr</Text>
      </SafeAreaView>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const handleSignOut = async () => {
    try {
      let timeout;
      try {
        await Promise.race([removeFcmToken(getAuth().currentUser), new Promise(resolve => { timeout = setTimeout(resolve, 3000); })]);
      } finally { clearTimeout(timeout); }
      await getAuth().signOut();
    } catch (e) {
      if (__DEV__) console.warn('[sign-out]', e.message);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} key={user.uid} style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" translucent={false} />
      {screen === 'home' && (
        <HomeScreen
          uid={user.uid}
          displayName={profile?.displayName || user.displayName}
          connections={connections}
          onCreate={() => navigate('create')}
          onOpenList={() => navigate('list')}
          onOpenProfile={() => navigate('profile')}
          onOpenMyConnection={() => navigate('myconnection')}
        />
      )}

      {screen === 'profile' && (
        <ProfileScreen
          uid={user.uid}
          email={user.email}
          displayName={profile?.displayName || user.displayName}
          onBack={goBack}
          onSignOut={handleSignOut}
        />
      )}

      {screen === 'myconnection' && (
        <MyConnectionScreen
          uid={user.uid}
          email={user.email}
          displayName={profile?.displayName || user.displayName}
          connections={connections}
          onBack={goBack}
        />
      )}

      {screen === 'create' && (
        <CreateNudgeScreen
          connections={connections}
          initialNudge={detail?.initialNudge || null}
          onBack={goBack}
          onCreated={(id) => {
            setNavStack((prev) => {
              const filtered = prev.filter((r) => r.name !== 'create' && !(r.name === 'detail' && r.params?.id === id));
              return [...filtered, { name: 'detail', params: { id, isReceived: false } }];
            });
          }}
        />
      )}

      {screen === 'list' && (
        <NudgeListScreen
          uid={user.uid}
          onBack={goBack}
          onOpenNudge={(id, isReceived) => {
            navigate('detail', { id, isReceived });
          }}
        />
      )}

      {screen === 'detail' && detail && (
        <NudgeDetailScreen
          nudgeId={detail.id}
          isReceived={detail.isReceived}
          autoPlay={!!detail.autoPlay}
          onEdit={(nudgeData) => navigate('create', { initialNudge: nudgeData })}
          onBack={goBack}
        />
      )}

      {incomingNudgeId && (
        <IncomingNudge
          key={`${user.uid}:${incomingNudgeId.id}:${incomingNudgeId.triggerId}`}
          nudgeId={incomingNudgeId.id || incomingNudgeId}
          startAnswered={!!incomingNudgeId.startAnswered}
          onDismiss={() => dismissIncoming(incomingNudgeId.id, incomingNudgeId.triggerId)}
          onAnswer={openIncoming}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F6F7FC',
  },
  loadingLogoBox: {
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  loadingLogoText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -1,
  },
  loadingLabel: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  container: { flex: 1, backgroundColor: '#F6F7FC' },
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <NudgrApp />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
