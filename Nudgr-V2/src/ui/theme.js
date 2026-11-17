/**
 * Nudgr — Premium Pastel Glassmorphism Design System
 * Version 4.0 — Bright Pastel Glassmorphism & Refined Editorial Typography
 */

export const THEME = {
  colors: {
    // ── Foundations ─────────────────────────────────────────────────────────
    bg: '#F6F7FC',              // soft off-white with subtle lavender tint
    bgSurface: '#FFFFFF',       // pure white card surface
    bgCard: '#FFFFFF',          // clean translucent-feel card surface
    bgCardElevated: '#FFFFFF',
    bgCardHero: '#FFFFFF',
    bgInput: '#F8FAFC',         // soft input background
    bgSubtle: '#F1F5F9',        // subtle neutral surface
    bgOverlay: 'rgba(15, 23, 42, 0.45)', // gentle backdrop overlay

    // ── Glass Borders & Dividers ─────────────────────────────────────────────
    glassBorder: 'rgba(255, 255, 255, 0.95)',
    glassBorderHighlight: '#FFFFFF',
    glassBorderSubtle: '#E2E8F0',
    cardBorder: 'rgba(255, 255, 255, 0.95)',
    divider: '#E2E8F0',
    accentBorder: 'rgba(99, 102, 241, 0.35)',
    accentBorderSubtle: 'rgba(99, 102, 241, 0.18)',

    // ── Typography ───────────────────────────────────────────────────────────
    textPrimary: '#0F172A',     // deep midnight navy
    textSecondary: '#64748B',   // muted blue-gray
    textTertiary: '#94A3B8',    // soft slate gray
    textDisabled: '#CBD5E1',    // disabled gray
    textAccent: '#6366F1',      // vibrant periwinkle/violet

    // ── Accents — Primary Violet / Periwinkle ────────────────────────────────
    accentPrimary: '#6366F1',
    accentPrimaryLight: '#818CF8',
    accentPrimaryGlow: 'rgba(99, 102, 241, 0.30)',
    accentPrimaryFaint: 'rgba(99, 102, 241, 0.08)',
    accentViolet: '#7C3AED',

    // ── Accents — Mint / Emerald ─────────────────────────────────────────────
    accentSecondary: '#059669', // forest/emerald text
    accentSecondaryGlow: 'rgba(16, 185, 129, 0.25)',
    accentSecondaryFaint: 'rgba(16, 185, 129, 0.08)',
    accentMint: '#10B981',
    accentMintBg: '#ECFDF5',
    accentMintBorder: 'rgba(167, 243, 208, 0.8)',
    accentMintText: '#059669',

    // ── Accents — Pastel Blue & Pink ─────────────────────────────────────────
    accentBlue: '#38BDF8',
    accentBlueBg: 'rgba(56, 189, 248, 0.10)',
    accentPink: '#EC4899',
    accentPinkBg: 'rgba(236, 72, 153, 0.09)',

    // ── Semantic ─────────────────────────────────────────────────────────────
    success: '#10B981',
    successBg: '#ECFDF5',
    successBorder: 'rgba(167, 243, 208, 0.8)',
    successText: '#059669',

    danger: '#EF4444',
    dangerBg: '#FEF2F2',
    dangerBorder: 'rgba(254, 202, 202, 0.8)',
    dangerText: '#DC2626',

    warning: '#F59E0B',
    warningBg: '#FFFBEB',
    warningBorder: 'rgba(253, 230, 138, 0.8)',
    warningText: '#D97706',

    // ── Tag & Icon Surfaces ──────────────────────────────────────────────────
    tagPurple: '#EEF2FF',
    tagPurpleBorder: 'rgba(199, 210, 254, 0.8)',
    tagTeal: '#ECFDF5',
    tagTealBorder: 'rgba(167, 243, 208, 0.8)',
    tagPink: '#FDF2F8',
    tagPinkBorder: 'rgba(251, 207, 232, 0.8)',
  },

  // ── Border Radii ───────────────────────────────────────────────────────────
  radius: {
    xs: 8,
    sm: 12,
    md: 16,
    card: 22,
    cardLg: 26,
    cardXl: 28,
    button: 18,
    input: 16,
    pill: 9999,
  },

  // ── Spacing ────────────────────────────────────────────────────────────────
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
  },

  // ── Typography Scale ───────────────────────────────────────────────────────
  type: {
    display:   { fontSize: 40, fontWeight: '800', letterSpacing: -1.0, lineHeight: 46 },
    title1:    { fontSize: 32, fontWeight: '800', letterSpacing: -0.6, lineHeight: 38 },
    title2:    { fontSize: 26, fontWeight: '700', letterSpacing: -0.4, lineHeight: 32 },
    title3:    { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, lineHeight: 26 },
    headline:  { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, lineHeight: 22 },
    body:      { fontSize: 16, fontWeight: '400', letterSpacing: -0.1, lineHeight: 24 },
    subhead:   { fontSize: 14, fontWeight: '500', letterSpacing: -0.1, lineHeight: 20 },
    caption:   { fontSize: 12, fontWeight: '500', letterSpacing:  0.0, lineHeight: 17 },
    overline:  { fontSize: 11, fontWeight: '700', letterSpacing:  1.1, lineHeight: 15 },
    micro:     { fontSize:  10, fontWeight: '700', letterSpacing: 0.8, lineHeight: 14 },
  },

  // ── Pre-built Style Objects ────────────────────────────────────────────────

  /** Standard bright pastel glass card surface */
  glassCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 24,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
  },

  /** Elevated card with more prominence */
  glassCardElevated: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 26,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 5,
  },

  /** Hero card with pastel accent glow */
  glassCardHero: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 28,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 22,
    elevation: 5,
  },

  /** Primary filled button with periwinkle/violet glow */
  buttonPrimary: {
    backgroundColor: '#6366F1',
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },

  /** Outlined glass button */
  buttonGlass: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  /** Danger-tinted button */
  buttonDanger: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: 'rgba(254, 202, 202, 0.9)',
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /** Success-tinted button */
  buttonSuccess: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.9)',
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
};
