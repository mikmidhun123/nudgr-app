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

const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.75, 300);
const ANIMATION_DURATION = 250;

export function HamburgerButton({ isOpen, onPress }) {
  const topRotate = useRef(new Animated.Value(0)).current;
  const midOpacity = useRef(new Animated.Value(1)).current;
  const botRotate = useRef(new Animated.Value(0)).current;
  // Vertical shift so lines converge at centre when forming X
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
        toValue: isOpen ? 8 : 0,
        duration: ANIMATION_DURATION,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(botTranslateY, {
        toValue: isOpen ? -8 : 0,
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
  },
  bar: {
    width: 20,
    height: 2.2,
    borderRadius: 2,
    backgroundColor: '#1a1a1a',
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
        toValue: isOpen ? 0.4 : 0,
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

  if (!isOpen && translateX._value === -DRAWER_WIDTH) {
    // Fully hidden — skip rendering backdrop to save layout cost
  }

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
          <Text style={styles.drawerTitle}>Nudgr</Text>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => navigate('profile')}
          activeOpacity={0.7}
        >
          <Text style={styles.menuItemIcon}>👤</Text>
          <Text style={styles.menuItemText}>Profile</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => navigate('myconnection')}
          activeOpacity={0.7}
        >
          <Text style={styles.menuItemIcon}>🔗</Text>
          <Text style={styles.menuItemText}>My Connection</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.drawerFooter}>
          <Text style={styles.drawerFooterText}>Nudgr V2</Text>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000',
    zIndex: 100,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: 'rgba(255,255,255,0.97)',
    zIndex: 101,
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
    paddingTop: (StatusBar.currentHeight || 0) + 16,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  drawerLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerLogoText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -1,
  },
  drawerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.07)',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    marginHorizontal: 8,
    marginVertical: 2,
    gap: 14,
  },
  menuItemIcon: {
    fontSize: 20,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  drawerFooter: {
    position: 'absolute',
    bottom: 32,
    left: 20,
  },
  drawerFooterText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },
});
