import { Audio } from './audio';

const MAX_RECORDING_DURATION_MS = 60000; // 60 seconds max

let recordingInstance = null;
let previewSound = null;
let recordedMetadata = null; // { uri, durationMs, sizeBytes, mimeType }
let durationTimer = null;
let durationCounter = 0;
let previewGeneration = 0;
let recordingGeneration = 0;

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
  const ownGeneration = ++recordingGeneration;
  const current = () => ownGeneration === recordingGeneration;
  // Stop preview if active
  await stopPreview();
  if (!current()) return false;

  const hasPerm = await hasMicPermission();
  if (!hasPerm) {
    const granted = await requestMicPermission();
    if (!granted) {
      throw new Error('Microphone permission is required to record a voice note.');
    }
  }

  if (!current()) return false;

  // Cleanup any orphaned recording instance
  if (recordingInstance) {
    try {
      await recordingInstance.stopAndUnloadAsync();
    } catch (_) {}
    recordingInstance = null;
  }

  if (!current()) return false;
  recordedMetadata = null;
  durationCounter = 0;
  let recording;

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    if (!current()) return false;
    recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    if (!current()) { await recording.stopAndUnloadAsync(); return false; }
    await recording.startAsync();
    if (!current()) { await recording.stopAndUnloadAsync(); return false; }

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
    await recording?.stopAndUnloadAsync().catch(() => {});
    if (!current()) return false;
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
  const ownGeneration = ++recordingGeneration;
  clearInterval(durationTimer);

  if (!recordingInstance) {
    return recordedMetadata;
  }

  const recording = recordingInstance;
  recordingInstance = null;
  try {
    const status = await recording.getStatusAsync();
    await recording.stopAndUnloadAsync();
    if (recordingGeneration !== ownGeneration) return null;
    const uri = recording.getURI();
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

    if (recordingGeneration !== ownGeneration) return null;
    recordedMetadata = {
      uri,
      durationMs,
      sizeBytes,
      mimeType: 'audio/m4a',
    };

    return recordedMetadata;
  } catch (err) {
    if (__DEV__) console.warn('[recorder:stopRecording]', err.message);
    if (recordingGeneration === ownGeneration) recordingInstance = null;
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

  const ownGeneration = ++previewGeneration;
  await cleanUpPreview();
  if (ownGeneration !== previewGeneration) return null;

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: targetUri },
      { shouldPlay: false, isLooping: false, volume: 1.0 },
      (status) => {
        if (ownGeneration === previewGeneration && status.didJustFinish) {
          stopPreview();
          if (onDone) onDone();
        }
      }
    );

    if (ownGeneration !== previewGeneration) { await sound.unloadAsync(); return null; }
    previewSound = sound;
    await sound.playAsync();
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
async function cleanUpPreview() {
  const sound = previewSound;
  previewSound = null;
  if (!sound) return;
  try { await sound.stopAsync(); } catch (_) { /* Unload still releases an interrupted preview. */ }
  await sound.unloadAsync().catch(() => {});
}

export async function stopPreview() {
  previewGeneration += 1;
  await cleanUpPreview();
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
  recordingGeneration += 1;
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
