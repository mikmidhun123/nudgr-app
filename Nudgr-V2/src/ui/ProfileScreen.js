import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import {
  scheduleTestNotification,
  getNotificationDiagnostics,
  createAndScheduleTimeTestNudge,
  verifyScheduledNudgeAlarms,
  cancelNudgeAlarm,
} from '../notifications/localNotifications';
import { getRuntimeStatuses } from '../diagnostics/runtimeStatus';
import { getGeofenceDiagnostics } from '../location/debugStatus';
import { THEME } from './theme';

export default function ProfileScreen({ uid, email, displayName, onBack, onSignOut }) {
  // Notification testing state
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [triggerTrace, setTriggerTrace] = useState(null);

  // Time Trigger testing state
  const [timeTestStatus, setTimeTestStatus] = useState(null);
  const [timeTesting, setTimeTesting] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState(null);

  const runTestNotification = async (seconds = 10) => {
    setTesting(true);
    setTestStatus({ message: `Scheduling test notification (${seconds}s)...`, isError: false });
    try {
      const res = await scheduleTestNotification(seconds);
      if (res.success) {
        const msg =
          seconds > 0
            ? `✓ Scheduled for ${seconds}s from now! (ID: ${res.notificationId})\n👉 Lock your phone or leave app to test background delivery.`
            : `✓ Instant notification delivered! (ID: ${res.notificationId})`;
        setTestStatus({ message: msg, isError: false });
      } else {
        setTestStatus({ message: `✗ Failed: ${res.error}`, isError: true });
        Alert.alert('Notification Test Failed', res.error);
      }
    } catch (e) {
      setTestStatus({ message: `✗ Error: ${e.message}`, isError: true });
    } finally {
      setTesting(false);
    }
  };

  const runDiagnosticsCheck = async () => {
    setTesting(true);
    try {
      const diag = await getNotificationDiagnostics();
      setDiagnostics(diag);
      const permText = diag.permissionGranted
        ? '✓ Permissions: Granted'
        : `✗ Permissions: ${diag.permissionStatus || 'Denied'}`;
      const channelCount = diag.channels?.length || 0;
      setTestStatus({
        message: `${permText} | ${channelCount} Channels Registered (${diag.channels?.map((c) => c.id).join(', ')})`,
        isError: !diag.permissionGranted,
      });
    } catch (e) {
      setTestStatus({ message: `✗ Diagnostic Error: ${e.message}`, isError: true });
    } finally {
      setTesting(false);
    }
  };

  const inspectTriggerTrace = async () => {
    setTesting(true);
    try {
      const [geofence, entries] = await Promise.all([
        getGeofenceDiagnostics(),
        getRuntimeStatuses(),
      ]);
      setTriggerTrace({ geofence, entries: entries.slice(0, 6) });
    } catch (e) {
      setTestStatus({ message: `✗ Trigger trace error: ${e.message}`, isError: true });
    } finally {
      setTesting(false);
    }
  };

  const runTimeTest = async (seconds = 60) => {
    setTimeTesting(true);
    setTimeTestStatus({ message: `Scheduling ${seconds}s time trigger test...`, isError: false });
    try {
      const res = await createAndScheduleTimeTestNudge({ message: 'Time trigger test', seconds });
      if (res.success) {
        setActiveAlarm({ id: res.nudgeId, notificationId: res.notificationId, targetTime: res.targetTime });
        const msg =
          `✓ Nudgr Time Trigger Scheduled!\n` +
          `• Target Time: ${res.targetTime} (+${seconds}s)\n` +
          `• OS Alarm Registered: ${res.matchingFound ? 'YES' : 'NO'}\n\n` +
          `👉 Lock your phone now and wait for notification!`;
        setTimeTestStatus({ message: msg, isError: false });
      } else {
        setTimeTestStatus({ message: `✗ Scheduling failed: ${res.error}`, isError: true });
        Alert.alert('Time Trigger Failed', res.error);
      }
    } catch (e) {
      setTimeTestStatus({ message: `✗ Error: ${e.message}`, isError: true });
    } finally {
      setTimeTesting(false);
    }
  };

  const verifyAlarms = async () => {
    setTimeTesting(true);
    try {
      const res = await verifyScheduledNudgeAlarms(activeAlarm?.id);
      if (res.matchingFound) {
        const item = res.items[0];
        const msg =
          `✓ OS Alarm Verified Active in OS!\n` +
          `• Alarm ID: ${item?.id}\n` +
          `• Total Alarms in OS: ${res.total}`;
        setTimeTestStatus({ message: msg, isError: false });
      } else {
        const msg =
          res.total > 0
            ? `⚠️ ${res.total} alarm(s) in OS, but none matched current test.`
            : '⚠️ No scheduled alarms currently registered in OS.';
        setTimeTestStatus({ message: msg, isError: true });
      }
    } catch (e) {
      setTimeTestStatus({ message: `✗ Verification error: ${e.message}`, isError: true });
    } finally {
      setTimeTesting(false);
    }
  };

  const cancelActiveAlarm = async () => {
    if (!activeAlarm?.id) return;
    try {
      await cancelNudgeAlarm(activeAlarm.id);
      setActiveAlarm(null);
      setTimeTestStatus({ message: '✓ Scheduled alarm cancelled successfully.', isError: false });
    } catch (e) {
      setTimeTestStatus({ message: `✗ Error cancelling alarm: ${e.message}`, isError: true });
    }
  };

  const initials = (displayName || email || 'U')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>Account & Profile</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Large Profile Hero Glass Card */}
        <View style={styles.profileHeroCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <Text style={styles.profileName}>{displayName || 'Nudgr User'}</Text>
          <Text style={styles.profileEmail}>{email || 'No email associated'}</Text>
          <View style={styles.uidBadge}>
            <Text style={styles.uidText}>UID: {uid?.slice(0, 10)}…</Text>
          </View>
        </View>

        {/* Grouped Settings Glass Rows */}
        <Text style={styles.sectionHeader}>SETTINGS</Text>
        <View style={styles.groupedRowsCard}>
          <TouchableOpacity
            style={styles.rowItem}
            onPress={runDiagnosticsCheck}
            activeOpacity={0.75}
          >
            <View style={[styles.rowIconBox, { backgroundColor: 'rgba(90, 200, 250, 0.14)' }]}>
              <Text style={styles.rowIcon}>🔔</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Notifications</Text>
              <Text style={styles.rowSubtitle}>Check channel & post permissions</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <View style={styles.rowItem}>
            <View style={[styles.rowIconBox, { backgroundColor: 'rgba(48, 209, 88, 0.14)' }]}>
              <Text style={styles.rowIcon}>📍</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Geofence Engine</Text>
              <Text style={styles.rowSubtitle}>Background arrival monitor active</Text>
            </View>
            <View style={styles.statusActivePill}>
              <Text style={styles.statusActiveText}>ACTIVE</Text>
            </View>
          </View>
        </View>

        {/* Sign Out Glass Button */}
        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut} activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign Out of Nudgr</Text>
        </TouchableOpacity>

        {/* Developer Diagnostics Glass Panel */}
        <Text style={styles.sectionHeader}>DEVELOPER & DIAGNOSTICS</Text>

        <View style={styles.devGlassCard}>
          <Text style={styles.devCardTitle}>🔔 Notification Shade Verification</Text>
          <Text style={styles.devCardSubtitle}>
            Tests immediate local and 10s background notification delivery to verify system push readiness.
          </Text>

          <TouchableOpacity
            style={styles.devPrimaryBtn}
            onPress={() => runTestNotification(10)}
            disabled={testing}
            activeOpacity={0.8}
          >
            <Text style={styles.devPrimaryBtnText}>⚡ TEST 10S BACKGROUND ALERT</Text>
          </TouchableOpacity>

          <View style={styles.devBtnRow}>
            <TouchableOpacity
              style={styles.devSecondaryBtn}
              onPress={() => runTestNotification(0)}
              disabled={testing}
              activeOpacity={0.8}
            >
              <Text style={styles.devSecondaryBtnText}>Instant Push</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.devSecondaryBtn}
              onPress={runDiagnosticsCheck}
              disabled={testing}
              activeOpacity={0.8}
            >
              <Text style={styles.devSecondaryBtnText}>Check Perms</Text>
            </TouchableOpacity>
          </View>

          {testing && (
            <ActivityIndicator color={THEME.colors.accentPrimary} style={{ marginVertical: 8 }} />
          )}

          {testStatus && (
            <View style={[styles.statusBox, testStatus.isError ? styles.statusError : styles.statusSuccess]}>
              <Text style={[styles.statusBoxText, testStatus.isError ? styles.textError : styles.textSuccess]}>
                {testStatus.message}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.devGlassCard}>
          <Text style={styles.devCardTitle}>📍 Geofence → Delivery Trace</Text>
          <Text style={styles.devCardSubtitle}>
            Shows Android geofence registration and the latest durable background stages after reopening the app.
          </Text>
          <TouchableOpacity
            style={styles.devPrimaryBtn}
            onPress={inspectTriggerTrace}
            disabled={testing}
            activeOpacity={0.8}
          >
            <Text style={styles.devPrimaryBtnText}>INSPECT TRIGGER TRACE</Text>
          </TouchableOpacity>
          {triggerTrace && (
            <View style={styles.statusBox}>
              <Text style={styles.statusBoxText}>
                OS geofence: {triggerTrace.geofence.geofencesStarted ? 'REGISTERED' : 'NOT REGISTERED'}
                {'\n'}Regions: {triggerTrace.geofence.activeRegionsCount} · Background location: {triggerTrace.geofence.backgroundPermission}
                {triggerTrace.entries.length > 0
                  ? `\n\n${triggerTrace.entries.map((entry) => `[${entry.stage}] ${entry.message}`).join('\n')}`
                  : '\n\nNo runtime events captured yet.'}
              </Text>
            </View>
          )}
        </View>

        {/* Time Trigger Test Card */}
        <View style={styles.devGlassCard}>
          <Text style={styles.devCardTitle}>⏱️ Pure Time Alarm Verification</Text>
          <Text style={styles.devCardSubtitle}>
            Pure OS AlarmManager test. Zero dependency on GPS, peer connection, or Cloud Functions.
          </Text>

          <View style={styles.devBtnRow}>
            <TouchableOpacity
              style={styles.devSecondaryBtn}
              onPress={() => runTimeTest(60)}
              disabled={timeTesting}
              activeOpacity={0.8}
            >
              <Text style={styles.devSecondaryBtnText}>+60s Alarm</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.devSecondaryBtn}
              onPress={verifyAlarms}
              disabled={timeTesting}
              activeOpacity={0.8}
            >
              <Text style={styles.devSecondaryBtnText}>Verify in OS</Text>
            </TouchableOpacity>

            {activeAlarm && (
              <TouchableOpacity
                style={[styles.devSecondaryBtn, { borderColor: THEME.colors.danger }]}
                onPress={cancelActiveAlarm}
                disabled={timeTesting}
                activeOpacity={0.8}
              >
                <Text style={{ color: THEME.colors.danger, fontWeight: '700', fontSize: 12 }}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>

          {timeTesting && (
            <ActivityIndicator color={THEME.colors.accentSecondary} style={{ marginVertical: 8 }} />
          )}

          {timeTestStatus && (
            <View style={[styles.statusBox, timeTestStatus.isError ? styles.statusError : styles.statusSuccess]}>
              <Text style={[styles.statusBoxText, timeTestStatus.isError ? styles.textError : styles.textSuccess]}>
                {timeTestStatus.message}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: THEME.colors.bg,
  },
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(7, 10, 18, 0.85)',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.glassBorderSubtle,
    zIndex: 10,
  },
  headerTitleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.3,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  backArrow: {
    fontSize: 28,
    color: THEME.colors.accentPrimary,
    fontWeight: '300',
    lineHeight: 30,
  },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  // --- Profile Hero Card ---
  profileHeroCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.cardLg,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 4,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(139, 124, 255, 0.18)',
    borderWidth: 2,
    borderColor: THEME.colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginBottom: 12,
  },
  uidBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  uidText: {
    fontSize: 11,
    color: THEME.colors.textTertiary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // --- Grouped Rows Card ---
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
  },
  groupedRowsCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.card,
    paddingVertical: 4,
    marginBottom: 20,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIcon: {
    fontSize: 18,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    marginBottom: 2,
  },
  rowSubtitle: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  chevron: {
    fontSize: 20,
    color: THEME.colors.textTertiary,
    fontWeight: '300',
  },
  statusActivePill: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusActiveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#86efac',
    letterSpacing: 0.8,
  },
  rowDivider: {
    height: 1,
    backgroundColor: THEME.colors.glassBorderSubtle,
    marginHorizontal: 16,
  },

  // --- Sign Out Button ---
  signOutBtn: {
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.30)',
    borderRadius: THEME.radius.button,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 26,
  },
  signOutText: {
    color: '#fca5a5',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // --- Developer Glass Card ---
  devGlassCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.card,
    padding: 18,
    marginBottom: 16,
  },
  devCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    marginBottom: 4,
  },
  devCardSubtitle: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    lineHeight: 17,
    marginBottom: 14,
  },
  devPrimaryBtn: {
    backgroundColor: THEME.colors.accentPrimary,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  devPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  devBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  devSecondaryBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devSecondaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  statusBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  statusSuccess: {
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.25)',
  },
  statusError: {
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.25)',
  },
  statusBoxText: {
    fontSize: 12,
    lineHeight: 17,
  },
  textSuccess: {
    color: '#86efac',
    fontWeight: '600',
  },
  textError: {
    color: '#fca5a5',
    fontWeight: '600',
  },
});
