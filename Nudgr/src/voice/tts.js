import * as Speech from 'expo-speech';

/**
 * 4 Distinct Local Android Text-to-Speech Voice Styles.
 * Uses genuine pitch, rate, and prosodic pacing modulation.
 * Zero cost, local device synthesis, Spark tier compatible.
 */
export const VOICE_STYLES = {
  none: {
    key: 'none',
    label: 'No voice (Silent alert)',
    pitch: 1.0,
    rate: 1.0,
    description: 'Notification banner only (silent)',
  },
  gentle: {
    key: 'gentle',
    label: 'Gentle',
    pitch: 0.85,  // Soft, lower soothing pitch
    rate: 0.84,   // Calm, relaxed cadence
    description: 'Soft, calm, unhurried tone with gentle pauses',
  },
  normal: {
    key: 'normal',
    label: 'Normal',
    pitch: 1.0,   // Natural baseline pitch
    rate: 1.0,    // Standard conversational speed
    description: 'Natural balanced voice',
  },
  energetic: {
    key: 'energetic',
    label: 'Energetic',
    pitch: 1.25,  // Upbeat, bright pitch
    rate: 1.10,   // Lively, cheerful pace
    description: 'Upbeat, bright, and cheerful delivery',
  },
  urgent: {
    key: 'urgent',
    label: 'Urgent',
    pitch: 1.15,  // Assertive, focused pitch
    rate: 1.20,   // Crisp, prompt priority pace
    description: 'Crisp, alert priority delivery with clear urgency',
  },
};

export const VOICE_STYLE_LIST = [
  VOICE_STYLES.gentle,
  VOICE_STYLES.normal,
  VOICE_STYLES.energetic,
  VOICE_STYLES.urgent,
  VOICE_STYLES.none,
];

/**
 * Adapts phrasing and punctuation to shape the character of the voice style.
 *
 * @param {string} rawText The user's input message.
 * @param {string} styleKey The voice style preset.
 * @returns {string} Text prosodically formatted for the style.
 */
export function formatUtteranceForStyle(rawText, styleKey = 'normal') {
  if (!rawText || !rawText.trim()) return '';
  const text = rawText.trim();

  switch (styleKey) {
    case 'gentle': {
      // Soften exclamation marks, insert relaxing clause pauses
      return text
        .replace(/!+/g, '.')
        .replace(/\. /g, '... ')
        .replace(/, /g, '... ');
    }
    case 'energetic': {
      // Ensure bright, lively sentence boundaries
      let formatted = text.replace(/\.{2,}/g, '.');
      if (!/[!?]$/.test(formatted)) {
        formatted += '!';
      }
      return formatted;
    }
    case 'urgent': {
      // Crisp, direct punctuation for prompt delivery
      return text
        .replace(/\.{3,}/g, '.')
        .replace(/,\s*/g, ', ');
    }
    case 'normal':
    default:
      return text;
  }
}

/**
 * Speaks a message locally using the selected voice style.
 *
 * @param {string} text The text to speak.
 * @param {string} styleKey One of 'gentle' | 'normal' | 'energetic' | 'urgent' | 'none'.
 * @param {object} [extraOptions] Extra expo-speech options.
 */
export function speakNudge(text, styleKey = 'normal', extraOptions = {}) {
  if (!text || !text.trim()) return;
  if (styleKey === 'none' || styleKey === false) return;

  const style = VOICE_STYLES[styleKey] || VOICE_STYLES.normal;
  const utterance = formatUtteranceForStyle(text, styleKey);

  try {
    Speech.stop();
    Speech.speak(utterance, {
      pitch: style.pitch,
      rate: style.rate,
      ...extraOptions,
    });
  } catch (e) {
    if (__DEV__) {
      console.warn('[TTS:speak]', e.message);
    }
  }
}

/** Stops any currently playing speech. */
export function stopSpeech() {
  try {
    Speech.stop();
  } catch (e) {
    if (__DEV__) {
      console.warn('[TTS:stop]', e.message);
    }
  }
}

/**
 * Previews a voice style using either the user's current message or an archetype preview phrase.
 *
 * @param {string} styleKey
 * @param {string|null} customText
 */
export function previewVoice(styleKey = 'normal', customText = null) {
  if (customText && customText.trim()) {
    speakNudge(customText.trim(), styleKey);
    return;
  }

  // Distinct character demonstration phrases
  let sampleText = '';
  switch (styleKey) {
    case 'gentle':
      sampleText = 'Take your time. I will be right here whenever you arrive.';
      break;
    case 'energetic':
      sampleText = 'Hey there! Great to see you, I am almost ready!';
      break;
    case 'urgent':
      sampleText = 'Attention! Please check your message right away.';
      break;
    case 'normal':
    default:
      sampleText = 'Hello. You have an incoming Nudgr arrival alert.';
      break;
  }

  speakNudge(sampleText, styleKey);
}
