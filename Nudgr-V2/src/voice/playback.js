import { Audio } from 'expo-av';
import { speakNudge, stopSpeech, VOICE_STYLES } from './tts';
import { getVoiceDownloadUrl } from './r2Storage';

let activeSound = null;
let isPlayingAudio = false;

/**
 * Automatically plays the Nudgr message using either the Cloudflare R2 recorded voice note
 * or the configured TTS voice style, with automatic TTS fallback.
 *
 * @param {object} params
 * @param {object} params.nudge - The Nudgr document data
 * @param {function} [params.onStart] - Callback when playback starts
 * @param {function} [params.onDone] - Callback when playback finishes
 * @param {function} [params.onError] - Callback if an error occurs
 * @returns {Promise<{type: 'voice_note' | 'tts' | 'silent'}>}
 */
export async function playNudgeMessage({ nudge, onStart, onDone, onError }) {
  if (!nudge) {
    if (onDone) onDone();
    return { type: 'silent' };
  }

  // Stop any ongoing playback first
  await stopNudgeMessage();

  const voiceNote = nudge.voiceNote;
  const directVoiceUrl = nudge.voiceUrl || nudge.audioUrl || nudge.recordingUrl;
  const message = nudge.message || '';
  const voiceStyle = nudge.voiceStyle || 'normal';

  // 1. Cloudflare R2 Voice Note playback via signed download URL
  if (voiceNote?.enabled && voiceNote?.storageKey) {
    try {
      if (onStart) onStart({ type: 'voice_note' });

      // Request secure signed download URL from backend
      const { downloadUrl } = await getVoiceDownloadUrl(nudge.id, voiceNote.storageKey);

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: downloadUrl },
        { shouldPlay: true, isLooping: false, volume: 1.0 },
        (status) => {
          if (status.didJustFinish) {
            isPlayingAudio = false;
            if (activeSound) {
              activeSound.unloadAsync().catch(() => {});
              activeSound = null;
            }
            if (onDone) onDone();
          }
        }
      );

      activeSound = sound;
      isPlayingAudio = true;
      return { type: 'voice_note' };
    } catch (err) {
      if (__DEV__) console.warn('[playback:r2_voice_note_fallback]', err.message);
      // Automatic fallback to configured TTS voice on any R2 failure
      if (message.trim() && voiceStyle !== 'none') {
        return playTtsMessage({ message, voiceStyle, onStart, onDone, onError });
      }
      if (onError) onError(err);
      if (onDone) onDone();
      return { type: 'voice_note', error: err };
    }
  }

  // 2. Direct audio URL fallback
  if (directVoiceUrl && typeof directVoiceUrl === 'string' && directVoiceUrl.trim()) {
    try {
      if (onStart) onStart({ type: 'voice_note' });

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: directVoiceUrl.trim() },
        { shouldPlay: true, isLooping: false, volume: 1.0 },
        (status) => {
          if (status.didJustFinish) {
            isPlayingAudio = false;
            if (activeSound) {
              activeSound.unloadAsync().catch(() => {});
              activeSound = null;
            }
            if (onDone) onDone();
          }
        }
      );

      activeSound = sound;
      isPlayingAudio = true;
      return { type: 'voice_note' };
    } catch (err) {
      if (__DEV__) console.warn('[playback:voice_note]', err.message);
      // If voice URL playback fails, fallback to TTS
      if (message.trim() && voiceStyle !== 'none') {
        return playTtsMessage({ message, voiceStyle, onStart, onDone, onError });
      }
      if (onError) onError(err);
      if (onDone) onDone();
      return { type: 'voice_note', error: err };
    }
  }

  // 2. Silent alert (voiceStyle === 'none')
  if (voiceStyle === 'none') {
    if (onStart) onStart({ type: 'silent' });
    setTimeout(() => {
      if (onDone) onDone();
    }, 600);
    return { type: 'silent' };
  }

  // 3. Local Text-to-Speech synthesis (expo-speech)
  return playTtsMessage({ message, voiceStyle, onStart, onDone, onError });
}

function playTtsMessage({ message, voiceStyle = 'normal', onStart, onDone, onError }) {
  if (voiceStyle === 'none') {
    if (onStart) onStart({ type: 'silent' });
    setTimeout(() => {
      if (onDone) onDone();
    }, 400);
    return { type: 'silent' };
  }

  const cleanMessage = (message || '').trim();
  if (!cleanMessage) {
    if (onStart) onStart({ type: 'silent' });
    if (onDone) onDone();
    return { type: 'silent' };
  }

  const effectiveStyle = VOICE_STYLES[voiceStyle] ? voiceStyle : 'normal';

  if (onStart) onStart({ type: 'tts', style: effectiveStyle });
  isPlayingAudio = true;

  try {
    speakNudge(cleanMessage, effectiveStyle, {
      onDone: () => {
        isPlayingAudio = false;
        if (onDone) onDone();
      },
      onStopped: () => {
        isPlayingAudio = false;
      },
      onError: (err) => {
        isPlayingAudio = false;
        if (__DEV__) console.warn('[playback:tts]', err?.message || err);
        if (onError) onError(err);
        if (onDone) onDone();
      },
    });
    return { type: 'tts', style: effectiveStyle };
  } catch (err) {
    isPlayingAudio = false;
    if (onError) onError(err);
    if (onDone) onDone();
    return { type: 'tts', error: err };
  }
}

/**
 * Stops any active voice note or TTS playback immediately and cleans up resources.
 */
export async function stopNudgeMessage() {
  isPlayingAudio = false;
  stopSpeech();

  if (activeSound) {
    try {
      await activeSound.stopAsync();
      await activeSound.unloadAsync();
    } catch (_) {}
    activeSound = null;
  }
}

/**
 * Returns whether audio is currently playing.
 */
export function isNudgeAudioPlaying() {
  return isPlayingAudio;
}
