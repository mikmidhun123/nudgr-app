import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import SideMenu, { HamburgerButton } from './SideMenu';
import { THEME } from './theme';

export default function HomeScreen({
  uid,
  displayName,
  connections = [],
  onCreate,
  onOpenList,
  onOpenProfile,
  onOpenMyConnection,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const navigate = (screen) => {
    if (screen === 'profile') onOpenProfile();
    else if (screen === 'myconnection') onOpenMyConnection();
  };

  // Determine time-appropriate greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = displayName?.split(' ')[0] || 'there';

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={THEME.colors.bg} />

      {/* Floating Translucent Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>
            Nudgr<Text style={styles.headerDot}>.</Text>
          </Text>
        </View>
        <HamburgerButton
          isOpen={menuOpen}
          onPress={() => setMenuOpen((v) => !v)}
        />
      </View>

      {/* Main Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Dynamic iPhone-style Greeting Header */}
        <View style={styles.greetingSection}>
          <Text style={styles.greetingPretitle}>{getGreeting()},</Text>
          <Text style={styles.greetingTitle}>{firstName}</Text>
          <View style={styles.connectionPill}>
            <View style={styles.connectionPillDot} />
            <Text style={styles.connectionPillText}>
              {connections.length === 0
                ? 'Ready to connect'
                : `${connections.length} active connection${connections.length > 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>

        {/* Quick Create Nudgr — Primary Floating Hero Glass Card */}
        <TouchableOpacity
          style={styles.heroCard}
          onPress={onCreate}
          activeOpacity={0.88}
        >
          {/* Subtle soft ambient glow inside card */}
          <View style={styles.heroGlow} pointerEvents="none" />

          <View style={styles.heroContent}>
            <View style={styles.heroIconBox}>
              <Text style={styles.heroPlusIcon}>＋</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTag}>QUICK ACTION</Text>
              <Text style={styles.heroTitle}>Create a Nudgr</Text>
              <Text style={styles.heroSubtitle}>
                Send a reminder that arrives at the right place.
              </Text>
            </View>
            <Text style={styles.heroChevron}>›</Text>
          </View>
        </TouchableOpacity>

        {/* Section Heading */}
        <Text style={styles.sectionHeader}>DASHBOARD</Text>

        {/* My Nudgrs Floating Glass Card */}
        <TouchableOpacity
          style={styles.glassCard}
          onPress={onOpenList}
          activeOpacity={0.82}
        >
          <View style={[styles.cardIconBox, { backgroundColor: 'rgba(90, 200, 250, 0.12)' }]}>
            <Text style={styles.cardEmoji}>📋</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>My Nudgrs</Text>
            <Text style={styles.cardSubtitle}>View active, sent & received reminders</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Connections Floating Glass Card */}
        <TouchableOpacity
          style={styles.glassCard}
          onPress={onOpenMyConnection}
          activeOpacity={0.82}
        >
          <View style={[styles.cardIconBox, { backgroundColor: 'rgba(139, 124, 255, 0.12)' }]}>
            <Text style={styles.cardEmoji}>🔗</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>My Connection</Text>
            <Text style={styles.cardSubtitle}>
              {connections.length === 0
                ? 'Pair with friends or family'
                : `${connections.length} person${connections.length > 1 ? 's' : ''} connected`}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Empty-state Hint when no connections */}
        {connections.length === 0 && (
          <View style={styles.hintGlassCard}>
            <View style={styles.hintIconBox}>
              <Text style={styles.hintIcon}>💡</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hintTitle}>Get Connected</Text>
              <Text style={styles.hintText}>
                Share your connection code so others can send you arrival Nudgrs.{' '}
                <Text style={styles.hintLink} onPress={onOpenMyConnection}>
                  Open My Connection
                </Text>{' '}
                to view your code.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Side Menu Drawer */}
      <SideMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={navigate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: THEME.colors.bg,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
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
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerDot: {
    color: THEME.colors.accentPrimary,
  },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },
  greetingSection: {
    marginBottom: 28,
  },
  greetingPretitle: {
    fontSize: 16,
    color: THEME.colors.textSecondary,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  greetingTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.8,
    marginTop: 2,
    marginBottom: 10,
  },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: THEME.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 7,
  },
  connectionPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.colors.accentSecondary,
  },
  connectionPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
  },

  // --- Hero Glass Card ---
  heroCard: {
    position: 'relative',
    backgroundColor: 'rgba(139, 124, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 124, 255, 0.35)',
    borderRadius: THEME.radius.cardLg,
    padding: 22,
    marginBottom: 26,
    overflow: 'hidden',
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 8,
  },
  heroGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(139, 124, 255, 0.20)',
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: THEME.colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  heroPlusIcon: {
    fontSize: 26,
    color: '#ffffff',
    fontWeight: '300',
    lineHeight: 28,
  },
  heroTag: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.accentSecondary,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.70)',
    fontWeight: '500',
    lineHeight: 18,
  },
  heroChevron: {
    fontSize: 26,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '300',
  },

  // --- Section header ---
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 12,
    marginLeft: 4,
  },

  // --- Standard Glass Card ---
  glassCard: {
    ...THEME.glassCard,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    marginBottom: 12,
    gap: 14,
  },
  cardIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardEmoji: {
    fontSize: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    fontWeight: '500',
  },
  chevron: {
    fontSize: 22,
    color: THEME.colors.textTertiary,
    fontWeight: '300',
  },

  // --- Hint Glass Card ---
  hintGlassCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: THEME.radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 10,
  },
  hintIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintIcon: {
    fontSize: 16,
  },
  hintTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    marginBottom: 3,
  },
  hintText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    lineHeight: 18,
  },
  hintLink: {
    color: THEME.colors.accentSecondary,
    fontWeight: '700',
  },
});