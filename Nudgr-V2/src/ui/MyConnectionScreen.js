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
import { getAuth, getFirestore, getServerTimestamp } from '../firebase';
import { ensureUserProfile, subscribeUserProfile } from '../db/users';
import { connectByCode } from '../db/connections';
import AmbientBackground from './AmbientBackground';

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

  const syncCodeToFirestore = useCallback(
    (codeVal) => {
      if (!codeVal || !uid) return;
      try {
        getFirestore()
          .collection('connectionCodes')
          .doc(codeVal)
          .set({ uid, createdAt: getServerTimestamp() }, { merge: true })
          .catch(() => {});
      } catch (_) {}
    },
    [uid]
  );

  const copyCode = async () => {
    if (!profile?.connectionCode) return;
    syncCodeToFirestore(profile.connectionCode);
    await Clipboard.setStringAsync(profile.connectionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitConnect = async () => {
    setBusy(true);
    setConnectError(null);
    setConnectSuccess(false);
    try {
      await connectByCode(connectCode);
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
      <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" />
      <AmbientBackground />

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
          <Text style={styles.headerTitle}>My Connections</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Connections</Text>
          <Text style={styles.pageSubtitle}>
            Pair with family and friends to send and receive arrival Nudgrs.
          </Text>
        </View>

        {/* ── 1. My Code Card ── */}
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <View style={[styles.cardLabelDot, { backgroundColor: '#6366F1' }]} />
            <Text style={styles.cardLabel}>YOUR CONNECTION CODE</Text>
          </View>
          <Text style={styles.cardHint}>
            Share this 8-character code with someone so they can send you reminders.
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#6366F1" size="small" />
              <Text style={styles.loadingText}>Generating your connection code…</Text>
            </View>
          ) : code ? (
            <>
              <View style={styles.codeContainer}>
                <Text style={styles.codeText} selectable={false}>
                  {codeVisible ? code : maskedCode}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    syncCodeToFirestore(code);
                    setCodeVisible((v) => !v);
                  }}
                  style={styles.codeEyeBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.codeEyeGlyph}>{codeVisible ? '👁️' : '🔒'}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.copyBtn, copied && styles.copyBtnSuccess]}
                onPress={copyCode}
                activeOpacity={0.8}
              >
                <Text style={[styles.copyBtnText, copied && styles.copyBtnTextSuccess]}>
                  {copied ? 'Copied to Clipboard!' : 'Copy Code'}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{profileError || 'Could not load your connection code.'}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={loadOrGenerateCode}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── 2. Connect by Code Card ── */}
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <View style={[styles.cardLabelDot, { backgroundColor: '#10B981' }]} />
            <Text style={styles.cardLabel}>ENTER SOMEONE'S CODE</Text>
          </View>
          <Text style={styles.cardHint}>
            Paste the code you received from the other person.
          </Text>

          <TextInput
            style={styles.codeInput}
            placeholder="e.g.  A B 3 X Y Z K 9"
            placeholderTextColor="#94A3B8"
            value={connectCode}
            onChangeText={(t) => {
              setConnectCode(t.replace(/[\s-]+/g, '').toUpperCase().slice(0, 8));
              setConnectError(null);
              setConnectSuccess(false);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={16}
          />

          {connectError && (
            <View style={styles.alertError}>
              <Text style={styles.alertErrorText}>{connectError}</Text>
            </View>
          )}

          {connectSuccess && (
            <View style={styles.alertSuccess}>
              <Text style={styles.alertSuccessText}>Connected successfully!</Text>
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

        {/* ── 3. Paired People ── */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionHeader}>PAIRED PEOPLE ({connections.length})</Text>
          <View style={styles.sectionLine} />
        </View>

        <View style={styles.card}>
          {connections.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <Text style={styles.emptyIconGlyph}>👥</Text>
              </View>
              <Text style={styles.emptyTitle}>No connections yet</Text>
              <Text style={styles.emptySubtitle}>
                Share your code above or enter someone's code to get started.
              </Text>
            </View>
          ) : (
            connections.map((c, i) => {
              const name =
                c.profile?.displayName ||
                (c.profile?.email ? c.profile.email.split('@')[0] : null) ||
                `Peer (${(c.otherUid || '').slice(0, 6)})`;
              return (
                <View key={c.otherUid}>
                  <View style={styles.connectionItem}>
                    <View style={styles.connectionAvatar}>
                      <Text style={styles.connectionAvatarInitial}>
                        {name[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.connectionName} numberOfLines={1}>{name}</Text>
                      <Text style={styles.connectionStatus}>
                        {c.verified
                          ? (c.profile?.email || 'Connected & Ready')
                          : 'Enter their code above to complete pairing'}
                      </Text>
                    </View>
                    <View style={styles.pairedBadge}>
                      <Text style={styles.pairedBadgeText}>{c.verified ? 'PAIRED' : 'VERIFY'}</Text>
                    </View>
                  </View>
                  {i < connections.length - 1 && <View style={styles.connectionDivider} />}
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
    backgroundColor: '#F6F7FC',
  },

  // ── Header ───────────────────────────────────────────────────────────────
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 20,
    marginBottom: 4,
  },
  headerTitleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 25,
  },
  backArrow: {
    fontSize: 26,
    color: '#0F172A',
    fontWeight: '300',
    lineHeight: 28,
  },

  // ── Scroll Content ────────────────────────────────────────────────────────
  scrollContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
  },
  pageHeader: {
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 20,
  },

  // ── Section Divider ───────────────────────────────────────────────────────
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.1,
    marginHorizontal: 16,
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 26,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cardLabelDot: {
    width: 4,
    height: 14,
    borderRadius: 2,
    backgroundColor: '#6366F1',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.1,
  },
  cardHint: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },

  // ── Code Display ──────────────────────────────────────────────────────────
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 14,
    gap: 12,
  },
  codeText: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: '#6366F1',
    letterSpacing: 6,
    textAlign: 'center',
  },
  codeEyeBtn: {
    padding: 6,
  },
  codeEyeGlyph: {
    fontSize: 20,
  },
  copyBtn: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
  },
  copyBtnSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: 'rgba(167, 243, 208, 0.85)',
  },
  copyBtnText: {
    color: '#6366F1',
    fontSize: 14,
    fontWeight: '700',
  },
  copyBtnTextSuccess: {
    color: '#059669',
  },
  errorBox: {
    marginTop: 4,
    gap: 10,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
  },
  retryBtn: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  retryBtnText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Code Input ────────────────────────────────────────────────────────────
  codeInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    letterSpacing: 5,
    color: '#0F172A',
    marginBottom: 14,
    textAlign: 'center',
    fontWeight: '700',
  },
  alertError: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.8)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  alertErrorText: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
  },
  alertSuccess: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.85)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  alertSuccessText: {
    color: '#059669',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  connectBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  connectBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
  },
  connectBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Connection Items ──────────────────────────────────────────────────────
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  connectionDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  connectionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionAvatarInitial: {
    fontSize: 17,
    fontWeight: '800',
    color: '#6366F1',
  },
  connectionName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  connectionStatus: {
    fontSize: 12,
    color: '#64748B',
  },
  pairedBadge: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pairedBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.8,
  },

  // ── Empty State ───────────────────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyIconGlyph: {
    fontSize: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 2,
    paddingHorizontal: 16,
  },
});
