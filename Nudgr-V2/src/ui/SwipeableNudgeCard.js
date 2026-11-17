import React from 'react';
import { StyleSheet, Text, View, Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  Extrapolation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;
export const SWIPE_ACTION_THRESHOLD = 104;

function triggerSwipeHaptic() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  } catch (_) {}
}

/**
 * Left-to-Right Swipeable Nudgr Card.
 * - For Sent Nudgrs (isReceived === false): swiping left-to-right reveals a crimson Delete rail
 *   that deletes both the Firestore Nudgr document and the Cloudflare R2 voice recording.
 * - For Received Nudgrs (isReceived === true): swiping left-to-right reveals an amber Hide rail
 *   that hides the Nudgr on the recipient's phone until the sender turns that Nudgr ON again.
 */
export default function SwipeableNudgeCard({
  isReceived = false,
  disabled = false,
  onSwipeRightAction,
  children,
}) {
  const translateX = useSharedValue(0);
  const crossedRef = useSharedValue(false);

  const handleActionTriggered = () => {
    if (typeof onSwipeRightAction === 'function') {
      onSwipeRightAction();
    }
  };

  const resetPosition = () => {
    translateX.value = withSpring(0, { damping: 20, stiffness: 220 });
  };

  const panGesture = Gesture.Pan()
    .enabled(!disabled)
    // Activate only on intentional horizontal left-to-right drag; yield vertical drags to ScrollView
    .activeOffsetX([14, 999])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      const clampedX = Math.max(0, Math.min(SCREEN_WIDTH * 0.75, event.translationX));
      translateX.value = clampedX;

      if (clampedX >= SWIPE_ACTION_THRESHOLD && !crossedRef.value) {
        crossedRef.value = true;
        runOnJS(triggerSwipeHaptic)();
      } else if (clampedX < SWIPE_ACTION_THRESHOLD && crossedRef.value) {
        crossedRef.value = false;
      }
    })
    .onEnd((event) => {
      crossedRef.value = false;
      if (event.translationX >= SWIPE_ACTION_THRESHOLD || (event.translationX > 60 && event.velocityX > 650)) {
        if (isReceived) {
          // Smoothly slide out to the right for instant recipient hide
          translateX.value = withTiming(SCREEN_WIDTH, { duration: 220 }, (finished) => {
            if (finished) {
              runOnJS(handleActionTriggered)();
            }
          });
        } else {
          // Snap back while opening the sender delete confirmation dialog
          translateX.value = withSpring(0, { damping: 18, stiffness: 200 });
          runOnJS(handleActionTriggered)();
        }
      } else {
        runOnJS(resetPosition)();
      }
    });

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const railAnimatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, 28, SWIPE_ACTION_THRESHOLD],
      [0, 0.7, 1],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      translateX.value,
      [0, SWIPE_ACTION_THRESHOLD],
      [0.88, 1.04],
      Extrapolation.CLAMP
    );
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  return (
    <View style={styles.wrapper}>
      {/* Left-to-Right Action Backdrop Rail */}
      <View
        style={[
          styles.backdropRail,
          isReceived ? styles.backdropHide : styles.backdropDelete,
        ]}
        pointerEvents="none"
      >
        <Animated.View style={[styles.railContent, railAnimatedStyle]}>
          <View style={[styles.railIconCircle, isReceived ? styles.railIconHide : styles.railIconDelete]}>
            <Text style={styles.railIconGlyph}>{isReceived ? '👁' : '🗑'}</Text>
          </View>
          <View>
            <Text style={styles.railTitle}>
              {isReceived ? 'Slide right to Hide' : 'Slide right to Delete'}
            </Text>
            <Text style={styles.railSubtitle}>
              {isReceived
                ? 'Reappears if sender turns ON'
                : 'Deletes Nudgr & R2 voice audio'}
            </Text>
          </View>
        </Animated.View>
      </View>

      {/* Foreground Card */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={cardAnimatedStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    marginBottom: 14,
  },
  backdropRail: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 20,
    paddingRight: 16,
  },
  backdropDelete: {
    backgroundColor: '#EF4444',
  },
  backdropHide: {
    backgroundColor: '#F59E0B',
  },
  railContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  railIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railIconDelete: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  railIconHide: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  railIconGlyph: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  railTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  railSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 1,
  },
});
