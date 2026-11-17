import { Audio } from './audio';
import { speakNudge, stopSpeech, VOICE_STYLES } from './tts';
import { getVoiceDownloadUrl, getDirectVoiceSource } from './r2Storage';

let activeSound = null;
let isPlayingAudio = false;
let generation = 0;
const cancelled = () => ({ type: 'silent', cancelled: true });

async function cleanUpPlayback() {
  isPlayingAudio = false;
  const sound = activeSound;
  activeSound = null;
  await stopSpeech();
  if (sound) {
    try { await sound.stopAsync(); } catch (_) { /* Unload still releases an interrupted player. */ }
    finally { await sound.unloadAsync().catch(() => {}); }
  }
}

export async function playNudgeMessage({ nudge, onStart, onDone, onError }) {
  const ownGeneration = ++generation;
  await cleanUpPlayback();
  const current = () => ownGeneration === generation;
  if (!current()) return cancelled();
  if (!nudge) { onDone?.(); return { type: 'silent' }; }
  const message = nudge.message || '', voiceStyle = nudge.voiceStyle || 'normal';
  const directUrl = nudge.voiceUrl || nudge.audioUrl || nudge.recordingUrl;
  if ((nudge.voiceNote?.enabled && nudge.voiceNote.storageKey) || (typeof directUrl === 'string' && directUrl.trim())) {
    let sound;
    try {
      const source = nudge.voiceNote?.enabled && nudge.voiceNote.storageKey
        ? await getVoiceDownloadUrl(nudge.id, nudge.voiceNote.storageKey)
        : await getDirectVoiceSource(nudge.id, directUrl.trim());
      if (!current()) return cancelled();
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true,
        shouldDuckAndroid: false, playThroughEarpieceAndroid: false });
      if (!current()) return cancelled();
      const loaded = await Audio.Sound.createAsync({ uri: source.downloadUrl, headers: source.headers },
        { shouldPlay: false, isLooping: false, volume: 1 }, status => {
          if (!current() || activeSound !== sound) return;
          if (status.didJustFinish) {
            activeSound = null;
            isPlayingAudio = false;
            sound.unloadAsync().catch(() => {});
            onDone?.();
          }
        });
      sound = loaded.sound;
      if (!current()) { await sound.unloadAsync(); return cancelled(); }
      activeSound = sound;
      isPlayingAudio = true;
      onStart?.({ type: 'voice_note' });
      await sound.playAsync();
      return current() ? { type: 'voice_note' } : cancelled();
    } catch (error) {
      if (activeSound === sound) activeSound = null;
      await sound?.unloadAsync().catch(() => {});
      if (!current()) return cancelled();
      if (__DEV__) console.warn('[playback:voice_note_fallback]', error.message);
      if (!message.trim() || voiceStyle === 'none') {
        isPlayingAudio = false;
        onError?.(error); onDone?.();
        return { type: 'voice_note', error };
      }
    }
  }
  if (!current()) return cancelled();
  if (voiceStyle === 'none' || !message.trim()) {
    onStart?.({ type: 'silent' });
    setTimeout(() => { if (current()) onDone?.(); }, 600);
    return { type: 'silent' };
  }
  const style = VOICE_STYLES[voiceStyle] ? voiceStyle : 'normal';
  onStart?.({ type: 'tts', style });
  isPlayingAudio = true;
  await speakNudge(message, style, {
    onDone: () => { if (current()) { isPlayingAudio = false; onDone?.(); } },
    onStopped: () => { if (current()) isPlayingAudio = false; },
    onError: error => { if (current()) { isPlayingAudio = false; onError?.(error); } },
  });
  return current() ? { type: 'tts', style } : cancelled();
}

export async function stopNudgeMessage() {
  generation += 1;
  await cleanUpPlayback();
}

export function isNudgeAudioPlaying() { return isPlayingAudio; }
