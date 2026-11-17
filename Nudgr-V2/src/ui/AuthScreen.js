import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ScrollView,
} from 'react-native';
import { getAuth } from '../firebase';
import { ensureUserProfile } from '../db/users';
import AmbientBackground from './AmbientBackground';
import { THEME } from './theme';

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/user-not-found': 'No account found for that email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/email-already-in-use': 'An account already exists for that email.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/network-request-failed': 'Network error. Please try again.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
};

function friendlyAuthError(e) {
  return AUTH_ERRORS[e?.code] || 'Something went wrong. Please try again.';
}

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const switchMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
    setError(null);
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'signup' && !displayName.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const credential = await getAuth().createUserWithEmailAndPassword(email.trim(), password);
        await credential.user.updateProfile({ displayName: displayName.trim() });
        // Auth observers can run before updateProfile completes during signup.
        await ensureUserProfile(credential.user);
      } else {
        await getAuth().signInWithEmailAndPassword(email.trim(), password);
      }
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" />
      <AmbientBackground />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Brand Hero ── */}
        <View style={styles.brandHero}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>N</Text>
          </View>
          <Text style={styles.wordmark}>
            Nudgr<Text style={styles.wordmarkDot}>.</Text>
          </Text>
          <Text style={styles.tagline}>Smart arrival reminders</Text>
        </View>

        {/* ── Mode Switcher Pill ── */}
        <View style={styles.modeSwitcher}>
          <TouchableOpacity
            style={[styles.modeTab, !isSignup && styles.modeTabActive]}
            onPress={() => { setMode('login'); setError(null); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.modeTabText, !isSignup && styles.modeTabTextActive]}>
              Sign In
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeTab, isSignup && styles.modeTabActive]}
            onPress={() => { setMode('signup'); setError(null); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.modeTabText, isSignup && styles.modeTabTextActive]}>
              Create Account
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Form Card ── */}
        <View style={styles.card}>
          <Text style={styles.cardHeading}>
            {isSignup ? 'Welcome to Nudgr' : 'Welcome back'}
          </Text>
          <Text style={styles.cardSubheading}>
            {isSignup
              ? 'Create your account to start sending location reminders.'
              : 'Sign in to continue to your reminders.'}
          </Text>

          {isSignup && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>FULL NAME</Text>
              <TextInput
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor="#94A3B8"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>EMAIL</Text>
            <TextInput
              style={styles.input}
              placeholder="your@email.com"
              placeholderTextColor="#94A3B8"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder={isSignup ? 'Min. 6 characters' : 'Your password'}
              placeholderTextColor="#94A3B8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorDot}>!</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, busy && styles.btnDisabled]}
            onPress={submit}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isSignup ? 'Create Account' : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Switch Mode Footer ── */}
        <TouchableOpacity onPress={switchMode} disabled={busy} style={styles.switchBtn} activeOpacity={0.7}>
          <Text style={styles.switchText}>
            {isSignup ? 'Already have an account?' : "Don't have an account?"}
            {'  '}
            <Text style={styles.switchHighlight}>
              {isSignup ? 'Sign in' : 'Sign up'}
            </Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F7FC',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'center',
  },

  // ── Brand Hero ──────────────────────────────────────────────────────────────
  brandHero: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  logoBadgeText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -1.5,
  },
  wordmark: {
    fontSize: 36,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -1,
  },
  wordmarkDot: {
    color: '#6366F1',
    fontWeight: '900',
  },
  tagline: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 6,
    letterSpacing: 0.2,
  },

  // ── Mode Switcher ─────────────────────────────────────────────────────────
  modeSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 24,
    padding: 4,
    marginBottom: 20,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 20,
  },
  modeTabActive: {
    backgroundColor: '#6366F1',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.30,
    shadowRadius: 8,
    elevation: 4,
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  modeTabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

  // ── Form Card ─────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 28,
    padding: 24,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    marginBottom: 16,
  },
  cardHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  cardSubheading: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
    marginBottom: 22,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    color: '#0F172A',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.8)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  errorDot: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  errorText: {
    flex: 1,
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  primaryButton: {
    backgroundColor: '#6366F1',
    borderRadius: 18,
    paddingVertical: 15,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  btnDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.1,
  },

  // ── Switch Footer ─────────────────────────────────────────────────────────
  switchBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  switchText: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
  },
  switchHighlight: {
    color: '#6366F1',
    fontWeight: '700',
  },
});
