import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
  BackHandler,
  StatusBar,
} from 'react-native';
import { THEME } from './theme';

const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.78, 320);
const ANIMATION_DURATION = 250;

export function HamburgerButton({ isOpen, onPress }) {
  const topRotate = useRef(new Animated.Value(0)).current;
  const midOpacity = useRef(new Animated.Value(1)).current;
  const botRotate = useRef(new Animated.Value(0)).current;
  const topTranslateY = useRef(new Animated.Value(0)).current;
  const botTranslateY = useRef(new Animated.Value(0)).current;

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
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  bar: {
    width: 20,
    height: 2,
    borderRadius: 2,
    backgroundColor: THEME.colors.textPrimary,
  },
});

// ─── Side Drawer ────────────────────────────────────────────────────────────

export default function SideMenu({ isOpen, onClose, onNavigate }) {
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: isOpen ? 0 : -DRAWER_WIDTH,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: isOpen ? 0.7 : 0,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    ]).start();
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
    setTimeout(() => onNavigate(screen), 50); // let close animation start first
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View
            style={[StyleSheet.absoluteFillObject, styles.backdrop, { opacity: backdropOpacity }]}
            pointerEvents={isOpen ? 'auto' : 'none'}
          />
        </TouchableWithoutFeedback>
      )}

      {/* Drawer */}
      <Animated.View style={[styles.drawer, { transform: [{ translateX }] }]}>
        <View style={styles.drawerHeader}>
          <View style={styles.drawerLogo}>
            <Text style={styles.drawerLogoText}>N</Text>
          </View>
          <View>
            <Text style={styles.drawerTitle}>Nudgr</Text>
            <Text style={styles.drawerSubtitle}>Smart Location Reminders</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => navigate('profile')}
          activeOpacity={0.7}
        >
          <View style={styles.iconContainer}>
            <Text style={styles.menuItemIcon}>👤</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuItemText}>Profile & Account</Text>
            <Text style={styles.menuItemSubtext}>Settings, diagnostics & logout</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => navigate('myconnection')}
          activeOpacity={0.7}
        >
          <View style={styles.iconContainer}>
            <Text style={styles.menuItemIcon}>🔗</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuItemText}>My Connections</Text>
            <Text style={styles.menuItemSubtext}>Pair with peers & share code</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.drawerFooter}>
          <View style={styles.footerBadge}>
            <Text style={styles.footerBadgeText}>NUDGR V2</Text>
          </View>
          <Text style={styles.drawerFooterText}>iPhone Glass Edition</Text>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000000',
    zIndex: 100,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#0c101d',
    zIndex: 101,
    borderRightWidth: 1,
    borderRightColor: THEME.colors.glassBorder,
    shadowColor: '#000',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
    paddingTop: (StatusBar.currentHeight || 0) + 24,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingBottom: 22,
    gap: 14,
  },
  drawerLogo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: THEME.colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.colors.accentPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 6,
  },
  drawerLogoText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -1,
  },
  drawerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.5,
  },
  drawerSubtitle: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: THEME.colors.glassBorderSubtle,
    marginHorizontal: 18,
    marginVertical: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    marginHorizontal: 12,
    marginVertical: 4,
    gap: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  menuItemIcon: {
    fontSize: 18,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.textPrimary,
    letterSpacing: -0.2,
  },
  menuItemSubtext: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: THEME.colors.textTertiary,
    fontWeight: '300',
  },
  drawerFooter: {
    position: 'absolute',
    bottom: 32,
    left: 22,
    gap: 6,
  },
  footerBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(139, 124, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 124, 255, 0.25)',
  },
  footerBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: THEME.colors.accentPrimary,
    letterSpacing: 1.5,
  },
  drawerFooterText: {
    fontSize: 12,
    color: THEME.colors.textTertiary,
    fontWeight: '500',
  },
});
