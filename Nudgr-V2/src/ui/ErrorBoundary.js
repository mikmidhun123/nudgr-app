import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { THEME } from './theme';
import AmbientBackground from './AmbientBackground';
import { reportUiError } from '../diagnostics/crashReporting';

/**
 * Top-level error boundary with pastel glassmorphism error state.
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportUiError(error);
    if (__DEV__) {
      console.warn('[error-boundary]', error, info);
    }
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <AmbientBackground />
          <StatusBar barStyle="dark-content" backgroundColor={THEME.colors.bg} />
          <View style={styles.card}>
            {/* Icon */}
            <View style={styles.iconBox}>
              <Text style={styles.iconGlyph}>!</Text>
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <View style={styles.messagePill}>
              <Text style={styles.message} numberOfLines={4}>
                {String(this.state.error.message || this.state.error)}
              </Text>
            </View>
            <TouchableOpacity style={styles.button} onPress={this.handleReset} activeOpacity={0.85}>
              <Text style={styles.buttonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    ...THEME.glassCard,
    padding: 28,
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: THEME.colors.dangerBg,
    borderWidth: 1,
    borderColor: THEME.colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  iconGlyph: {
    fontSize: 28,
    fontWeight: '900',
    color: THEME.colors.danger,
    lineHeight: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  messagePill: {
    backgroundColor: THEME.colors.bgSubtle,
    borderRadius: THEME.radius.xs,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorderSubtle,
    padding: 12,
    width: '100%',
  },
  message: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  button: {
    ...THEME.buttonPrimary,
    width: '100%',
    paddingVertical: 14,
    marginTop: 4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
