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
} from 'react-native';
import { getAuth } from '../firebase';
import { THEME } from './theme';

const AUTH_ERRORS = {
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
      <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bg} />

      <View style={styles.brandBox}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoBadgeText}>N</Text>
        </View>
        <Text style={styles.title}>
          Nudgr<Text style={styles.titleDot}>.</Text>
        </Text>
        <Text style={styles.subtitle}>
          {isSignup ? 'Create an account to start connecting' : 'Welcome back'}
        </Text>
      </View>

      <View style={styles.card}>
        {isSignup && (
          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={THEME.colors.textTertiary}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            autoCorrect={false}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor={THEME.colors.textTertiary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={THEME.colors.textTertiary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error && (
          <View style={styles.errorBox}>
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
            <Text style={styles.primaryButtonText}>{isSignup ? 'Create Account' : 'Sign In'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={switchMode} disabled={busy} style={styles.switchBtn} activeOpacity={0.7}>
          <Text style={styles.switchText}>
            {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            <Text style={styles.switchHighlight}>{isSignup ? 'Sign in' : 'Sign up'}</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.bg,
    padding: 24,
    justifyContent: 'center',
  },
  brandBox: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: THEME.colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  logoBadgeText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -1,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.8,
  },
  titleDot: {
    color: THEME.colors.accentPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    backgroundColor: THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: THEME.radius.cardLg,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 6,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: THEME.colors.textPrimary,
    marginBottom: 14,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  primaryButton: {
    ...THEME.buttonPrimary,
    borderRadius: 16,
    paddingVertical: 15,
    marginTop: 4,
    marginBottom: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  switchBtn: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  switchText: {
    color: THEME.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  switchHighlight: {
    color: THEME.colors.accentSecondary,
    fontWeight: '700',
  },
});