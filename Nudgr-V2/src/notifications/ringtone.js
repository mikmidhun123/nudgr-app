import { Audio } from 'expo-av';
import { Platform } from 'react-native';

let ringtoneSound = null;
let isPlaying = false;
let startOperation = null;

/**
 * Loads and starts playing the ringtone in a loop.
 * Thread-safe singleton: ensures only one Audio.Sound instance can ever play.
 * @returns {Promise<void>}
 */
export async function startRingtone() {
  if (isPlaying && ringtoneSound) {
    return true; // Already playing
  }

  // If a start operation is already in flight, await it
  if (startOperation) {
    try {
      await startOperation;
    } catch (_) {}
    if (isPlaying) return true;
  }

  startOperation = (async () => {
    try {
      // Ensure any existing sound is cleaned up first
      if (ringtoneSound) {
        try {
          await ringtoneSound.stopAsync();
          await ringtoneSound.unloadAsync();
        } catch (_) {}
        ringtoneSound = null;
      }

      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/ringtone.mp3'),
        { shouldPlay: true, isLooping: true, volume: 1.0 },
        null,
        // Android already packages this as a raw resource; no filesystem download is needed.
        Platform.OS !== 'android'
      );
      
      ringtoneSound = sound;
      isPlaying = true;
      
      if (__DEV__) console.log('[ringtone] Started playing');
    } catch (e) {
      console.warn('[ringtone] start error:', e.message);
      ringtoneSound = null;
      isPlaying = false;
    } finally {
      startOperation = null;
    }
  })();

  await startOperation;
  return isPlaying;
}

/**
 * Stops the ringtone immediately and unloads all audio resources.
 * @returns {Promise<void>}
 */
export async function stopRingtone() {
  // If starting in flight, wait for it so we don't leave an orphaned playing sound
  if (startOperation) {
    try {
      await startOperation;
    } catch (_) {}
  }

  if (!ringtoneSound) {
    isPlaying = false;
    return;
  }

  const soundToClean = ringtoneSound;
  ringtoneSound = null;
  isPlaying = false;

  try {
    await soundToClean.stopAsync();
    await soundToClean.unloadAsync();
    if (__DEV__) console.log('[ringtone] Stopped and unloaded');
  } catch (e) {
    if (__DEV__) console.warn('[ringtone] stop error:', e.message);
  }
}

/**
 * Checks if ringtone is currently playing.
 * @returns {boolean}
 */
export function isRingtonePlaying() {
  return isPlaying;
}

/**
 * Preloads the ringtone for faster startup.
 * @returns {Promise<void>}
 */
export async function preloadRingtone() {
  try {
    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/sounds/ringtone.mp3'),
      { shouldPlay: false, isLooping: true },
      null,
      Platform.OS !== 'android'
    );
    await sound.unloadAsync();
    if (__DEV__) console.log('[ringtone] Preloaded');
  } catch (e) {
    if (__DEV__) console.warn('[ringtone] preload error:', e.message);
  }
}
