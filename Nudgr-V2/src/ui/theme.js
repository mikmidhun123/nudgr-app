/**
 * Nudgr iPhone Glassmorphism Design System Tokens
 */

export const THEME = {
  colors: {
    // Foundations
    bg: '#070A12',
    bgDark: '#05070D',
    bgCard: 'rgba(255, 255, 255, 0.06)',
    bgCardElevated: 'rgba(255, 255, 255, 0.09)',
    bgInput: 'rgba(255, 255, 255, 0.05)',
    bgSubtle: 'rgba(255, 255, 255, 0.03)',

    // Glass borders
    glassBorder: 'rgba(255, 255, 255, 0.12)',
    glassBorderHighlight: 'rgba(255, 255, 255, 0.20)',
    glassBorderSubtle: 'rgba(255, 255, 255, 0.07)',

    // Typography
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(255, 255, 255, 0.65)',
    textTertiary: 'rgba(255, 255, 255, 0.40)',
    textDisabled: 'rgba(255, 255, 255, 0.28)',

    // Accents (Apple soft blue/purple)
    accentPrimary: '#8B7CFF',
    accentPrimaryGlow: 'rgba(139, 124, 255, 0.25)',
    accentSecondary: '#5AC8FA',
    accentSecondaryGlow: 'rgba(90, 200, 250, 0.20)',

    // Semantics
    success: '#30D158',
    successBg: 'rgba(48, 209, 88, 0.15)',
    successBorder: 'rgba(48, 209, 88, 0.35)',

    danger: '#FF453A',
    dangerBg: 'rgba(255, 69, 58, 0.15)',
    dangerBorder: 'rgba(255, 69, 58, 0.35)',

    warning: '#FF9F0A',
    warningBg: 'rgba(255, 159, 10, 0.15)',

    accentTag: 'rgba(139, 124, 255, 0.14)',
    accentTagBorder: 'rgba(139, 124, 255, 0.30)',
  },

  radius: {
    card: 24,
    cardLg: 28,
    button: 18,
    input: 16,
    pill: 9999,
  },

  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 4,
  },

  glassCardElevated: {
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 6,
  },

  buttonPrimary: {
    backgroundColor: '#8B7CFF',
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B7CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },

  buttonGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
};
