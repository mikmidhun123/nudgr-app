import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ActivityIndicator, PermissionsAndroid, Platform } from 'react-native';
import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import { attachFirebaseFoundation, getAuth, getMessaging } from './src/firebase';
import './src/location/backgroundGeofence'; // registers the background task at load
import { setupNotificationChannels } from './src/notifications/localNotifications';
import { ensureUserProfile } from './src/db/users';
import {
  syncFcmToken,
  removeFcmToken,
  attachFcmTokenRefresh,
} from './src/fcm/tokens';
import { attachFcmListeners } from './src/fcm/delivery';
import { startTriggerEngine } from './src/location/triggerEngine';
import { subscribeReceivedNudges, NUDGE_STATUS } from './src/db/nudges';
import ErrorBoundary from './src/ui/ErrorBoundary';
import AuthScreen from './src/ui/AuthScreen';
import HomeScreen from './src/ui/HomeScreen';
import ConnectScreen from './src/ui/ConnectScreen';
import CreateNudgeScreen from './src/ui/CreateNudgeScreen';
import NudgeListScreen from './src/ui/NudgeListScreen';
import NudgeDetailScreen from './src/ui/NudgeDetailScreen';
import IncomingNudge from './src/ui/IncomingNudge';

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState('home');
  const [detail, setDetail] = useState(null); // { id, isReceived }
  const [connections, setConnections] = useState([]);
  const [incomingNudgeId, setIncomingNudgeId] = useState(null);

  const stopEngineRef = useRef(null);
  const stopFcmRef = useRef(null);
  const stopConnRef = useRef(null);
  const stopRecvRef = useRef(null);
  const refreshAttachedRef = useRef(false);
  const incomingRef = useRef(null);
  const currentUserRef = useRef(null);

  // Android 13+ requires a runtime POST_NOTIFICATIONS grant for notifications to be displayed.
  const requestNotificationPermission = async () => {
    try {
      if (Platform.OS === 'android') {
        if (Platform.Version >= 33) {
          const granted = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
          if (!granted) {
            await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
            );
          }
        }
      } else if (Platform.OS === 'ios') {
        await getMessaging().requestPermission();
      }
    } catch (e) {
      if (__DEV__) console.warn('[notif-perm]', e.message);
    }
  };

  const showIncoming = (id) => {
    if (incomingRef.current === id) return;
    incomingRef.current = id;
    setIncomingNudgeId(id);
  };

  const dismissIncoming = () => {
    incomingRef.current = null;
    setIncomingNudgeId(null);
  };

  // Initialise Firebase foundation and notification channels once.
  useEffect(() => {
    attachFirebaseFoundation();
    setupNotificationChannels();

    // Handle user tapping on a local notification
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const nudgeId = response.notification.request.content.data?.nudgeId;
      if (nudgeId) {
        dismissIncoming();
        setDetail({ id: nudgeId, isReceived: true });
        setScreen('detail');
      }
    });

    return () => {
      responseSub.remove();
    };
  }, []);

  // Auth state drives the whole app.
  useEffect(() => {
    const unsub = getAuth().onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        currentUserRef.current = firebaseUser;
        setUser(firebaseUser);
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
        requestNotificationPermission();
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
    // Recipient-side location/trigger monitoring engine.
    stopEngineRef.current = startTriggerEngine({ uid });

    // Recipient-side listening for triggered Nudgrs in foreground.
    stopRecvRef.current = subscribeReceivedNudges(uid, (list) => {
      const triggered = list.find((n) => n.status === NUDGE_STATUS.TRIGGERED);
      if (triggered) {
        showIncoming(triggered.id);
      }
    });

    // FCM messaging listeners (preserved for push delivery).
    stopFcmRef.current = attachFcmListeners({
      onNudgeMessage: (nudgeId) => showIncoming(nudgeId),
      onNudgeOpened: (nudgeId) => {
        dismissIncoming();
        setDetail({ id: nudgeId, isReceived: true });
        setScreen('detail');
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
    stopEngineRef.current = null;
    stopFcmRef.current = null;
    stopConnRef.current = null;
    stopRecvRef.current = null;
    if (currentUserRef.current) {
      removeFcmToken(currentUserRef.current);
      currentUserRef.current = null;
    }
    setScreen('home');
    setDetail(null);
    dismissIncoming();
    setConnections([]);
  };

  const openIncoming = (nudgeId) => {
    dismissIncoming();
    setDetail({ id: nudgeId, isReceived: true });
    setScreen('detail');
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#2e7d32" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const goHome = () => {
    setDetail(null);
    setScreen('home');
  };

  return (
    <SafeAreaView style={styles.container}>
      {screen === 'home' && (
        <HomeScreen
          uid={user.uid}
          email={user.email}
          displayName={profile?.displayName || user.displayName}
          connections={connections}
          onConnect={() => setScreen('connect')}
          onSignOut={async () => {
            try {
              await getAuth().signOut();
            } catch (e) {
              if (__DEV__) console.warn('[sign-out]', e.message);
            }
          }}
          onCreate={() => setScreen('create')}
          onOpenList={() => setScreen('list')}
        />
      )}

      {screen === 'connect' && (
        <ConnectScreen
          onBack={goHome}
          onConnected={goHome}
        />
      )}

      {screen === 'create' && (
        <CreateNudgeScreen
          connections={connections}
          onBack={goHome}
          onCreated={(id) => {
            setDetail({ id, isReceived: false });
            setScreen('detail');
          }}
        />
      )}

      {screen === 'list' && (
        <NudgeListScreen
          uid={user.uid}
          onBack={goHome}
          onOpenNudge={(id, isReceived) => {
            setDetail({ id, isReceived });
            setScreen('detail');
          }}
        />
      )}

      {screen === 'detail' && detail && (
        <NudgeDetailScreen
          nudgeId={detail.id}
          isReceived={detail.isReceived}
          onBack={goHome}
        />
      )}

      {incomingNudgeId && (
        <IncomingNudge
          nudgeId={incomingNudgeId}
          onDismiss={dismissIncoming}
          onOpen={openIncoming}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#fff' },
});

const AppRoot = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

registerRootComponent(AppRoot);
