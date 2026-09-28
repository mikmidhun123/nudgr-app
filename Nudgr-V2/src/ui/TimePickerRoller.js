import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { THEME } from './theme';

/**
 * Clean, interactive time roller/picker component in iPhone Glass style.
 * Allows choosing exact hour (1-12), minute (00-59 in steps or presets), and AM/PM.
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
    let nextMin = minute + delta;
    if (nextMin < 0) nextMin = 59;
    if (nextMin > 59) nextMin = 0;
    updateTime(hour12, nextMin, period);
  };

  const setFromNow = (minutesToAdd) => {
    const target = new Date(Date.now() + minutesToAdd * 60 * 1000);
    const h = target.getHours();
    const m = target.getMinutes();
    const p = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    updateTime(h12, m, p);
  };

  const formattedMin = minute < 10 ? `0${minute}` : `${minute}`;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SELECT TRIGGER START TIME</Text>

      {/* Quick Relative Test Buttons (+1 min, +2 min, +5 min) */}
      <View style={styles.relativeRow}>
        <Text style={styles.relativeLabel}>Quick Presets:</Text>
        <TouchableOpacity style={styles.relativeBtn} onPress={() => setFromNow(1)} activeOpacity={0.75}>
          <Text style={styles.relativeBtnText}>+1 min</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.relativeBtn} onPress={() => setFromNow(2)} activeOpacity={0.75}>
          <Text style={styles.relativeBtnText}>+2 min</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.relativeBtn} onPress={() => setFromNow(5)} activeOpacity={0.75}>
          <Text style={styles.relativeBtnText}>+5 min</Text>
        </TouchableOpacity>
      </View>

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
            onPress={() => handleMinuteStep(1)}
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
            onPress={() => handleMinuteStep(-1)}
            activeOpacity={0.7}
          >
            <Text style={styles.stepBtnText}>▼</Text>
          </TouchableOpacity>
        </View>

        {/* AM / PM Column */}
        <View style={styles.periodCol}>
          <TouchableOpacity
            style={[styles.periodBtn, period === 'AM' && styles.periodBtnActive]}
            onPress={() => updateTime(hour12, minute, 'AM')}
            activeOpacity={0.8}
          >
            <Text style={[styles.periodText, period === 'AM' && styles.periodTextActive]}>
              AM
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.periodBtn, period === 'PM' && styles.periodBtnActive]}
            onPress={() => updateTime(hour12, minute, 'PM')}
            activeOpacity={0.8}
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
            activeOpacity={0.8}
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: THEME.colors.glassBorderHighlight,
    borderWidth: 1,
    borderRadius: THEME.radius.card,
    padding: 16,
    marginTop: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    color: THEME.colors.accentSecondary,
    letterSpacing: 1.2,
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
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    width: 48,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  stepBtnText: {
    fontSize: 12,
    color: THEME.colors.accentPrimary,
    fontWeight: 'bold',
  },
  digitBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    width: 62,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  digitText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
  },
  digitLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: THEME.colors.textTertiary,
    letterSpacing: 0.5,
    marginTop: 1,
  },
  colon: {
    fontSize: 30,
    fontWeight: 'bold',
    color: THEME.colors.accentPrimary,
    marginHorizontal: 10,
    marginBottom: 6,
  },
  periodCol: {
    marginLeft: 16,
    justifyContent: 'center',
    gap: 6,
  },
  periodBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  periodBtnActive: {
    backgroundColor: THEME.colors.accentPrimary,
    borderColor: THEME.colors.accentPrimary,
  },
  periodText: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.textSecondary,
  },
  periodTextActive: {
    color: '#ffffff',
  },
  presetsRow: {
    flexDirection: 'row',
    marginTop: 14,
    justifyContent: 'center',
    gap: 8,
  },
  presetChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  presetChipActive: {
    backgroundColor: 'rgba(139, 124, 255, 0.20)',
    borderColor: THEME.colors.accentPrimary,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
  },
  presetTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  relativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    gap: 6,
  },
  relativeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.textSecondary,
    marginRight: 4,
  },
  relativeBtn: {
    backgroundColor: 'rgba(90, 200, 250, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.30)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  relativeBtnText: {
    color: THEME.colors.accentSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
});
