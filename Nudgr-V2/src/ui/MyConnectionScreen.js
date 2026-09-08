import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getAuth } from '../firebase';
import { ensureUserProfile, subscribeUserProfile } from '../db/users';
import { connectByCode } from '../db/connections';

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
    // Always reset visibility on mount
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
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>My Connection</Text>
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
        keyboardShouldPersistTaps="handled"
      >
        {/* My Connection Code Card */}
        <View style={styles.glassCard}>
          <Text style={styles.sectionLabel}>YOUR CONNECTION CODE</Text>
          <Text style={styles.sectionHint}>
            Share this code with someone so they can connect with you.
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#16a34a" style={{ marginVertical: 8 }} />
              <Text style={styles.loadingText}>Loading your connection code...</Text>
            </View>
          ) : code ? (
            <>
              <View style={styles.codeRow}>
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
                <Text style={styles.copyBtnText}>{copied ? '✓ Copied!' : '📋 Copy Code'}</Text>
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

        {/* Connect to Someone Card */}
        <View style={styles.glassCard}>
          <Text style={styles.sectionLabel}>CONNECT TO SOMEONE</Text>
          <Text style={styles.sectionHint}>
            Enter the connection code you received from the other person.
          </Text>

          <TextInput
            style={styles.codeInput}
            placeholder="e.g. AB3XYZK9"
            placeholderTextColor="#9ca3af"
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

          {connectError && <Text style={styles.connectErrorText}>{connectError}</Text>}
          {connectSuccess && (
            <Text style={styles.connectSuccessText}>✓ Connected successfully!</Text>
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
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.connectBtnText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Connected People */}
        <View style={styles.glassCard}>
          <Text style={styles.sectionLabel}>CONNECTED PEOPLE</Text>
          {connections.length === 0 ? (
            <Text style={styles.emptyText}>No connections yet.</Text>
          ) : (
            connections.map((c) => (
              <View key={c.otherUid} style={styles.connectionItem}>
                <View style={styles.connectionAvatar}>
                  <Text style={styles.connectionAvatarText}>
                    {(c.profile?.displayName || c.profile?.email || '?')[0].toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.connectionName}>
                    {c.profile?.displayName || c.profile?.email || c.otherUid}
                  </Text>
                  <Text style={styles.connectionStatus}>{c.status}</Text>
                </View>
              </View>
            ))
          )}
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
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 14,
    lineHeight: 18,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#6b7280',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  codeText: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: '#16a34a',
    letterSpacing: 5,
  },
  eyeBtn: {
    padding: 6,
  },
  eyeIcon: {
    fontSize: 22,
  },
  copyBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  copyBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  errorBox: {
    marginTop: 4,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 10,
  },
  retryBtn: {
    backgroundColor: '#dcfce7',
    borderColor: '#16a34a',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  retryBtnText: {
    color: '#16a34a',
    fontSize: 13,
    fontWeight: '600',
  },
  codeInput: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 20,
    letterSpacing: 3,
    color: '#1a1a1a',
    marginBottom: 10,
    textAlign: 'center',
  },
  connectErrorText: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 8,
  },
  connectSuccessText: {
    color: '#16a34a',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  connectBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  connectBtnDisabled: {
    backgroundColor: '#86efac',
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  connectionAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#86efac',
  },
  connectionAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#16a34a',
  },
  connectionName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  connectionStatus: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 1,
    textTransform: 'capitalize',
  },
});
