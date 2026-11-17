import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

function PulseRing({ delayMs = 0, size = 156, color = '#6366F1', active = true }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, {
          duration: 2400,
          easing: Easing.out(Easing.cubic),
        }),
        -1,
        false
      )
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [active, delayMs, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.85, 1.65]);
    const opacity = interpolate(progress.value, [0, 0.2, 1], [0, 0.48, 0]);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

/**
 * Animated concentric radar pulse rings for incoming call / active geofence states.
 */
export default function RadarPulse({
  active = true,
  size = 156,
  color = '#6366F1',
  children,
}) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <PulseRing delayMs={0} size={size} color={color} active={active} />
      <PulseRing delayMs={800} size={size} color={color} active={active} />
      <PulseRing delayMs={1600} size={size} color={color} active={active} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'rgba(99, 102, 241, 0.06)',
  },
});
