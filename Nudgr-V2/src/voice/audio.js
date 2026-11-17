import {
  AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync,
  getRecordingPermissionsAsync, requestRecordingPermissionsAsync,
} from 'expo-audio';

// Shared recording and playback controls implemented with the supported audio module.
class Sound {
  constructor(player, onStatus) {
    this.player = player;
    this.onStatus = onStatus;
    this.subscription = player.addListener('playbackStatusUpdate', status => {
      this.onStatus?.({ ...status, isPlaying: status.playing,
        durationMillis: (status.duration || 0) * 1000,
        error: status.playbackState === 'error' ? 'Audio playback failed' : undefined });
    });
  }
  static async createAsync(source, options = {}, onStatus = null, downloadFirst = false) {
    const player = createAudioPlayer(source, { updateInterval: 100, downloadFirst });
    const sound = new Sound(player, onStatus);
    player.loop = options.isLooping === true;
    player.volume = options.volume ?? 1;
    /** @type {{ remove: () => void } | undefined} */
    let subscription;
    let timeout;
    try {
      if (!player.currentStatus.isLoaded) {
        await new Promise((resolve, reject) => {
          subscription = player.addListener('playbackStatusUpdate', status => {
            if (status.isLoaded) resolve(undefined);
            else if (status.playbackState === 'error') reject(new Error('Audio could not be loaded'));
          });
          timeout = setTimeout(() => reject(new Error('Audio load timed out')), 15000);
          if (player.currentStatus.isLoaded) resolve(undefined);
        });
      }
      if (options.shouldPlay) player.play();
      return { sound };
    } catch (error) {
      await sound.unloadAsync();
      throw error;
    } finally {
      clearTimeout(timeout);
      subscription?.remove();
    }
  }
  async playAsync() { this.player?.play(); }
  async pauseAsync() { this.player?.pause(); }
  async stopAsync() { this.player?.pause(); }
  async setPositionAsync(milliseconds) { await this.player?.seekTo(milliseconds / 1000); }
  setOnPlaybackStatusUpdate(callback) { this.onStatus = callback; }
  async unloadAsync() {
    this.subscription?.remove();
    this.subscription = null;
    const player = this.player;
    this.player = null;
    player?.remove();
  }
}

class Recording {
  constructor() {
    /** @type {import('expo-audio').AudioRecorder | null} */
    this.recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    /** @type {string | null} */
    this.uri = null;
    this.startedAt = 0;
    this.durationMillis = 0;
    this.subscription = this.recorder.addListener('recordingStatusUpdate', status => {
      if (status.url) this.uri = status.url;
      if (status.isFinished && this.startedAt) this.durationMillis = Math.min(60000, Date.now() - this.startedAt);
    });
  }
  get currentRecorder() { if (!this.recorder) throw new Error('Recording is already released'); return this.recorder; }
  async prepareToRecordAsync(options) { await this.currentRecorder.prepareToRecordAsync(options); }
  async startAsync() { this.startedAt = Date.now(); this.currentRecorder.record({ forDuration: 60 }); }
  async getStatusAsync() {
    const status = this.currentRecorder.getStatus();
    return { ...status, durationMillis: status.durationMillis || this.durationMillis };
  }
  getURI() { return this.uri || this.recorder?.uri; }
  async stopAndUnloadAsync() {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null;
    try {
      this.uri = recorder.uri || this.uri;
      if (recorder.isRecording) await recorder.stop();
      this.uri = recorder.uri || this.uri;
    } finally { this.subscription.remove(); recorder.release(); }
  }
}

export const Audio = {
  Sound, Recording, RecordingOptionsPresets: RecordingPresets,
  getPermissionsAsync: getRecordingPermissionsAsync,
  requestPermissionsAsync: requestRecordingPermissionsAsync,
  setAudioModeAsync(options) {
    return setAudioModeAsync({
      allowsRecording: options.allowsRecordingIOS === true,
      playsInSilentMode: options.playsInSilentModeIOS !== false,
      shouldPlayInBackground: options.staysActiveInBackground === true,
      interruptionMode: options.shouldDuckAndroid ? 'duckOthers' : 'doNotMix',
      shouldRouteThroughEarpiece: options.playThroughEarpieceAndroid === true,
    });
  },
};
