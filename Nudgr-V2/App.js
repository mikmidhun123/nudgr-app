import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ActivityIndicator, PermissionsAndroid, Platform, BackHandler, StatusBar } from 'react-native';
import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import messaging from '@react-native-firebase/messaging';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { attachFirebaseFoundation, getAuth, getMessaging } from './src/firebase';
import './src/location/backgroundGeofence'; // registers the background task at load
import {
  setupNotificationChannels,
  checkAndRequestNotificationPermissions,
  showIncomingNudgeNotification,
  showLocalNudgeNotification,
  dismissIncomingNudgeNotification,
  syncAllNudgeAlarms,
} from './src/notifications/localNotifications';
import { ensureUserProfile } from './src/db/users';
import {
  syncFcmToken,
  removeFcmToken,
  attachFcmTokenRefresh,
} from './src/fcm/tokens';
import { attachFcmListeners } from './src/fcm/delivery';
import { startTriggerEngine } from './src/location/triggerEngine';
import { subscribeReceivedNudges, subscribeSentNudges, isNudgeActive, NUDGE_STATUS } from './src/db/nudges';
import ErrorBoundary from './src/ui/ErrorBoundary';
import AuthScreen from './src/ui/AuthScreen';
import HomeScreen from './src/ui/HomeScreen';
import CreateNudgeScreen from './src/ui/CreateNudgeScreen';
import NudgeListScreen from './src/ui/NudgeListScreen';
import NudgeDetailScreen from './src/ui/NudgeDetailScreen';
import IncomingNudge from './src/ui/IncomingNudge';
import ProfileScreen from './src/ui/ProfileScreen';
import MyConnectionScreen from './src/ui/MyConnectionScreen';
import { getActiveRingingState } from './src/notifications/incomingState';

// Register background message handler at module scope for headless FCM wakeups.
// This MUST execute before any React component mounts.
// Since the Cloud Function now sends notification+data FCM, Android OS will
// display the notification natively even if this handler fails. This handler
// enhances the notification with Answer/Decline actions via expo-notifications.
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  try {
    console.log('[FCM_RECEIVED_BACKGROUND] Background message handler started');
    const data = remoteMessage?.data || {};
    const nudgeId = data?.nudgeId;
    const senderName = data?.senderName || 'Someone';
    const message = data?.message || 'Incoming Nudgr';

    console.log(`[FCM_RECEIVED_BACKGROUND] nudgeId=${nudgeId || 'NONE'} type=${data?.type || 'unknown'} senderName=${senderName}`);

    if (nudgeId) {
      console.log(`[FCM_HANDLER_STARTED] nudgeId=${nudgeId} creating local notification with actions`);
      const notifId = await showIncomingNudgeNotification({
        nudgeId,
        senderName,
        message,
      });
      console.log(`[FCM_NOTIFICATION_CREATED] nudgeId=${nudgeId} notificationId=${notifId || 'FAILED'}`);
    } else {
      console.warn('[FCM_RECEIVED_BACKGROUND] No nudgeId in background message data');
    }
  } catch (err) {
    console.error(`[FCM_HANDLER_FAILED] Background handler error: ${err.message}`);
  }
});

