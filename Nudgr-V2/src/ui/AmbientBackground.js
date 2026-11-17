import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * AmbientBackground
 * Renders the soft, luminous pastel gradient shapes from the reference design
 * with subtle GPU-composited Reanimated floating motion.
 * Positioned absolutely behind screen content with pointerEvents="none".
 */
export default function AmbientBackground({ style }) {
  const driftA = useSharedValue(0);
  const driftB = useSharedValue(0);

  useEffect(() => {
    driftA.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 9000, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
    driftB.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 12000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 12000, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
    return () => {
      cancelAnimation(driftA);
      cancelAnimation(driftB);
    };
  }, [driftA, driftB]);

  const orbTopStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: driftA.value * 18 - 9 },
      { translateY: driftB.value * 14 - 7 },
    ],
  }));

  const orbBottomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (1 - driftB.value) * 20 - 10 },
      { translateY: (1 - driftA.value) * 16 - 8 },
    ],
  }));

  return (
    <View style={[styles.container, style]} pointerEvents="none">
      {/* Top-right soft lavender/violet glow */}
      <Animated.View style={[styles.topRightLavender, orbTopStyle]} />

      {/* Top-right soft peach/pink bloom */}
      <Animated.View style={[styles.topRightPeach, orbBottomStyle]} />

      {/* Top soft blue sky tint */}
      <View style={styles.topSkyBlue} />

      {/* Bottom sweeping lavender-periwinkle curve */}
      <Animated.View style={[styles.bottomLavenderWave, orbBottomStyle]} />

      {/* Bottom subtle mint touch */}
      <Animated.View style={[styles.bottomMintWash, orbTopStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: '#F6F7FC',
    zIndex: 0,
  },
  topRightLavender: {
    position: 'absolute',
    top: -100,
    right: -70,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(216, 207, 253, 0.50)',
  },
  topRightPeach: {
    position: 'absolute',
    top: 60,
    right: -50,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(254, 226, 236, 0.40)',
  },
  topSkyBlue: {
    position: 'absolute',
    top: -80,
    left: 20,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(224, 238, 255, 0.45)',
  },
  bottomLavenderWave: {
    position: 'absolute',
    bottom: -180,
    left: -100,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: 'rgba(223, 230, 254, 0.55)',
  },
  bottomMintWash: {
    position: 'absolute',
    bottom: 20,
    right: -70,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(209, 250, 229, 0.30)',
  },
});
