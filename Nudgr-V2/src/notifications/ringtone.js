import { Audio } from '../voice/audio';
import { Platform } from 'react-native';

let ringtoneSound = null;
let isPlaying = false;
let startOperation = null;

/**
 * Loads and starts playing the ringtone in a loop.
 * Thread-safe singleton: ensures only one Audio.Sound instance can ever play.
 * @returns {Promise<void>}
 */
let generation = 0;
export async function startRingtone() {
  if (isPlaying && ringtoneSound) return true;
  if (startOperation) return startOperation;
  const ownGeneration = ++generation;
  const operation = (async () => {
    let sound;
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true,
        shouldDuckAndroid: false, playThroughEarpieceAndroid: false });
      if (generation !== ownGeneration) return false;
      const loaded = await Audio.Sound.createAsync(require('../../assets/sounds/ringtone.mp3'),
        { shouldPlay: false, isLooping: true, volume: 1 }, null, Platform.OS !== 'android');
      sound = loaded.sound;
      if (generation !== ownGeneration) { await sound.unloadAsync(); return false; }
      ringtoneSound = sound;
      await sound.playAsync();
      if (generation !== ownGeneration) return false;
      isPlaying = true;
      return true;
    } catch (error) {
      await sound?.unloadAsync().catch(() => {});
      if (generation === ownGeneration) { ringtoneSound = null; isPlaying = false; }
      if (__DEV__) console.warn('[ringtone:start]', error.message);
      return false;
    }
  })();
  startOperation = operation;
  operation.finally(() => { if (startOperation === operation) startOperation = null; });
  return operation;
}

export async function stopRingtone() {
  generation += 1;
  startOperation = null;
  const sound = ringtoneSound;
  ringtoneSound = null;
  isPlaying = false;
  if (!sound) return;
  try { await sound.stopAsync(); } catch (_) { /* Unload still releases the player. */ }
  await sound.unloadAsync().catch(() => {});
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