export default function App() {
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
  const detail = currentRoute.params; // { id, isReceived, autoPlay }

  const navigate = useCallback((name, params = null) => {
    const now = Date.now();
    if (now - lastNavTimeRef.current < 250) return; // Prevent rapid double-tap
    lastNavTimeRef.current = now;

    setNavStack((prev) => {
      const current = prev[prev.length - 1];
      if (current && current.name === name) {
        if (JSON.stringify(current.params || null) === JSON.stringify(params || null)) {
          return prev; // Already on this screen with same params, do not push duplicate!
        }
      }
      return [...prev, { name, params }];
    });
  }, []);

  const goBack = useCallback(() => {
    setNavStack((prev) => {
      if (prev.length <= 1) {
        return prev; // At root, cannot pop
      }
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  // Handle Android hardware back press
  useEffect(() => {
    const onBackPress = () => {
      // 1. If incoming nudge alert overlay is active, dismiss it
      if (incomingRef.current) {
        dismissIncoming();
        return true;
      }

      // 2. If navigation stack has more than 1 screen, pop back to previous screen
      if (navStackRef.current.length > 1) {
        goBack();
        return true; // Consumed by App navigation
      }

      // 3. At root screen ('home') -> return false for normal Android exit behavior
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [goBack]);
  const [connections, setConnections] = useState([]);
  const [incomingNudgeId, setIncomingNudgeId] = useState(null);

  const stopEngineRef = useRef(null);
  const stopFcmRef = useRef(null);
  const stopConnRef = useRef(null);
  const stopRecvRef = useRef(null);
  const stopSentAlarmSyncRef = useRef(null);
  const refreshAttachedRef = useRef(false);
  const incomingRef = useRef(null);
  const currentUserRef = useRef(null);
  const handledTriggeredNudgesRef = useRef(new Set());

  const showIncoming = (id, startAnswered = false) => {
    const nudgeId = typeof id === 'object' ? id.id : id;
    if (!nudgeId) return;
    if (incomingRef.current === nudgeId && !startAnswered) return;
    incomingRef.current = nudgeId;
    setIncomingNudgeId({ id: nudgeId, startAnswered });
  };

  const dismissIncoming = () => {
    incomingRef.current = null;
    setIncomingNudgeId(null);
    dismissIncomingNudgeNotification();
  };

  const handleAnswerAction = (nudgeId) => {
    // When notification ANSWER action is pressed, open full-screen incoming experience in answered mode
    showIncoming(nudgeId, true);
  };

  // Initialise Firebase foundation and notification channels once.
  useEffect(() => {
    attachFirebaseFoundation();
    setupNotificationChannels();
    checkAndRequestNotificationPermissions().then((res) => {
      console.log('[NOTIFICATION_DEBUG] App init notification permission result:', JSON.stringify(res));
    });

    // Handle user tapping on a local notification
    const handleNotificationResponse = (response) => {
      const data = response?.notification?.request?.content?.data;
      console.log('[NOTIFICATION_DEBUG] User interacted with notification:', JSON.stringify(data));
      
      if (data?.test) {
        console.log('[NOTIFICATION_DEBUG] Tapped test notification');
        return;
      }

      const nudgeId = data?.nudgeId;
      const actionId = response?.actionIdentifier;
      
      if (nudgeId) {
        console.log(`[FCM_NOTIFICATION_ACTION] nudgeId=${nudgeId} actionId=${actionId || 'DEFAULT_TAP'}`);
        if (actionId === 'ANSWER') {
          handleAnswerAction(nudgeId);
        } else if (actionId === 'DECLINE') {
          dismissIncoming();
        } else {
          dismissIncoming();
          navigate('detail', { id: nudgeId, isReceived: true });
        }
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    // Also check for cold-start interaction with local notification
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

    // Check for active ringing state on app start (restore after restart)
    const restoreState = async () => {
      const active = await getActiveRingingState();
      if (active) {
        console.log('[NOTIFICATION_DEBUG] Restoring ringing state on app start for:', active.nudgeId);
        showIncoming(active.nudgeId);
      }
    };
    restoreState();

    // Check if app was opened from killed state by FCM
    messaging().getInitialNotification().then((remoteMessage) => {
      if (remoteMessage?.data?.nudgeId) {
        console.log('[NOTIFICATION_DEBUG] Cold start from FCM notification:', remoteMessage.data);
        showIncoming(remoteMessage.data.nudgeId);
      }
    });

    // Handle notification tap when app is in background
    const bgNotificationSub = messaging().onNotificationOpenedApp((remoteMessage) => {
      if (remoteMessage?.data?.nudgeId) {
        console.log('[NOTIFICATION_DEBUG] Opened app from background via FCM:', remoteMessage.data);
        showIncoming(remoteMessage.data.nudgeId);
      }
    });

    return () => {
      responseSub.remove();
      bgNotificationSub();
    };
  }, []);

  // Auth state drives the whole app.
  useEffect(() => {
    const unsub = getAuth().onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        currentUserRef.current = firebaseUser;
        setUser(firebaseUser);
        AsyncStorage.setItem('nudgr_active_uid', firebaseUser.uid).catch(() => {});
        try {
          const p = await ensureUserProfile(firebaseUser);
          setProfile(p);
          await syncFcmToken(firebaseUser);
        } catch (e) {
          if (__DEV__) console.warn('[profile]', e.message);
        }
        if (!refreshAttachedRef.current) {
          attachFcmTokenRefresh();
          refreshAttachedRef.current = true;
        }
        checkAndRequestNotificationPermissions();
        startSession(firebaseUser.uid);
      } else {
        endSession();
        setUser(null);
        setProfile(null);
      }
      setReady(true);
    });
    return () => unsub();
  }, []);

  const startSession = (uid) => {
    // Sender's geofencing engine (triggers when sender enters radius).
    stopEngineRef.current = startTriggerEngine({ uid });

    // Sync exact time alarms for all sent nudges with Android notification scheduler
    stopSentAlarmSyncRef.current = subscribeSentNudges(uid, (nudges) => {
      syncAllNudgeAlarms(nudges, isNudgeActive);
    });

    // Recipient-side listening for triggered Nudgrs in foreground.
    stopRecvRef.current = subscribeReceivedNudges(uid, (list) => {
      console.log(`[NUDGR_DELIVERY] recipientUid=${uid} receivedSnapshotCount=${list.length}`);
      const triggeredList = list.filter((n) => n.status === NUDGE_STATUS.TRIGGERED);
      console.log(`[NUDGR_DELIVERY] recipientUid=${uid} triggeredSnapshotCount=${triggeredList.length}`);

      for (const triggered of triggeredList) {
        if (handledTriggeredNudgesRef.current.has(triggered.id)) {
          continue; // Already dispatched notification for this triggered nudge
        }
        handledTriggeredNudgesRef.current.add(triggered.id);

        console.log(`[NUDGR_DELIVERY] nudgeId=${triggered.id} senderUid=${triggered.senderUid} recipientUid=${uid} source=firestore`);

        showIncoming(triggered.id);

        showIncomingNudgeNotification({
          nudgeId: triggered.id,
          senderName: triggered.senderName || 'Someone',
          message: triggered.message || 'Incoming Nudgr',
        })
          .then((notifId) => {
            console.log(`[NUDGR_NOTIFICATION] nudgeId=${triggered.id} source=firestore notificationId=${notifId || 'deduplicated'}`);
          })
          .catch((e) => {
            console.error(`[NUDGR_NOTIFICATION] nudgeId=${triggered.id} source=firestore result=FAILED error=${e.message}`);
          });
      }
    });

    // FCM messaging listeners (preserved for push delivery).
    stopFcmRef.current = attachFcmListeners({
      onNudgeMessage: (nudgeId, info) => {
        if (!nudgeId || handledTriggeredNudgesRef.current.has(nudgeId)) return;
        handledTriggeredNudgesRef.current.add(nudgeId);
        console.log(`[NUDGR_DELIVERY] nudgeId=${nudgeId} recipientUid=${uid} source=fcm-foreground`);
        showIncoming(nudgeId);
        showIncomingNudgeNotification({
          nudgeId,
          senderName: info?.senderName || 'Someone',
          message: info?.message || 'Incoming Nudgr',
        }).catch((e) => console.error(`[NUDGR_NOTIFICATION] nudgeId=${nudgeId} source=fcm-foreground result=FAILED error=${e.message}`));
      },
      onNudgeOpened: (nudgeId) => {
        console.log('[NOTIFICATION_DEBUG] FCM message opened for nudge:', nudgeId);
        dismissIncoming();
        navigate('detail', { id: nudgeId, isReceived: true });
      },
    });

    // Keep live connections for recipient picker + home display.
    import('./src/db/connections').then(({ subscribeConnections }) => {
      stopConnRef.current = subscribeConnections(uid, setConnections, () => {});
    });
  };

  const endSession = () => {
    if (stopEngineRef.current) stopEngineRef.current();
    if (stopFcmRef.current) stopFcmRef.current();
    if (stopConnRef.current) stopConnRef.current();
    if (stopRecvRef.current) stopRecvRef.current();
    if (stopSentAlarmSyncRef.current) stopSentAlarmSyncRef.current();
    stopEngineRef.current = null;
    stopFcmRef.current = null;
    stopConnRef.current = null;
    stopRecvRef.current = null;
    stopSentAlarmSyncRef.current = null;
    handledTriggeredNudgesRef.current.clear();
    AsyncStorage.removeItem('nudgr_active_uid').catch(() => {});
    if (currentUserRef.current) {
      removeFcmToken(currentUserRef.current);
      currentUserRef.current = null;
    }
    setNavStack([{ name: 'home' }]);
    dismissIncoming();
    setConnections([]);
  };

  const openIncoming = (nudgeId) => {
    dismissIncoming();
    navigate('detail', { id: nudgeId, isReceived: true });
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const handleSignOut = async () => {
    try {
      await getAuth().signOut();
    } catch (e) {
      if (__DEV__) console.warn('[sign-out]', e.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#070A12" translucent={false} />
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
          onBack={goBack}
          onCreated={(id) => {
            setNavStack((prev) => {
              const filtered = prev.filter((r) => r.name !== 'create');
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
          onBack={goBack}
        />
      )}

      {incomingNudgeId && (
        <IncomingNudge
          nudgeId={incomingNudgeId.id || incomingNudgeId}
          startAnswered={!!incomingNudgeId.startAnswered}
          onDismiss={dismissIncoming}
          onAnswer={openIncoming}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#070A12' },
  container: { flex: 1, backgroundColor: '#070A12' },
});

const AppRoot = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

registerRootComponent(AppRoot);
