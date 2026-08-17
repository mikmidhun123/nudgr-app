import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';

/**
 * Clean, interactive Android time roller/picker component.
 * Allows choosing exact hour (1-12), minute (00-59 in steps or presets), and AM/PM.
 * Default: 6:00 PM (18:00).
 */
export default function TimePickerRoller({
  hour12 = 6,
  minute = 0,
  period = 'PM',
  onChange,
}) {
  const updateTime = (newHour, newMin, newPeriod) => {
    let h12 = newHour;
    if (h12 < 1) h12 = 12;
    if (h12 > 12) h12 = 1;

    let m = newMin;
    if (m < 0) m = 55;
    if (m > 59) m = 0;

    const p = newPeriod || period;

    let hour24 = h12;
    if (p === 'PM' && h12 !== 12) hour24 = h12 + 12;
    if (p === 'AM' && h12 === 12) hour24 = 0;

    const formattedMin = m < 10 ? `0${m}` : `${m}`;
    const formattedText = `${h12}:${formattedMin} ${p}`;

    if (onChange) {
      onChange({
        hour12: h12,
        minute: m,
        period: p,
        hour24,
        formattedText,
      });
    }
  };

  const handleHourStep = (delta) => {
    updateTime(hour12 + delta, minute, period);
  };

  const handleMinuteStep = (delta) => {
    // 5-minute increments for smooth stepping
    let nextMin = minute + delta;
    if (nextMin < 0) nextMin = 55;
    if (nextMin > 55) nextMin = 0;
    updateTime(hour12, nextMin, period);
  };

  const formattedMin = minute < 10 ? `0${minute}` : `${minute}`;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Trigger Start Time</Text>

      <View style={styles.pickerRow}>
        {/* Hour Column */}
        <View style={styles.col}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => handleHourStep(1)}
            activeOpacity={0.7}
          >
            <Text style={styles.stepBtnText}>▲</Text>
          </TouchableOpacity>

          <View style={styles.digitBox}>
            <Text style={styles.digitText}>{hour12}</Text>
            <Text style={styles.digitLabel}>HOUR</Text>
          </View>

          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => handleHourStep(-1)}
            activeOpacity={0.7}
          >
            <Text style={styles.stepBtnText}>▼</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.colon}>:</Text>

        {/* Minute Column */}
        <View style={styles.col}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => handleMinuteStep(5)}
            activeOpacity={0.7}
          >
            <Text style={styles.stepBtnText}>▲</Text>
          </TouchableOpacity>

          <View style={styles.digitBox}>
            <Text style={styles.digitText}>{formattedMin}</Text>
            <Text style={styles.digitLabel}>MIN</Text>
          </View>

          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => handleMinuteStep(-5)}
            activeOpacity={0.7}
          >
            <Text style={styles.stepBtnText}>▼</Text>
          </TouchableOpacity>
        </View>

        {/* AM / PM Toggle */}
        <View style={styles.periodCol}>
          <TouchableOpacity
            style={[styles.periodBtn, period === 'AM' && styles.periodBtnActive]}
            onPress={() => updateTime(hour12, minute, 'AM')}
          >
            <Text style={[styles.periodText, period === 'AM' && styles.periodTextActive]}>
              AM
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.periodBtn, period === 'PM' && styles.periodBtnActive]}
            onPress={() => updateTime(hour12, minute, 'PM')}
          >
            <Text style={[styles.periodText, period === 'PM' && styles.periodTextActive]}>
              PM
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick minute presets */}
      <View style={styles.presetsRow}>
        {[0, 15, 30, 45].map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.presetChip, minute === m && styles.presetChipActive]}
            onPress={() => updateTime(hour12, m, period)}
          >
            <Text style={[styles.presetText, minute === m && styles.presetTextActive]}>
              :{m < 10 ? `0${m}` : m}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderColor: '#2e7d32',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginTop: 6,
    marginBottom: 8,
    alignItems: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2e7d32',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  col: {
    alignItems: 'center',
  },
  stepBtn: {
    backgroundColor: '#e8f5e9',
    width: 44,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  stepBtnText: {
    fontSize: 14,
    color: '#2e7d32',
    fontWeight: 'bold',
  },
  digitBox: {
    backgroundColor: '#f1f8e9',
    borderRadius: 10,
    width: 58,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  digitText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1b5e20',
  },
  digitLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#66bb6a',
    marginTop: -2,
  },
  colon: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2e7d32',
    marginHorizontal: 8,
    marginBottom: 4,
  },
  periodCol: {
    marginLeft: 14,
    justifyContent: 'center',
  },
  periodBtn: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginVertical: 3,
  },
  periodBtnActive: {
    backgroundColor: '#2e7d32',
    borderColor: '#2e7d32',
  },
  periodText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#666',
  },
  periodTextActive: {
    color: '#ffffff',
  },
  presetsRow: {
    flexDirection: 'row',
    marginTop: 12,
    justifyContent: 'center',
  },
  presetChip: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginHorizontal: 4,
  },
  presetChipActive: {
    backgroundColor: '#e8f5e9',
    borderColor: '#2e7d32',
  },
  presetText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  presetTextActive: {
    color: '#2e7d32',
    fontWeight: '700',
  },
});
