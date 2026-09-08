import { Audio } from 'expo-av';

const MAX_RECORDING_DURATION_MS = 60000; // 60 seconds max

let recordingInstance = null;
let previewSound = null;
let recordedMetadata = null; // { uri, durationMs, sizeBytes, mimeType }
let durationTimer = null;
let durationCounter = 0;

/**
 * Checks if microphone permission has been granted.
 */
export async function hasMicPermission() {
  try {
    const { status } = await Audio.getPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    return false;
  }
}

/**
 * Requests microphone permission from the user.
 */
export async function requestMicPermission() {
  try {
    const { status } = await Audio.requestPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    if (__DEV__) console.warn('[recorder:requestMicPermission]', e.message);
    return false;
  }
}

/**
 * Starts audio recording.
 *
 * @param {object} options
 * @param {function} [options.onDurationUpdate] - Callback receiving elapsed seconds
 * @param {function} [options.onMaxDurationReached] - Callback when 60s limit reached
 */
export async function startRecording({ onDurationUpdate, onMaxDurationReached } = {}) {
  // Stop preview if active
  await stopPreview();

  const hasPerm = await hasMicPermission();
  if (!hasPerm) {
    const granted = await requestMicPermission();
    if (!granted) {
      throw new Error('Microphone permission is required to record a voice note.');
    }
  }

  // Cleanup any orphaned recording instance
  if (recordingInstance) {
    try {
      await recordingInstance.stopAndUnloadAsync();
    } catch (_) {}
    recordingInstance = null;
  }

  recordedMetadata = null;
  durationCounter = 0;

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();

    recordingInstance = recording;

    // Start duration tracking timer
    clearInterval(durationTimer);
    durationTimer = setInterval(async () => {
      durationCounter += 1;
      if (onDurationUpdate) {
        onDurationUpdate(durationCounter);
      }

      if (durationCounter * 1000 >= MAX_RECORDING_DURATION_MS) {
        clearInterval(durationTimer);
        const result = await stopRecording();
        if (onMaxDurationReached) {
          onMaxDurationReached(result);
        }
      }
    }, 1000);

    return true;
  } catch (err) {
    clearInterval(durationTimer);
    recordingInstance = null;
    if (__DEV__) console.warn('[recorder:startRecording]', err.message);
    throw err;
  }
}

/**
 * Stops the active recording and calculates duration / file size.
 * @returns {Promise<{ uri: string, durationMs: number, sizeBytes: number, mimeType: string } | null>}
 */
export async function stopRecording() {
  clearInterval(durationTimer);

  if (!recordingInstance) {
    return recordedMetadata;
  }

  try {
    const status = await recordingInstance.getStatusAsync();
    await recordingInstance.stopAndUnloadAsync();

    const uri = recordingInstance.getURI();
    const durationMs = status.durationMillis || durationCounter * 1000 || 1000;
    
    // Approximate file size if not directly available (typical 128kbps AAC is ~16KB/sec)
    const sizeBytes = Math.max(1024, Math.round((durationMs / 1000) * 16000));

    recordingInstance = null;

    // Reset audio mode for playback
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });

    recordedMetadata = {
      uri,
      durationMs,
      sizeBytes,
      mimeType: 'audio/m4a',
    };

    return recordedMetadata;
  } catch (err) {
    if (__DEV__) console.warn('[recorder:stopRecording]', err.message);
    recordingInstance = null;
    return null;
  }
}

/**
 * Plays a local preview of the recorded audio.
 *
 * @param {string} [uri] - Optional local URI to play; defaults to current recorded URI
 * @param {function} [onDone] - Callback when preview completes
 * @param {function} [onError] - Callback on error
 */
export async function playPreview(uri = null, onDone = null, onError = null) {
  const targetUri = uri || recordedMetadata?.uri;
  if (!targetUri) {
    if (onDone) onDone();
    return;
  }

  await stopPreview();

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: targetUri },
      { shouldPlay: true, isLooping: false, volume: 1.0 },
      (status) => {
        if (status.didJustFinish) {
          stopPreview();
          if (onDone) onDone();
        }
      }
    );

    previewSound = sound;
    return sound;
  } catch (err) {
    if (__DEV__) console.warn('[recorder:playPreview]', err.message);
    if (onError) onError(err);
    if (onDone) onDone();
    return null;
  }
}

/**
 * Stops any playing preview.
 */
export async function stopPreview() {
  if (previewSound) {
    try {
      await previewSound.stopAsync();
      await previewSound.unloadAsync();
    } catch (_) {}
    previewSound = null;
  }
}

/**
 * Checks if a voice note is currently recorded.
 */
export function hasRecording() {
  return !!recordedMetadata?.uri;
}

/**
 * Gets the current recorded metadata.
 */
export function getRecordedState() {
  return recordedMetadata;
}

/**
 * Discards the current recording and frees resources.
 */
export async function discardRecording() {
  clearInterval(durationTimer);
  await stopPreview();

  if (recordingInstance) {
    try {
      await recordingInstance.stopAndUnloadAsync();
    } catch (_) {}
    recordingInstance = null;
  }

  recordedMetadata = null;
  durationCounter = 0;
}
