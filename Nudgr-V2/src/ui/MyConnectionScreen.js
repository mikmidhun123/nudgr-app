import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getAuth } from '../firebase';
import { ensureUserProfile, subscribeUserProfile } from '../db/users';
import { connectByCode } from '../db/connections';
import { THEME } from './theme';

export default function MyConnectionScreen({ uid, email, displayName, connections = [], onBack }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);

  // Code visibility — always starts hidden on mount
  const [codeVisible, setCodeVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  // Connect-by-code state
  const [connectCode, setConnectCode] = useState('');
  const [connecting, setBusy] = useState(false);
  const [connectError, setConnectError] = useState(null);
  const [connectSuccess, setConnectSuccess] = useState(false);

  const loadOrGenerateCode = useCallback(async () => {
    setLoading(true);
    setProfileError(null);
    try {
      const currentUser = getAuth().currentUser || { uid, email, displayName };
      const p = await ensureUserProfile(currentUser);
      if (p) {
        setProfile(p);
      } else {
        setProfileError('Failed to generate connection code.');
      }
    } catch (e) {
      setProfileError(e.message || 'Could not load connection code.');
    } finally {
      setLoading(false);
    }
  }, [uid, email, displayName]);

  useEffect(() => {
    setCodeVisible(false);
    loadOrGenerateCode();

    const unsub = subscribeUserProfile(
      uid,
      (p) => {
        if (p) {
          setProfile(p);
          if (p.connectionCode) {
            setLoading(false);
            setProfileError(null);
          }
        }
      },
      (err) => {
        if (__DEV__) console.warn('[subscribeUserProfile]', err.message);
      }
    );

    return () => unsub();
  }, [uid, loadOrGenerateCode]);

  const copyCode = async () => {
    if (!profile?.connectionCode) return;
    await Clipboard.setStringAsync(profile.connectionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitConnect = async () => {
    setBusy(true);
    setConnectError(null);
    setConnectSuccess(false);
    try {
      await connectByCode(connectCode.trim());
      setConnectSuccess(true);
      setConnectCode('');
    } catch (e) {
      setConnectError(e.message || 'Could not connect. Check the code and try again.');
    } finally {
      setBusy(false);
    }
  };

  const code = profile?.connectionCode;
  const maskedCode = code ? '●'.repeat(code.length) : '●●●●●●●●';

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
          <Text style={styles.headerTitle}>My Connection</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topSection}>
          <Text style={styles.pageTitle}>Connections</Text>
          <Text style={styles.pageSubtitle}>
            Pair with family and friends to send & receive arrival Nudgrs.
          </Text>
        </View>

        {/* 1. My Connection Code Floating Glass Card */}
        <View style={styles.glassCard}>
          <Text style={styles.sectionLabel}>YOUR CONNECTION CODE</Text>
          <Text style={styles.sectionHint}>
            Share this 8-character code with someone so they can send you reminders.
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={THEME.colors.accentPrimary} style={{ marginVertical: 8 }} />
              <Text style={styles.loadingText}>Generating your connection code…</Text>
            </View>
          ) : code ? (
            <>
              <View style={styles.codeContainer}>
                <Text style={styles.codeText} selectable={false}>
                  {codeVisible ? code : maskedCode}
                </Text>
                <TouchableOpacity
                  onPress={() => setCodeVisible((v) => !v)}
                  style={styles.eyeBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.eyeIcon}>{codeVisible ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.copyBtn} onPress={copyCode} activeOpacity={0.8}>
                <Text style={styles.copyBtnText}>{copied ? '✓ Copied to Clipboard!' : '📋 Copy Code'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{profileError || 'Could not load your connection code.'}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={loadOrGenerateCode}>
                <Text style={styles.retryBtnText}>🔄 Retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 2. Connect to Someone Floating Glass Card */}
        <View style={styles.glassCard}>
          <Text style={styles.sectionLabel}>ENTER SOMEONE'S CODE</Text>
          <Text style={styles.sectionHint}>
            Paste the code you received from the other device.
          </Text>

          <TextInput
            style={styles.codeInput}
            placeholder="e.g. AB3XYZK9"
            placeholderTextColor={THEME.colors.textTertiary}
            value={connectCode}
            onChangeText={(t) => {
              setConnectCode(t.toUpperCase());
              setConnectError(null);
              setConnectSuccess(false);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />

          {connectError && (
            <View style={styles.alertError}>
              <Text style={styles.alertErrorText}>{connectError}</Text>
            </View>
          )}

          {connectSuccess && (
            <View style={styles.alertSuccess}>
              <Text style={styles.alertSuccessText}>✓ Connected successfully!</Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.connectBtn,
              (!connectCode.trim() || connecting) && styles.connectBtnDisabled,
            ]}
            onPress={submitConnect}
            disabled={connecting || !connectCode.trim()}
            activeOpacity={0.8}
          >
            {connecting ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.connectBtnText}>Connect Peer</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 3. Connected People List */}
        <Text style={styles.sectionHeader}>PAIRED PEOPLE ({connections.length})</Text>
        <View style={styles.glassCard}>
          {connections.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔗</Text>
              <Text style={styles.emptyTitle}>No connections yet</Text>
              <Text style={styles.emptySubtitle}>
                Share your code above or enter someone's code to get started.
              </Text>
            </View>
          ) : (
            connections.map((c, index) => {
              const name = c.profile?.displayName || c.profile?.email || c.otherUid;
              return (
                <View key={c.otherUid}>
                  {index > 0 && <View style={styles.connectionDivider} />}
                  <View style={styles.connectionItem}>
                    <View style={styles.connectionAvatar}>
                      <Text style={styles.connectionAvatarText}>
                        {name[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.connectionName}>{name}</Text>
                      <Text style={styles.connectionStatus}>{c.status || 'Active'}</Text>
                    </View>
                    <View style={styles.connectedBadge}>
                      <Text style={styles.connectedBadgeText}>PAIRED</Text>
                    </View>
                  </View>
                </View>
              );
            })
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
    paddingTop: 16,
    paddingBottom: 40,
  },
  topSection: {
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
  },

  // --- Glass Card ---
  glassCard: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.card,
    padding: 20,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
  },

  // --- Code Display ---
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(139, 124, 255, 0.35)',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 14,
    gap: 12,
  },
  codeText: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: THEME.colors.accentPrimary,
    letterSpacing: 5,
    textAlign: 'center',
  },
  eyeBtn: {
    padding: 4,
  },
  eyeIcon: {
    fontSize: 20,
  },
  copyBtn: {
    backgroundColor: 'rgba(139, 124, 255, 0.16)',
    borderWidth: 1,
    borderColor: THEME.colors.accentPrimary,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  copyBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  errorBox: {
    marginTop: 4,
  },
  errorText: {
    color: THEME.colors.danger,
    fontSize: 13,
    marginBottom: 10,
  },
  retryBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  retryBtnText: {
    color: THEME.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },

  // --- Code Input ---
  codeInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderHighlight,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    letterSpacing: 4,
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '700',
  },
  alertError: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  alertErrorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
  },
  alertSuccess: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  alertSuccessText: {
    color: '#86efac',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  connectBtn: {
    backgroundColor: THEME.colors.accentPrimary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  connectBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
  },
  connectBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // --- Connection Item ---
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  connectionDivider: {
    height: 1,
    backgroundColor: THEME.colors.glassBorderSubtle,
    marginVertical: 4,
  },
  connectionAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(90, 200, 250, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.accentSecondary,
  },
  connectionName: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  connectionStatus: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginTop: 1,
  },
  connectedBadge: {
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.25)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  connectedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#86efac',
    letterSpacing: 0.8,
  },

  // --- Empty ---
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  emptyIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 16,
  },
});
