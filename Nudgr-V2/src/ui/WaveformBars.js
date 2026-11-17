import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

function WaveBar({ index, active, color, minHeight = 5, maxHeight = 24 }) {
  const heightVal = useSharedValue(minHeight);

  useEffect(() => {
    if (!active) {
      cancelAnimation(heightVal);
      heightVal.value = withTiming(minHeight, { duration: 180 });
      return;
    }

    const peak = minHeight + ((index * 37) % (maxHeight - minHeight + 1));
    const duration = 260 + ((index * 53) % 240);

    heightVal.value = withDelay(
      (index * 45) % 300,
      withRepeat(
        withSequence(
          withTiming(Math.max(minHeight + 4, peak), {
            duration,
            easing: Easing.inOut(Easing.quad),
          }),
          withTiming(minHeight + 2, {
            duration,
            easing: Easing.inOut(Easing.quad),
          })
        ),
        -1,
        true
      )
    );

    return () => {
      cancelAnimation(heightVal);
    };
  }, [active, heightVal, index, maxHeight, minHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: heightVal.value,
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        { backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}

/**
 * Live Reanimated equalizer waveform bars for voice recording and audio playback.
 */
export default function WaveformBars({
  active = false,
  barCount = 18,
  color = '#6366F1',
  maxHeight = 24,
  style,
}) {
  const bars = Array.from({ length: barCount }, (_, i) => i);
  return (
    <View style={[styles.row, { height: maxHeight + 4 }, style]}>
      {bars.map((i) => (
        <WaveBar
          key={i}
          index={i}
          active={active}
          color={color}
          maxHeight={maxHeight}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3.5,
  },
  bar: {
    width: 3.5,
    borderRadius: 2,
  },
});
