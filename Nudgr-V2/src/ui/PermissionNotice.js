import React, { useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

export default function PermissionNotice() {
  const [permissions, setPermissions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, generation = 0;
    const refresh = async () => {
      const own = ++generation;
      try {
        const [foreground, background, notifications, services] = await Promise.all([
          Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync(),
          Notifications.getPermissionsAsync(), Location.hasServicesEnabledAsync(),
        ]);
        if (active && own === generation) setPermissions({ foreground, background, notifications, services });
      } catch (_) { if (active) setError('Unable to check permissions. You can review them in app settings.'); }
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; subscription.remove(); };
  }, [busy]);

  const notificationsMissing = permissions && permissions.notifications.status !== 'granted';
  const locationMissing = permissions && (!permissions.services || permissions.background.status !== 'granted');
  if (!notificationsMissing && !locationMissing && !error) return null;
  const enable = async kind => {
    setBusy(true); setError('');
    try {
      if (!permissions || kind === 'settings') await Linking.openSettings();
      else if (kind === 'notifications') {
        if (permissions.notifications.canAskAgain) await Notifications.requestPermissionsAsync();
        else await Linking.openSettings();
      } else if (!permissions.services && Platform.OS === 'android') {
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      } else if (permissions.foreground.status !== 'granted') {
        if (permissions.foreground.canAskAgain) await Location.requestForegroundPermissionsAsync();
        else await Linking.openSettings();
      } else if (permissions.background.canAskAgain) await Location.requestBackgroundPermissionsAsync();
      else await Linking.openSettings();
    } catch (_) { setError('Open app settings to enable this permission, then return to Nudgr.'); }
    finally { setBusy(false); }
  };
  return <View style={styles.card}>
    <Text style={styles.title}>Check your arrival alerts</Text>
    {notificationsMissing && <View style={styles.row}>
      <Text style={styles.body}>Notifications are off. Incoming Nudgr alerts need permission.</Text>
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => enable('notifications')}>
        <Text style={styles.action}>Enable alerts</Text>
      </TouchableOpacity>
    </View>}
    {locationMissing && <View style={styles.row}>
      <Text style={styles.body}>Sending when you arrive needs location access while Nudgr is closed.</Text>
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => enable('location')}>
        <Text style={styles.action}>Review location</Text>
      </TouchableOpacity>
    </View>}
    {!!error && <Text style={styles.body} onPress={() => enable('settings')}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFF9ED', borderRadius: 18, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: '#F2E6C8' },
  title: { fontSize: 14, fontWeight: '700', color: '#4B3D28' },
  row: { marginTop: 9 }, body: { fontSize: 13, color: '#675B48', lineHeight: 19 },
  action: { fontSize: 13, color: '#6553B3', fontWeight: '700', paddingVertical: 9 },
});
