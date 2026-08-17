import { Audio } from 'expo-av';
import { getAuth, getStorage } from '../firebase';

let recording = null;
let recordedUri = null;

export function hasRecording() {
  return !!recordedUri;
}

export function getRecordedUri() {
  return recordedUri;
}

export async function requestMicPermission() {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
}

export async function startRecording() {
  const granted = await requestMicPermission();
  if (!granted) {
    throw new Error('Microphone permission is required to record a voice note.');
  }
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });
  const result = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  );
  recording = result.recording;
  recordedUri = null;
}

export async function stopRecording() {
  if (!recording) return null;
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  recording = null;
  recordedUri = uri;
  return uri;
}

export function discardRecording() {
  recording = null;
  recordedUri = null;
}

/**
 * Uploads the recorded voice note to Firebase Storage under
 * voice/{nudgeId}/{uid}.m4a and returns the download URL.
 * Only the sender may upload; the recipient is authorized to read it via
 * storage rules that reference the Nudgr document.
 */
export async function uploadVoiceForNudge(nudgeId) {
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('You must be signed in.');
  if (!recordedUri) throw new Error('No recording to attach.');
  if (!nudgeId) throw new Error('Save the Nudgr before attaching voice.');

  const path = `voice/${nudgeId}/${uid}.m4a`;
  const ref = getStorage().ref(path);
  await ref.putFile(recordedUri, { contentType: 'audio/m4a' });
  const url = await ref.getDownloadURL();
  return { url, path };
}

/** Plays a remote voice URL (recipient side). */
export async function playVoiceUrl(url) {
  if (!url) return;
  const { sound } = await Audio.Sound.createAsync(
    { uri: url },
    { shouldPlay: true }
  );
  return sound;
}
