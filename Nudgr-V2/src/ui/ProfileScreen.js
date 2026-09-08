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
  checkAndRequestNotificationPermissions,
  getNotificationDiagnostics,
  createAndScheduleTimeTestNudge,
  verifyScheduledNudgeAlarms,
  cancelNudgeAlarm,
} from '../notifications/localNotifications';

export default function ProfileScreen({ uid, email, displayName, onBack, onSignOut }) {
  // Notification testing state
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);

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
            ? `✓ Scheduled for ${seconds}s from now! (ID: ${res.notificationId})\n👉 Lock your phone or minimize app to verify background delivery.`
            : `✓ Instant notification sent! (ID: ${res.notificationId})`;
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

  const runTimeTest = async (seconds = 60) => {
    setTimeTesting(true);
    setTimeTestStatus({ message: `Scheduling ${seconds}s time trigger test...`, isError: false });
    try {
      const res = await createAndScheduleTimeTestNudge({ message: 'Time trigger test', seconds });
      if (res.success) {
        setActiveAlarm({ id: res.nudgeId, notificationId: res.notificationId, targetTime: res.targetTime });
        const msg =
          `✓ Nudgr Time Trigger Scheduled!\n` +
          `• Nudgr ID: ${res.nudgeId}\n` +
          `• Target Time: ${res.targetTime} (+${seconds}s)\n` +
          `• Notification ID: ${res.notificationId}\n` +
          `• OS Alarm Verified: ${res.matchingFound ? 'YES (Active in Android OS)' : 'NO (Missing)'}\n\n` +
          `👉 PROTOCOL:\n1. Leave the app.\n2. Lock your phone now.\n3. Wait until ${res.targetTime} for notification to appear.`;
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
          `✓ OS Alarm Verified Active!\n` +
          `• Total Alarms in Android OS: ${res.total}\n` +
          `• Alarm ID: ${item?.id}\n` +
          `• Nudgr ID: ${item?.nudgeId}\n` +
          `• Ready to fire on time!`;
        setTimeTestStatus({ message: msg, isError: false });
      } else {
        const msg =
          res.total > 0
            ? `⚠️ ${res.total} alarm(s) found in OS, but none matched current Nudgr ID.`
            : '⚠️ No scheduled alarms currently registered in Android OS.';
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

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Account Card */}
        <View style={styles.glassCard}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Name</Text>
            <Text style={styles.infoValue}>{displayName || '—'}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoKey}>Email</Text>
            <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="tail">
              {email || '—'}
            </Text>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut} activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Developer / Diagnostics Section */}
        <Text style={styles.devSectionHeader}>🛠 Developer / Diagnostics</Text>

        {/* Notification Delivery Verification Card */}
        <View style={[styles.glassCard, styles.devCard]}>
          <Text style={styles.devCardTitle}>🔔 Notification Delivery Verification</Text>
          <Text style={styles.devCardSubtitle}>
            Direct OS delivery test (Button → Local Notification → Android Shade). Zero dependency on GPS, Firebase, or Nudgr rules.
          </Text>

          <TouchableOpacity
            style={[styles.devBtn, styles.devBtnPrimary, { paddingVertical: 14, marginBottom: 8 }]}
            onPress={() => runTestNotification(10)}
            disabled={testing}
            activeOpacity={0.8}
          >
            <Text style={[styles.devBtnText, { fontSize: 15, fontWeight: '800' }]}>TEST NOTIFICATION</Text>
          </TouchableOpacity>

          <View style={styles.devBtnRow}>
            <TouchableOpacity
              style={[styles.devBtn, styles.devBtnSecondary]}
              onPress={() => runTestNotification(0)}
              disabled={testing}
              activeOpacity={0.8}
            >
              <Text style={styles.devBtnSecondaryText}>⚡ Test Instant (Foreground)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.devBtn, styles.devBtnSecondary]}
              onPress={runDiagnosticsCheck}
              disabled={testing}
              activeOpacity={0.8}
            >
              <Text style={styles.devBtnSecondaryText}>🔍 Check Permissions</Text>
            </TouchableOpacity>
          </View>

          {testing && (
            <View style={{ marginTop: 10, alignItems: 'center' }}>
              <ActivityIndicator color="#16a34a" size="small" />
            </View>
          )}

          {testStatus && (
            <View style={[styles.statusBox, testStatus.isError ? styles.statusError : styles.statusSuccess]}>
              <Text style={[styles.statusText, testStatus.isError ? styles.statusErrorText : styles.statusSuccessText]}>
                {testStatus.message}
              </Text>
            </View>
          )}

          <Text style={styles.hintText}>
            📋 Test Protocol: Press "TEST NOTIFICATION", then immediately press Home / lock screen. Wait 10–15s for the notification to appear in the Android shade.
          </Text>
        </View>

        {/* Time Trigger Verification Card */}
        <View style={[styles.glassCard, styles.devCard]}>
          <Text style={styles.devCardTitle}>⏱️ Nudgr Time Trigger Verification</Text>
          <Text style={styles.devCardSubtitle}>
            Pure time-based Nudgr trigger test. Verifies that setting a trigger time calls the notification engine and produces an actual Android notification.
          </Text>

          <View style={styles.devBtnRow}>
            <TouchableOpacity
              style={[styles.devBtn, styles.devBtnPrimary]}
              onPress={() => runTimeTest(60)}
              disabled={timeTesting}
              activeOpacity={0.8}
            >
              <Text style={styles.devBtnText}>⏱️ Set 1-Min Test (+60s)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.devBtn, { backgroundColor: '#059669' }]}
              onPress={() => runTimeTest(120)}
              disabled={timeTesting}
              activeOpacity={0.8}
            >
              <Text style={styles.devBtnText}>⏱️ Set 2-Min Test (+120s)</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.devBtnRow, { marginTop: 6 }]}>
            <TouchableOpacity
              style={[styles.devBtn, styles.devBtnSecondary]}
              onPress={verifyAlarms}
              disabled={timeTesting}
              activeOpacity={0.8}
            >
              <Text style={styles.devBtnSecondaryText}>🔍 Verify OS Alarms</Text>
            </TouchableOpacity>
            {activeAlarm && (
              <TouchableOpacity
                style={[styles.devBtn, { backgroundColor: '#fee2e2', borderColor: '#fca5a5', borderWidth: 1 }]}
                onPress={cancelActiveAlarm}
                disabled={timeTesting}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 13, textAlign: 'center' }}>❌ Cancel Alarm</Text>
              </TouchableOpacity>
            )}
          </View>

          {timeTesting && (
            <View style={{ marginTop: 10, alignItems: 'center' }}>
              <ActivityIndicator color="#16a34a" size="small" />
            </View>
          )}

          {timeTestStatus && (
            <View style={[styles.statusBox, timeTestStatus.isError ? styles.statusError : styles.statusSuccess]}>
              <Text style={[styles.statusText, timeTestStatus.isError ? styles.statusErrorText : styles.statusSuccessText]}>
                {timeTestStatus.message}
              </Text>
            </View>
          )}

          <Text style={styles.hintText}>
            📋 Instructions: Tap "Set 1-Min Test", leave app, lock phone. Wait until the target time for the notification to pop in the Android shade!
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const GLASS = {
  backgroundColor: 'rgba(255,255,255,0.88)',
  borderWidth: 1,
  borderColor: 'rgba(0,0,0,0.07)',
  borderRadius: 20,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.07,
  shadowRadius: 8,
  elevation: 3,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f0f4f0',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.07)',
    zIndex: 10,
  },
  headerTitleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    fontSize: 32,
    color: '#16a34a',
    fontWeight: '300',
    lineHeight: 34,
  },
  scrollContainer: {
    padding: 16,
    paddingTop: 20,
  },
  glassCard: {
    ...GLASS,
    padding: 18,
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  infoKey: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    color: '#1a1a1a',
    fontWeight: '600',
    flex: 2,
    textAlign: 'right',
  },
  signOutBtn: {
    backgroundColor: '#fee2e2',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  signOutText: {
    color: '#dc2626',
    fontSize: 15,
    fontWeight: '700',
  },
  devSectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    letterSpacing: 0.3,
    marginBottom: 12,
    paddingLeft: 4,
  },
  devCard: {
    backgroundColor: 'rgba(240,253,244,0.9)',
    borderColor: 'rgba(134,239,172,0.5)',
  },
  devCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 4,
  },
  devCardSubtitle: {
    fontSize: 12,
    color: '#15803d',
    marginBottom: 12,
    lineHeight: 17,
  },
  devBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  devBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devBtnPrimary: {
    backgroundColor: '#16a34a',
  },
  devBtnSecondary: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  devBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  devBtnSecondaryText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
  },
  statusSuccess: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  statusError: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  statusText: {
    fontSize: 12,
    lineHeight: 17,
  },
  statusSuccessText: {
    color: '#166534',
    fontWeight: '600',
  },
  statusErrorText: {
    color: '#991b1b',
    fontWeight: '600',
  },
  hintText: {
    marginTop: 10,
    fontSize: 11,
    color: '#4b5563',
    lineHeight: 15,
    fontStyle: 'italic',
  },
});
