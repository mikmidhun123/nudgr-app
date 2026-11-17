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
  Platform,
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
import AmbientBackground from './AmbientBackground';
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
            ? `Scheduled for ${seconds}s from now! (ID: ${res.notificationId})\nLock your phone or leave app to test background delivery.`
            : `Instant notification delivered! (ID: ${res.notificationId})`;
        setTestStatus({ message: msg, isError: false });
      } else {
        setTestStatus({ message: `Failed: ${res.error}`, isError: true });
        Alert.alert('Notification Test Failed', res.error);
      }
    } catch (e) {
      setTestStatus({ message: `Error: ${e.message}`, isError: true });
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
        ? 'Permissions: Granted'
        : `Permissions: ${diag.permissionStatus || 'Denied'}`;
      const channelCount = diag.channels?.length || 0;
      setTestStatus({
        message: `${permText} | ${channelCount} Channels Registered (${diag.channels?.map((c) => c.id).join(', ')})`,
        isError: !diag.permissionGranted,
      });
    } catch (e) {
      setTestStatus({ message: `Diagnostic Error: ${e.message}`, isError: true });
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
      setTestStatus({ message: `Trigger trace error: ${e.message}`, isError: true });
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
          `Nudgr Time Trigger Scheduled!\n` +
          `Target Time: ${res.targetTime} (+${seconds}s)\n` +
          `OS Alarm Registered: ${res.matchingFound ? 'YES' : 'NO'}\n\n` +
          `Lock your phone now and wait for notification!`;
        setTimeTestStatus({ message: msg, isError: false });
      } else {
        setTimeTestStatus({ message: `Scheduling failed: ${res.error}`, isError: true });
        Alert.alert('Time Trigger Failed', res.error);
      }
    } catch (e) {
      setTimeTestStatus({ message: `Error: ${e.message}`, isError: true });
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
          `OS Alarm Verified Active!\n` +
          `Alarm ID: ${item?.id}\n` +
          `Total Alarms in OS: ${res.total}`;
        setTimeTestStatus({ message: msg, isError: false });
      } else {
        const msg =
          res.total > 0
            ? `${res.total} alarm(s) in OS, but none matched current test.`
            : 'No scheduled alarms currently registered in OS.';
        setTimeTestStatus({ message: msg, isError: true });
      }
    } catch (e) {
      setTimeTestStatus({ message: `Verification error: ${e.message}`, isError: true });
    } finally {
      setTimeTesting(false);
    }
  };

  const cancelActiveAlarm = async () => {
    if (!activeAlarm?.id) return;
    try {
      await cancelNudgeAlarm(activeAlarm.id);
      setActiveAlarm(null);
      setTimeTestStatus({ message: 'Scheduled alarm cancelled successfully.', isError: false });
    } catch (e) {
      setTimeTestStatus({ message: `Error cancelling alarm: ${e.message}`, isError: true });
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
      <AmbientBackground />
      <StatusBar barStyle="dark-content" backgroundColor={THEME.colors.bg} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>Profile & Account</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile Hero Card ── */}
        <View style={styles.profileCard}>
          <View style={styles.profileGlowOrb} pointerEvents="none" />
          <View style={styles.avatarContainer}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          </View>
          <Text style={styles.profileName}>{displayName || 'Nudgr User'}</Text>
          <Text style={styles.profileEmail}>{email || 'No email associated'}</Text>
          <View style={styles.uidBadge}>
            <Text style={styles.uidText}>ID: {uid?.slice(0, 10)}…</Text>
          </View>
        </View>

        {/* ── Settings Section ── */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionHeader}>SETTINGS</Text>
          <View style={styles.sectionLine} />
        </View>

        <View style={styles.groupedCard}>
          <TouchableOpacity
            style={styles.rowItem}
            onPress={runDiagnosticsCheck}
            activeOpacity={0.72}
          >
            <View style={[styles.rowIconBox, { backgroundColor: THEME.colors.tagTeal, borderColor: THEME.colors.tagTealBorder }]}>
              <Text style={styles.rowIconGlyph}>◈</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Notifications</Text>
              <Text style={styles.rowSubtitle}>Check channel & post permissions</Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          <View style={styles.rowItem}>
            <View style={[styles.rowIconBox, { backgroundColor: THEME.colors.successBg, borderColor: THEME.colors.successBorder }]}>
              <Text style={styles.rowIconGlyph}>◎</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Geofence Engine</Text>
              <Text style={styles.rowSubtitle}>Background arrival monitor active</Text>
            </View>
            <View style={styles.activePill}>
              <Text style={styles.activePillText}>ACTIVE</Text>
            </View>
          </View>
        </View>

        {/* ── Sign Out ── */}
        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut} activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign Out of Nudgr</Text>
        </TouchableOpacity>

        {/* ── Developer Section ── */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionHeader}>DEVELOPER</Text>
          <View style={styles.sectionLine} />
        </View>

        {/* Notification Test Card */}
        <View style={styles.devCard}>
          <View style={styles.devCardTitleRow}>
            <View style={styles.devCardIcon}>
              <Text style={styles.devCardIconGlyph}>◈</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.devCardTitle}>Notification Shade Verification</Text>
              <Text style={styles.devCardSubtitle}>
                Tests immediate local and 10s background notification delivery.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.devPrimaryBtn}
            onPress={() => runTestNotification(10)}
            disabled={testing}
            activeOpacity={0.8}
          >
            <Text style={styles.devPrimaryBtnText}>TEST 10S BACKGROUND ALERT</Text>
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
            <View style={[styles.statusBox, testStatus.isError ? styles.statusBoxError : styles.statusBoxSuccess]}>
              <Text style={[styles.statusBoxText, testStatus.isError ? styles.statusTextError : styles.statusTextSuccess]}>
                {testStatus.message}
              </Text>
            </View>
          )}
        </View>

        {/* Geofence Trace Card */}
        <View style={styles.devCard}>
          <View style={styles.devCardTitleRow}>
            <View style={styles.devCardIcon}>
              <Text style={styles.devCardIconGlyph}>◎</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.devCardTitle}>Geofence Delivery Trace</Text>
              <Text style={styles.devCardSubtitle}>
                Shows Android geofence registration and latest background delivery stages.
              </Text>
            </View>
          </View>
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
        <View style={styles.devCard}>
          <View style={styles.devCardTitleRow}>
            <View style={styles.devCardIcon}>
              <Text style={styles.devCardIconGlyph}>◷</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.devCardTitle}>Pure Time Alarm Verification</Text>
              <Text style={styles.devCardSubtitle}>
                Pure OS AlarmManager test. Zero dependency on GPS, peer connection, or Cloud Functions.
              </Text>
            </View>
          </View>

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
                style={[styles.devSecondaryBtn, { borderColor: THEME.colors.dangerBorder, backgroundColor: THEME.colors.dangerBg }]}
                onPress={cancelActiveAlarm}
                disabled={timeTesting}
                activeOpacity={0.8}
              >
                <Text style={[styles.devSecondaryBtnText, { color: THEME.colors.dangerText }]}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>

          {timeTesting && (
            <ActivityIndicator color={THEME.colors.accentSecondary} style={{ marginVertical: 8 }} />
          )}

          {timeTestStatus && (
            <View style={[styles.statusBox, timeTestStatus.isError ? styles.statusBoxError : styles.statusBoxSuccess]}>
              <Text style={[styles.statusBoxText, timeTestStatus.isError ? styles.statusTextError : styles.statusTextSuccess]}>
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

  // ── Header ───────────────────────────────────────────────────────────────
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
    zIndex: 20,
    marginBottom: 4,
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderSubtle,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    zIndex: 25,
  },
  backArrow: {
    fontSize: 26,
    color: THEME.colors.textPrimary,
    fontWeight: '300',
    lineHeight: 28,
  },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },

  // ── Profile Hero Card ─────────────────────────────────────────────────────
  profileCard: {
    ...THEME.glassCardHero,
    padding: 26,
    alignItems: 'center',
    marginBottom: 24,
    overflow: 'hidden',
  },
  profileGlowOrb: {
    position: 'absolute',
    top: -40,
    left: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(99, 102, 241, 0.06)',
  },
  avatarContainer: {
    marginBottom: 14,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 26,
    backgroundColor: THEME.colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  avatarInitials: {
    fontSize: 30,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginBottom: 14,
  },
  uidBadge: {
    backgroundColor: THEME.colors.bgSubtle,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: THEME.radius.xs,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderSubtle,
  },
  uidText: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 0.5,
  },

  // ── Section Divider ───────────────────────────────────────────────────────
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: THEME.colors.glassBorderSubtle,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.5,
  },

  // ── Grouped Card ─────────────────────────────────────────────────────────
  groupedCard: {
    ...THEME.glassCard,
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
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconGlyph: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '700',
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
  rowChevron: {
    fontSize: 20,
    color: THEME.colors.textTertiary,
    fontWeight: '300',
  },
  rowDivider: {
    height: 1,
    backgroundColor: THEME.colors.glassBorderSubtle,
    marginHorizontal: 16,
  },
  activePill: {
    backgroundColor: THEME.colors.mintBg,
    borderRadius: THEME.radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.mint,
    letterSpacing: 0.8,
  },

  // ── Sign Out ──────────────────────────────────────────────────────────────
  signOutBtn: {
    ...THEME.buttonDanger,
    marginBottom: 28,
  },
  signOutText: {
    color: THEME.colors.dangerText,
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Dev Card ──────────────────────────────────────────────────────────────
  devCard: {
    ...THEME.glassCard,
    padding: 18,
    marginBottom: 16,
  },
  devCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  devCardIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: THEME.colors.lavenderBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  devCardIconGlyph: {
    fontSize: 16,
    color: THEME.colors.accentPrimary,
    fontWeight: '700',
  },
  devCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  devCardSubtitle: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    lineHeight: 17,
  },
  devPrimaryBtn: {
    ...THEME.buttonPrimary,
    paddingVertical: 12,
    borderRadius: THEME.radius.sm,
    marginBottom: 10,
  },
  devPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  devBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  devSecondaryBtn: {
    flex: 1,
    backgroundColor: THEME.colors.bgSubtle,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderSubtle,
    borderRadius: THEME.radius.xs,
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
    borderRadius: THEME.radius.xs,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderSubtle,
    backgroundColor: THEME.colors.bgSubtle,
  },
  statusBoxSuccess: {
    backgroundColor: THEME.colors.mintBg,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  statusBoxError: {
    backgroundColor: THEME.colors.dangerBg,
    borderColor: THEME.colors.dangerBorder,
  },
  statusBoxText: {
    fontSize: 12,
    lineHeight: 18,
    color: THEME.colors.textSecondary,
  },
  statusTextSuccess: {
    color: THEME.colors.mint,
    fontWeight: '600',
  },
  statusTextError: {
    color: THEME.colors.dangerText,
    fontWeight: '600',
  },
});
