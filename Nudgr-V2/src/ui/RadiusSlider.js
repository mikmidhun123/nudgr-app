import React, { useRef, useState, useCallback } from 'react';
import { StyleSheet, Text, View, PanResponder, TouchableOpacity } from 'react-native';
import {
  RADIUS_MIN_KM,
  RADIUS_MAX_KM,
  RADIUS_DEFAULT_KM,
} from '../location/triggerEngine';

const STEP_KM = 0.1;

/**
 * Smooth, precise, user-controlled trigger radius slider.
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
        <Text style={styles.label}>Trigger radius</Text>
        <Text style={styles.valueBadge}>{clampedCurrent.toFixed(1)} km</Text>
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
        <Text style={styles.hintText}>Drag smoothly (0.1 km precision)</Text>
        <Text style={styles.boundText}>{RADIUS_MAX_KM.toFixed(1)} km</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  valueBadge: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#2e7d32',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  quickStepBtn: {
    backgroundColor: '#f1f8e9',
    borderColor: '#c8e6c9',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  quickStepText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2e7d32',
  },
  touchArea: {
    flex: 1,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  track: {
    position: 'relative',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#c8e6c9',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
    backgroundColor: '#2e7d32',
  },
  thumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2e7d32',
    borderWidth: 3,
    borderColor: '#ffffff',
    marginLeft: -13,
    top: -9,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  boundRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  boundText: {
    fontSize: 12,
    color: '#888',
    fontWeight: '500',
  },
  hintText: {
    fontSize: 11,
    color: '#aaa',
  },
});
