import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Dimensions,
} from 'react-native';
import SideMenu, { HamburgerButton } from './SideMenu';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  return (
    <View style={styles.screen}>
      {/* App Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer} pointerEvents="none">
          <Text style={styles.headerTitle}>Nudgr</Text>
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
        {/* Greeting */}
        <View style={styles.greetingRow}>
          <Text style={styles.greetingText}>
            Hello, {displayName?.split(' ')[0] || 'there'} 👋
          </Text>
          <Text style={styles.greetingSubText}>
            {connections.length === 0
              ? 'Connect with someone to start sending Nudgrs.'
              : `${connections.length} connection${connections.length > 1 ? 's' : ''}`}
          </Text>
        </View>

        {/* Create Nudgr — Primary CTA */}
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={onCreate}
          activeOpacity={0.85}
        >
          <View style={styles.primaryCtaInner}>
            <Text style={styles.primaryCtaIcon}>＋</Text>
            <View>
              <Text style={styles.primaryCtaTitle}>Create a Nudgr</Text>
              <Text style={styles.primaryCtaSubtitle}>
                Schedule a location or time-based nudge
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* My Nudgrs */}
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={onOpenList}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryCardIcon}>📋</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.secondaryCardTitle}>My Nudgrs</Text>
            <Text style={styles.secondaryCardSubtitle}>View sent and received Nudgrs</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Connections quick link */}
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={onOpenMyConnection}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryCardIcon}>🔗</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.secondaryCardTitle}>My Connection</Text>
            <Text style={styles.secondaryCardSubtitle}>
              {connections.length === 0
                ? 'Connect with someone'
                : `${connections.length} person${connections.length > 1 ? 's' : ''} connected`}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Empty-state hint when no connections */}
        {connections.length === 0 && (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintIcon}>💡</Text>
            <Text style={styles.emptyHintText}>
              Share your connection code so others can send you Nudgrs. Open{' '}
              <Text style={styles.emptyHintLink} onPress={onOpenMyConnection}>
                My Connection
              </Text>{' '}
              to get your code.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Side Menu Overlay (rendered over everything else) */}
      <SideMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={navigate}
      />
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
    fontSize: 19,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  scrollContainer: {
    padding: 16,
    paddingTop: 24,
    paddingBottom: 48,
  },
  greetingRow: {
    marginBottom: 24,
    paddingLeft: 4,
  },
  greetingText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  greetingSubText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  primaryCta: {
    backgroundColor: '#16a34a',
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryCtaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  primaryCtaIcon: {
    fontSize: 36,
    color: '#fff',
    fontWeight: '200',
    lineHeight: 40,
    width: 44,
    textAlign: 'center',
  },
  primaryCtaTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  primaryCtaSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },
  secondaryCard: {
    ...GLASS,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 10,
    gap: 14,
  },
  secondaryCardIcon: {
    fontSize: 24,
  },
  secondaryCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  secondaryCardSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  chevron: {
    fontSize: 22,
    color: '#9ca3af',
    fontWeight: '300',
  },
  emptyHint: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  emptyHintIcon: {
    fontSize: 18,
  },
  emptyHintText: {
    flex: 1,
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
  },
  emptyHintLink: {
    color: '#16a34a',
    fontWeight: '700',
  },
});