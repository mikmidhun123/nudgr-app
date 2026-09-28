import React, { useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, PanResponder, TouchableOpacity } from 'react-native';
import {
  RADIUS_MIN_KM,
  RADIUS_MAX_KM,
  RADIUS_DEFAULT_KM,
} from '../location/triggerEngine';
import { THEME } from './theme';

const STEP_KM = 0.1;

/**
 * Smooth, precise, user-controlled trigger radius slider in iPhone Glass style.
 * Range: 2.5 km (min) … 10.0 km (max), 0.1 km fine increments.
 */
export default function RadiusSlider({ value, onChange }) {
  const trackRef = useRef(null);
  const trackLayoutRef = useRef({ pageX: 0, width: 250 });
  const [trackWidth, setTrackWidth] = useState(0);

  const current = typeof value === 'number' && !isNaN(value) ? value : RADIUS_DEFAULT_KM;
  const clampedCurrent = Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, Math.round(current * 10) / 10));

  const fraction = Math.min(
    1,
    Math.max(0, (clampedCurrent - RADIUS_MIN_KM) / (RADIUS_MAX_KM - RADIUS_MIN_KM))
  );

  const calculateValueFromPageX = useCallback((pageX) => {
    const { pageX: trackPageX, width } = trackLayoutRef.current;
    if (!width || width <= 0) return clampedCurrent;

    const relX = pageX - trackPageX;
    const f = Math.min(1, Math.max(0, relX / width));
    const rawVal = RADIUS_MIN_KM + f * (RADIUS_MAX_KM - RADIUS_MIN_KM);

    // Round to 0.1 km precision
    const steppedVal = Math.round(rawVal / STEP_KM) * STEP_KM;
    const finalVal = Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, Number(steppedVal.toFixed(1))));

    return finalVal;
  }, [clampedCurrent]);

  const updateTrackMeasurement = () => {
    trackRef.current?.measure((x, y, width, height, pageX) => {
      if (width && width > 0) {
        trackLayoutRef.current = { pageX, width };
        setTrackWidth(width);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt) => {
        updateTrackMeasurement();
        const pageX = evt.nativeEvent.pageX;
        const newVal = calculateValueFromPageX(pageX);
        onChange(newVal);
      },

      onPanResponderMove: (evt, gestureState) => {
        const pageX = gestureState.moveX || evt.nativeEvent.pageX;
        const newVal = calculateValueFromPageX(pageX);
        onChange(newVal);
      },

      onPanResponderRelease: (evt, gestureState) => {
        const pageX = gestureState.moveX || evt.nativeEvent.pageX;
        const newVal = calculateValueFromPageX(pageX);
        onChange(newVal);
      },
    })
  ).current;

  const adjustBy = (delta) => {
    const nextVal = Math.min(
      RADIUS_MAX_KM,
      Math.max(RADIUS_MIN_KM, Number((clampedCurrent + delta).toFixed(1)))
    );
    onChange(nextVal);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.label}>TRIGGER RADIUS</Text>
          <Text style={styles.sublabel}>Distance from arrival target</Text>
        </View>
        <View style={styles.valueBadge}>
          <Text style={styles.valueText}>{clampedCurrent.toFixed(1)} km</Text>
        </View>
      </View>

      <View style={styles.sliderRow}>
        <TouchableOpacity
          style={styles.quickStepBtn}
          onPress={() => adjustBy(-0.5)}
          activeOpacity={0.7}
        >
          <Text style={styles.quickStepText}>-0.5</Text>
        </TouchableOpacity>

        <View
          style={styles.touchArea}
          onLayout={(e) => {
            const { width } = e.nativeEvent.layout;
            if (width > 0) {
              setTrackWidth(width);
            }
            updateTrackMeasurement();
          }}
          {...panResponder.panHandlers}
        >
          <View ref={trackRef} style={styles.track}>
            <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
            <View style={[styles.thumb, { left: `${fraction * 100}%` }]} />
          </View>
        </View>

        <TouchableOpacity
          style={styles.quickStepBtn}
          onPress={() => adjustBy(0.5)}
          activeOpacity={0.7}
        >
          <Text style={styles.quickStepText}>+0.5</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.boundRow}>
        <Text style={styles.boundText}>{RADIUS_MIN_KM.toFixed(1)} km</Text>
        <Text style={styles.hintText}>Smooth 0.1 km precision</Text>
        <Text style={styles.boundText}>{RADIUS_MAX_KM.toFixed(1)} km</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
    backgroundColor: THEME.colors.bgCard,
    borderRadius: THEME.radius.card,
    borderWidth: 1,
    borderColor: THEME.colors.glassBorder,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.textSecondary,
    letterSpacing: 1.2,
  },
  sublabel: {
    fontSize: 12,
    color: THEME.colors.textTertiary,
    marginTop: 2,
  },
  valueBadge: {
    backgroundColor: 'rgba(139, 124, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(139, 124, 255, 0.40)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: THEME.radius.pill,
  },
  valueText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  quickStepBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  quickStepText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.accentSecondary,
  },
  touchArea: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  track: {
    position: 'relative',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
    backgroundColor: THEME.colors.accentPrimary,
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: THEME.colors.accentPrimary,
    marginLeft: -12,
    top: -8,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  boundRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  boundText: {
    fontSize: 11,
    color: THEME.colors.textTertiary,
    fontWeight: '600',
  },
  hintText: {
    fontSize: 11,
    color: THEME.colors.textTertiary,
  },
});
