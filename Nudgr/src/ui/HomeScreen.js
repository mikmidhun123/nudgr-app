import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, Text, View, Button, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getAuth } from '../firebase';
import { ensureUserProfile, subscribeUserProfile } from '../db/users';

export default function HomeScreen({
  uid,
  email,
  displayName,
  connections = [],
  onConnect,
  onSignOut,
  onCreate,
  onOpenList,
}) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [copied, setCopied] = useState(false);

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
    // Initial fetch / ensure
    loadOrGenerateCode();

    // Live subscription to any profile updates in Firestore
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

    return () => {
      unsub();
    };
  }, [uid, loadOrGenerateCode]);

  const copyCode = async () => {
    if (!profile?.connectionCode) return;
    await Clipboard.setStringAsync(profile.connectionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const code = profile?.connectionCode;

  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Account</Text>
        <Text style={styles.value}>Email: {email ?? '—'}</Text>
        <Text style={styles.value}>Name: {displayName ?? '—'}</Text>
        <Text style={styles.small}>UID: {uid}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>My Connection Code</Text>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#2e7d32" style={{ marginVertical: 8 }} />
            <Text style={styles.loadingText}>Loading your connection code...</Text>
          </View>
        ) : code ? (
          <>
            <Text style={styles.code}>{code}</Text>
            <TouchableOpacity style={styles.copyButton} onPress={copyCode} activeOpacity={0.8}>
              <Text style={styles.copyButtonText}>{copied ? '✓ Copied!' : '📋 Copy code'}</Text>
            </TouchableOpacity>
            <Text style={styles.small}>Share this code with someone so they can connect with you.</Text>
          </>
        ) : (
          <View style={styles.errorBox}>
            <Text style={styles.error}>
              {profileError || 'Could not load your connection code.'}
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadOrGenerateCode}>
              <Text style={styles.retryButtonText}>🔄 Retry Loading Code</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connections</Text>
        {connections.length === 0 ? (
          <Text style={styles.small}>No connections yet.</Text>
        ) : (
          connections.map((c) => (
            <View key={c.otherUid} style={styles.connectionCard}>
              <Text style={styles.connectionTitle}>Connected</Text>
              <Text style={styles.value}>
                Person: {c.profile?.displayName || c.profile?.email || c.otherUid}
              </Text>
              <Text style={styles.connectionStatus}>Status: {c.status}</Text>
            </View>
          ))
        )}
      </View>

      <Button title="Connect to someone" onPress={onConnect} />
      <View style={{ marginTop: 12 }}>
        <Button title="Create Nudgr" onPress={onCreate} color="#2e7d32" />
      </View>
      <View style={{ marginTop: 12 }}>
        <Button title="My Nudgrs" onPress={onOpenList} />
      </View>
      <View style={{ marginTop: 12 }}>
        <Button title="Sign Out" onPress={onSignOut} color="#b71c1c" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginVertical: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
  },
  value: {
    fontSize: 15,
    color: '#333',
    marginBottom: 4,
  },
  small: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  code: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2e7d32',
    letterSpacing: 4,
    marginBottom: 8,
  },
  copyButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  loadingText: {
    fontSize: 13,
    color: '#666',
  },
  errorBox: {
    marginTop: 4,
  },
  error: {
    color: '#c62828',
    fontSize: 13,
    marginBottom: 8,
  },
  retryButton: {
    backgroundColor: '#e8f5e9',
    borderColor: '#2e7d32',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  retryButtonText: {
    color: '#2e7d32',
    fontSize: 13,
    fontWeight: '600',
  },
  connectionCard: {
    backgroundColor: '#e8f5e9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  connectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2e7d32',
    marginBottom: 2,
  },
  connectionStatus: {
    fontSize: 13,
    color: '#2e7d32',
    marginTop: 2,
  },
});