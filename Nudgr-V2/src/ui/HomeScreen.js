import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import SideMenu, { HamburgerButton } from './SideMenu';
import AmbientBackground from './AmbientBackground';
import PermissionNotice from './PermissionNotice';
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
    else if (screen === 'create') onCreate();
    else if (screen === 'list') onOpenList();
  };

  // Determine time-appropriate greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const formattedName = displayName
    ? (displayName.split(' ')[0] || 'there').toUpperCase()
    : 'THERE';
  const isConnected = connections.length > 0;
  const connectionCountText = isConnected
    ? `${connections.length} active connection${connections.length > 1 ? 's' : ''}`
    : 'Ready to connect';

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F7FC" />

      {/* ── Soft Ambient Pastel Background ── */}
      <AmbientBackground />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Text style={styles.logoText}>
            Nudgr<Text style={styles.logoDot}>.</Text>
          </Text>
        </View>
        <HamburgerButton
          isOpen={menuOpen}
          onPress={() => setMenuOpen((v) => !v)}
        />
      </View>

      {/* ── Main Content ── */}
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting Section ── */}
        <View style={styles.greetingSection}>
          <Text style={styles.greetingPretitle}>{getGreeting()},</Text>
          <Text style={styles.greetingTitle}>{formattedName}</Text>

          <View style={[styles.statusPill, !isConnected && styles.statusPillInactive]}>
            <View style={[styles.statusDot, !isConnected && styles.statusDotInactive]} />
            <Text style={[styles.statusPillText, !isConnected && styles.statusPillTextInactive]}>
              {connectionCountText}
            </Text>
          </View>
        </View>

        {/* ── Hero Create Card ── */}
        <PermissionNotice />
        <TouchableOpacity
          style={styles.heroCard}
          onPress={onCreate}
          activeOpacity={0.88}
        >
          {/* Subtle soft lavender glow wash on the right edge */}
          <View style={styles.heroLavenderWash} pointerEvents="none" />

          <View style={styles.heroContent}>
            {/* Violet rounded-square container with plus icon */}
            <View style={styles.heroIconBox}>
              <Text style={styles.heroPlusSymbol}>+</Text>
            </View>

            {/* Title & Subtitle */}
            <View style={styles.heroTextContainer}>
              <Text style={styles.heroTitle}>Create a Nudgr</Text>
              <Text style={styles.heroDescription}>
                Send a reminder that arrives at the right place.
              </Text>
            </View>

            {/* Circular Chevron */}
            <View style={styles.heroChevronBox}>
              <Text style={styles.heroChevron}>›</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* ── Dashboard Section Divider ── */}
        <View style={styles.sectionRow}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionHeader}>DASHBOARD</Text>
          <View style={styles.sectionLine} />
        </View>

        {/* ── My Nudgrs Card ── */}
        <TouchableOpacity
          style={styles.dashCard}
          onPress={onOpenList}
          activeOpacity={0.85}
        >
          {/* Subtle soft mint wash on right */}
          <View style={styles.dashMintWash} pointerEvents="none" />

          {/* Mint rounded-square container with clean horizontal lines */}
          <View style={styles.dashIconBoxMint}>
            <View style={styles.mintListIcon}>
              <View style={styles.mintListLine} />
              <View style={styles.mintListLine} />
              <View style={styles.mintListLine} />
            </View>
          </View>

          <View style={styles.dashTextContainer}>
            <Text style={styles.dashCardTitle}>My Nudgrs</Text>
            <Text style={styles.dashCardSubtitle}>Active, sent & received reminders</Text>
          </View>

          <View style={styles.dashChevronBox}>
            <Text style={styles.dashChevron}>›</Text>
          </View>
        </TouchableOpacity>

        {/* ── My Connection Card ── */}
        <TouchableOpacity
          style={styles.dashCard}
          onPress={onOpenMyConnection}
          activeOpacity={0.85}
        >
          {/* Subtle soft lavender wash on right */}
          <View style={styles.dashLavenderWash} pointerEvents="none" />

          {/* Lavender rounded-square container with people icon */}
          <View style={styles.dashIconBoxLavender}>
            <Text style={styles.peopleIconGlyph}>👥</Text>
          </View>

          <View style={styles.dashTextContainer}>
            <Text style={styles.dashCardTitle}>My Connection</Text>
            <Text style={styles.dashCardSubtitle}>
              {isConnected
                ? `${connections.length} person${connections.length > 1 ? 's' : ''} connected`
                : 'Pair with friends or family'}
            </Text>
          </View>

          <View style={styles.dashChevronBox}>
            <Text style={styles.dashChevron}>›</Text>
          </View>
        </TouchableOpacity>

        {/* ── Empty-state Hint ── */}
        {!isConnected && (
          <View style={styles.hintCard}>
            <View style={styles.hintIconBox}>
              <Text style={styles.hintIconGlyph}>💡</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hintTitle}>Get Connected</Text>
              <Text style={styles.hintBody}>
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

      {/* ── Side Menu Drawer ── */}
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
    backgroundColor: '#F6F7FC',
  },

  // ── Header ───────────────────────────────────────────────────────────────
  header: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.6,
  },
  logoDot: {
    color: '#6366F1',
    fontWeight: '900',
  },

  // ── Scroll Container ──────────────────────────────────────────────────────
  scrollContainer: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 60,
  },

  // ── Greeting ─────────────────────────────────────────────────────────────
  greetingSection: {
    marginBottom: 24,
    paddingTop: 8,
  },
  greetingPretitle: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  greetingTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.2,
    marginBottom: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.85)',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  statusPillInactive: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  statusDotInactive: {
    backgroundColor: '#94A3B8',
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
  },
  statusPillTextInactive: {
    color: '#64748B',
  },

  // ── Hero Create Card ──────────────────────────────────────────────────────
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 22,
    elevation: 5,
    overflow: 'hidden',
  },
  heroLavenderWash: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 150,
    height: 160,
    borderRadius: 75,
    backgroundColor: 'rgba(224, 231, 255, 0.50)',
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroIconBox: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 12,
    elevation: 6,
  },
  heroPlusSymbol: {
    fontSize: 32,
    color: '#FFFFFF',
    fontWeight: '300',
    lineHeight: 34,
  },
  heroTextContainer: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  heroDescription: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '400',
    lineHeight: 18,
    marginTop: 4,
  },
  heroChevronBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroChevron: {
    fontSize: 22,
    color: '#6366F1',
    fontWeight: '500',
    lineHeight: 24,
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
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    letterSpacing: 1.2,
    marginHorizontal: 16,
  },

  // ── Dashboard Cards ───────────────────────────────────────────────────────
  dashCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 18,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
    overflow: 'hidden',
    gap: 14,
  },
  dashMintWash: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(209, 250, 229, 0.40)',
  },
  dashLavenderWash: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(238, 242, 255, 0.55)',
  },
  dashIconBoxMint: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  mintListIcon: {
    width: 18,
    height: 14,
    justifyContent: 'space-between',
  },
  mintListLine: {
    width: 18,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: '#059669',
  },
  dashIconBoxLavender: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  peopleIconGlyph: {
    fontSize: 20,
  },
  dashTextContainer: {
    flex: 1,
  },
  dashCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  dashCardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '400',
    marginTop: 3,
  },
  dashChevronBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashChevron: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '400',
    lineHeight: 22,
  },

  // ── Hint Card ─────────────────────────────────────────────────────────────
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  hintIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  hintIconGlyph: {
    fontSize: 18,
  },
  hintTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  hintBody: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
  },
  hintLink: {
    color: '#6366F1',
    fontWeight: '700',
  },
});
