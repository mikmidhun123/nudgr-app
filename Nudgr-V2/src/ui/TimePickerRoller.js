import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { THEME } from './theme';

/**
 * Clean, interactive time roller/picker component.
 * Allows choosing exact hour (1-12), minute (00-59), and AM/PM.
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
      <Text style={styles.title}>SELECT TRIGGER TIME</Text>

      {/* Quick Relative Buttons */}
      <View style={styles.relativeRow}>
        <Text style={styles.relativeLabel}>From now:</Text>
        {[1, 2, 5].map((mins) => (
          <TouchableOpacity
            key={mins}
            style={styles.relativeBtn}
            onPress={() => setFromNow(mins)}
            activeOpacity={0.75}
          >
            <Text style={styles.relativeBtnText}>+{mins} min</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Time Picker Columns */}
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
            <Text style={styles.digitLabel}>HR</Text>
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

        {/* AM / PM */}
        <View style={styles.periodCol}>
          {['AM', 'PM'].map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => updateTime(hour12, minute, p)}
              activeOpacity={0.8}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Minute Presets */}
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
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginTop: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.1,
    marginBottom: 14,
  },

  // ── Quick presets ─────────────────────────────────────────────────────────
  relativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderColor: '#E2E8F0',
    borderWidth: 1,
    gap: 8,
  },
  relativeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  relativeBtn: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.8)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  relativeBtnText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Picker columns ────────────────────────────────────────────────────────
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  col: {
    alignItems: 'center',
  },
  stepBtn: {
    backgroundColor: '#FFFFFF',
    width: 48,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepBtnText: {
    fontSize: 11,
    color: '#6366F1',
    fontWeight: '700',
  },
  digitBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  digitText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  digitLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginTop: 1,
  },
  colon: {
    fontSize: 28,
    fontWeight: '700',
    color: '#6366F1',
    marginHorizontal: 10,
    marginBottom: 4,
  },
  periodCol: {
    marginLeft: 16,
    justifyContent: 'center',
    gap: 8,
  },
  periodBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  periodBtnActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  periodText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  periodTextActive: {
    color: '#ffffff',
  },

  // ── Minute presets ────────────────────────────────────────────────────────
  presetsRow: {
    flexDirection: 'row',
    marginTop: 14,
    justifyContent: 'center',
    gap: 8,
  },
  presetChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  presetChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  presetText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  presetTextActive: {
    color: '#6366F1',
    fontWeight: '700',
  },
});
