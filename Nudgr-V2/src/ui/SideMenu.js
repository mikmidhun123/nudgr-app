import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  BackHandler,
} from 'react-native';

const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.78, 320);
const ANIMATION_DURATION = 260;

// ─── Hamburger / Close Button ──────────────────────────────────────────────

export function HamburgerButton({ isOpen, onPress }) {
  const topRotate = useRef(new Animated.Value(isOpen ? 1 : 0)).current;
  const midOpacity = useRef(new Animated.Value(isOpen ? 0 : 1)).current;
  const botRotate = useRef(new Animated.Value(isOpen ? 1 : 0)).current;
  const topTranslateY = useRef(new Animated.Value(isOpen ? 7 : 0)).current;
  const botTranslateY = useRef(new Animated.Value(isOpen ? -7 : 0)).current;

  useEffect(() => {
    const toValue = isOpen ? 1 : 0;
    Animated.parallel([
      Animated.timing(topRotate, {
        toValue,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(midOpacity, {
        toValue: isOpen ? 0 : 1,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(botRotate, {
        toValue,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(topTranslateY, {
        toValue: isOpen ? 7 : 0,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(botTranslateY, {
        toValue: isOpen ? -7 : 0,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [isOpen]);

  const topStyle = {
    transform: [
      { translateY: topTranslateY },
      {
        rotate: topRotate.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '45deg'],
        }),
      },
    ],
  };

  const botStyle = {
    transform: [
      { translateY: botTranslateY },
      {
        rotate: botRotate.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '-45deg'],
        }),
      },
    ],
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={hamburgerStyles.btn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <Animated.View style={[hamburgerStyles.bar, topStyle]} />
      <Animated.View style={[hamburgerStyles.bar, { opacity: midOpacity }]} />
      <Animated.View style={[hamburgerStyles.bar, botStyle]} />
    </TouchableOpacity>
  );
}

const hamburgerStyles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 3,
  },
  bar: {
    width: 18,
    height: 2.2,
    borderRadius: 1.5,
    backgroundColor: '#0F172A',
  },
});

// ─── Side Drawer ─────────────────────────────────────────────────────────────

export default function SideMenu({ isOpen, onClose, onNavigate }) {
  const [rendered, setRendered] = useState(isOpen);
  const translateX = useRef(new Animated.Value(isOpen ? 0 : -DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(isOpen ? 0.35 : 0)).current;

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
    }
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: isOpen ? 0 : -DRAWER_WIDTH,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: isOpen ? 0.35 : 0,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !isOpen) {
        setRendered(false);
      }
    });
  }, [isOpen]);

  // Android back button closes the drawer first when open
  useEffect(() => {
    if (!isOpen) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true; // consumed
    });
    return () => handler.remove();
  }, [isOpen, onClose]);

  const navigate = (screen) => {
    onClose();
    if (screen === 'home') return;
    setTimeout(() => onNavigate(screen), 50); // let close animation start first
  };

  if (!isOpen && !rendered) {
    return null;
  }

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.rootOverlay]}
      pointerEvents={isOpen ? 'auto' : 'none'}
    >
      {/* Visual Dim Backdrop */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents="none"
      />

      {/* Full-Screen Backdrop Touch Target (tapping anywhere outside drawer closes it) */}
      <TouchableOpacity
        style={[StyleSheet.absoluteFillObject, styles.backdropTouch]}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Top-Right Close Cross (matches HomeScreen header position so tapping ✕ always closes) */}
      <View style={styles.topRightCloseContainer} pointerEvents="box-none">
        <HamburgerButton isOpen={true} onPress={onClose} />
      </View>

      {/* Drawer Panel */}
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX }] }]}
        pointerEvents={isOpen ? 'auto' : 'none'}
      >
        {/* Drawer Header */}
        <View style={styles.drawerHeader}>
          <TouchableOpacity
            style={styles.drawerBrandTouch}
            onPress={onClose}
            activeOpacity={0.75}
          >
            <View style={styles.drawerLogoBox}>
              <Text style={styles.drawerLogoText}>N</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.drawerAppName}>
                Nudgr<Text style={styles.drawerDot}>.</Text>
              </Text>
              <Text style={styles.drawerTagline}>Smart location reminders</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Navigation Items */}
        <View style={styles.navSection}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigate('myconnection')}
            activeOpacity={0.75}
          >
            <View style={[styles.menuIconBox, styles.menuIconTeal]}>
              <Text style={styles.menuIconGlyph}>👥</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuItemTitle}>My Connections</Text>
              <Text style={styles.menuItemSub}>Pair with peers & share code</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigate('profile')}
            activeOpacity={0.75}
          >
            <View style={[styles.menuIconBox, styles.menuIconPurple]}>
              <Text style={styles.menuIconGlyph}>👤</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuItemTitle}>Profile & Account</Text>
              <Text style={styles.menuItemSub}>Settings, diagnostics & logout</Text>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Tappable Empty Space Inside Left Drawer (tapping blank area returns to Home) */}
        <TouchableOpacity
          style={styles.drawerEmptyFill}
          activeOpacity={1}
          onPress={onClose}
        >
          <View style={styles.drawerFooter}>
            <View style={styles.footerBadge}>
              <Text style={styles.footerBadgeText}>NUDGR V2</Text>
            </View>
            <Text style={styles.footerSubtext}>Smart Arrival Reminders</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootOverlay: {
    zIndex: 1000,
    elevation: 30,
  },
  backdrop: {
    backgroundColor: '#0F172A',
    zIndex: 100,
  },
  backdropTouch: {
    zIndex: 101,
    backgroundColor: 'transparent',
  },
  topRightCloseContainer: {
    position: 'absolute',
    top: 12,
    right: 24,
    zIndex: 103,
    elevation: 32,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#FFFFFF',
    zIndex: 102,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 31,
    paddingTop: 20,
  },
  drawerBrandTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingBottom: 20,
    gap: 14,
  },
  drawerLogoBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  drawerLogoText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -1,
  },
  drawerAppName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  drawerDot: {
    color: '#6366F1',
    fontWeight: '900',
  },
  drawerTagline: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '400',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 20,
    marginBottom: 16,
  },
  navSection: {
    paddingHorizontal: 14,
    gap: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 20,
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 2,
  },
  menuIconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconPurple: {
    backgroundColor: '#EEF2FF',
  },
  menuIconTeal: {
    backgroundColor: '#ECFDF5',
  },
  menuIconGlyph: {
    fontSize: 18,
  },
  menuItemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  menuItemSub: {
    fontSize: 12,
    color: '#64748B',
  },
  menuChevron: {
    fontSize: 20,
    color: '#94A3B8',
    fontWeight: '300',
  },
  drawerEmptyFill: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 32,
    paddingHorizontal: 22,
  },
  drawerFooter: {
    gap: 6,
  },
  footerBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  footerBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6366F1',
    letterSpacing: 1.5,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '400',
  },
});
