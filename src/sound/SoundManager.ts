// ============================================================
// Empire Quest — Centralized Sound Manager
// ============================================================
// Provides volume controls, playlist-based music, SFX playback,
// overlap prevention, tab-inactive pause, and mobile-browser handling.
// Music rotates through a fantasy opera/synthwave playlist.
// Gameplay intensity affects volume dynamically.
// ============================================================

import { getTrackPath, TRACK_COUNT } from './musicRegistry';

export type SoundCategory =
  | 'master'
  | 'music'
  | 'interface'
  | 'environment'
  | 'battles'
  | 'notifications';

export type MusicState = 'playing' | 'paused' | 'stopped';

export interface SoundVolumes {
  master: number;
  music: number;
  interface: number;
  environment: number;
  battles: number;
  notifications: number;
}

export interface SoundConfig {
  /** Path to the sound file (relative to public/audio/) */
  path: string;
  /** Category for volume control */
  category: Exclude<SoundCategory, 'master'>;
  /** Maximum concurrent instances (0 = unlimited) */
  maxInstances?: number;
  /** Fade-in duration in ms */
  fadeIn?: number;
  /** Fade-out duration in ms */
  fadeOut?: number;
  /** Whether to loop */
  loop?: boolean;
}

interface ActiveSound {
  source: HTMLAudioElement;
  gain: number;
  category: Exclude<SoundCategory, 'master'>;
  path: string;
  instanceCount: number;
}

interface MusicTrack {
  source: HTMLAudioElement;
  state: MusicState;
  gain: number;
}

const DEFAULT_VOLUMES: SoundVolumes = {
  master: 0.7,
  music: 0.5,
  interface: 0.6,
  environment: 0.4,
  battles: 0.7,
  notifications: 0.5,
};

const STORAGE_KEY = 'empire-quest:audio';

/**
 * Singleton SoundManager.  Safe to call from any context; gracefully
 * degrades when AudioContext is unavailable (SSR, mobile restrictions).
 */
export class SoundManager {
  private static instance: SoundManager | null = null;

  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private categoryGains: Map<Exclude<SoundCategory, 'master'>, GainNode> = new Map();
  private activeSounds: Map<string, ActiveSound> = new Map();
  private musicTracks: MusicTrack[] = [];
  private currentMusic: MusicState = 'stopped';
  private playlistIndex = 0;
  private volumes: SoundVolumes = { ...DEFAULT_VOLUMES };
  private muted = false;
  private reducedSound = false;
  private preloadQueue: string[] = [];
  private loadedCache: Map<string, HTMLAudioElement> = new Map();
  private visibilityBound: ((() => void) | undefined) = undefined;

  private constructor() {
    this.initAudio();
    this.loadSettings();
    this.bindVisibility();
  }

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public static reset(): void {
    if (SoundManager.instance) {
      SoundManager.instance.destroy();
      SoundManager.instance = null;
    }
  }

  // --- Initialization ---

  private initAudio(): void {
    if (typeof AudioContext === 'undefined') return;
    try {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volumes.master;
      this.masterGain.connect(this.audioContext.destination);

      const categories: Exclude<SoundCategory, 'master'>[] = [
        'music', 'interface', 'environment', 'battles', 'notifications',
      ];
      for (const cat of categories) {
        const gain = this.audioContext.createGain();
        gain.gain.value = this.volumes[cat];
        gain.connect(this.masterGain!);
        this.categoryGains.set(cat, gain);
      }
    } catch {
      // AudioContext not available — degrade gracefully
      this.audioContext = null;
    }
  }

  private bindVisibility(): void {
    if (typeof document === 'undefined') return;
    const handler = () => {
      if (document.hidden && this.audioContext?.state === 'running') {
        this.audioContext.suspend();
      } else if (!document.hidden && this.audioContext?.state === 'suspended') {
        this.audioContext.resume();
      }
    };
    this.visibilityBound = handler;
    document.addEventListener('visibilitychange', handler);
  }

  private loadSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SoundVolumes> & { muted?: boolean; reducedSound?: boolean };
        this.volumes = { ...DEFAULT_VOLUMES, ...saved };
        this.muted = saved.muted ?? false;
        this.reducedSound = saved.reducedSound ?? false;
      }
    } catch { /* ignore */ }
  }

  private saveSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.volumes, muted: this.muted, reducedSound: this.reducedSound }));
    } catch { /* ignore */ }
  }

  // --- Volume Controls ---

  public setVolume(category: SoundCategory, value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.volumes[category] = clamped;

    if (category === 'master' && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(clamped, this.audioContext?.currentTime ?? 0, 0.05);
    } else if (category !== 'master') {
      const gain = this.categoryGains.get(category);
      if (gain) {
        gain.gain.setTargetAtTime(this.muted ? 0 : clamped, this.audioContext?.currentTime ?? 0, 0.05);
      }
    }
    this.saveSettings();
  }

  public getVolume(category: SoundCategory): number {
    return this.volumes[category];
  }

  public getVolumes(): SoundVolumes {
    return { ...this.volumes };
  }

  public mute(): void {
    this.muted = true;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0, this.audioContext?.currentTime ?? 0, 0.1);
    }
    this.saveSettings();
  }

  public unmute(): void {
    this.muted = false;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volumes.master, this.audioContext?.currentTime ?? 0, 0.1);
    }
    this.saveSettings();
  }

  public toggleMute(): void {
    this.muted ? this.unmute() : this.mute();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setReducedSound(enabled: boolean): void {
    this.reducedSound = enabled;
    if (enabled) {
      // Lower non-essential volumes
      this.setVolume('environment', 0.15);
      this.setVolume('music', 0.2);
    } else {
      this.setVolume('environment', DEFAULT_VOLUMES.environment);
      this.setVolume('music', DEFAULT_VOLUMES.music);
    }
    this.saveSettings();
  }

  public isReducedSound(): boolean {
    return this.reducedSound;
  }

  // --- SFX Playback ---

  public play(path: string, category: Exclude<SoundCategory, 'master'> = 'interface', maxInstances = 3): boolean {
    if (this.muted || !this.audioContext) return false;
    if (this.reducedSound && category === 'environment') return false;

    // Check overlap prevention
    const existing = this.activeSounds.get(`${path}:${category}`);
    if (existing && maxInstances > 0 && existing.instanceCount >= maxInstances) {
      return false;
    }

    const audio = this.getAudio(path);
    if (!audio) return false;

    try {
      // Clone for concurrent playback
      const source = audio.cloneNode() as HTMLAudioElement;
      const effectiveVol = this.volumes[category] * (category === 'notifications' && this.reducedSound ? 0.3 : 1);
      source.volume = effectiveVol;

      source.play().then(() => {
        // Track active sound
        const key = `${path}:${category}`;
        const entry: ActiveSound = {
          source,
          gain: effectiveVol,
          category,
          path,
          instanceCount: (existing?.instanceCount ?? 0) + 1,
        };
        this.activeSounds.set(key, entry);

        source.addEventListener('ended', () => {
          const e = this.activeSounds.get(key);
          if (e) {
            e.instanceCount--;
            if (e.instanceCount <= 0) {
              this.activeSounds.delete(key);
            }
          }
        });
      }).catch(() => {
        // Autoplay blocked — ignore
      });

      return true;
    } catch {
      return false;
    }
  }

  // --- Music Playback (Playlist Mode) ---

  /** Start the playlist from the beginning */
  public startPlaylist(): void {
    if (this.muted || !this.audioContext) return;
    if (this.currentMusic === 'playing') return;

    this.playlistIndex = 0;
    this.playNextTrack();
  }

  /** Play the next track in the playlist */
  private playNextTrack(): void {
    if (this.muted || !this.audioContext) return;

    const trackPath = getTrackPath(this.playlistIndex);

    // Fade out current track
    for (const track of this.musicTracks) {
      track.source.volume = 0;
      track.source.pause();
    }

    const audio = this.getAudio(trackPath);
    if (!audio) return;

    const source = audio.cloneNode() as HTMLAudioElement;
    source.loop = false; // Don't loop individual tracks — rotate instead
    source.volume = 0;

    source.addEventListener('ended', () => {
      this.playlistIndex = (this.playlistIndex + 1) % TRACK_COUNT;
      this.playNextTrack();
    });

    source.play().then(() => {
      // Fade in over 2 seconds
      const fadeIn = setInterval(() => {
        source.volume += 0.02;
        if (source.volume >= this.volumes.music * 0.7) {
          source.volume = this.volumes.music * 0.7;
          clearInterval(fadeIn);
        }
      }, 40);

      this.musicTracks = [{
        source,
        state: 'playing',
        gain: this.volumes.music * 0.7,
      }];
      this.currentMusic = 'playing';
    }).catch(() => {
      // Autoplay blocked — ignore
    });
  }

  /** Adjust music volume based on game intensity (0.3–1.0) */
  public setMusicIntensity(intensity: number): void {
    const clamped = Math.max(0.3, Math.min(1.0, intensity));
    for (const track of this.musicTracks) {
      const targetVol = this.volumes.music * clamped;
      track.source.volume = targetVol;
      track.gain = targetVol;
    }
  }

  public pauseMusic(): void {
    for (const track of this.musicTracks) {
      track.source.pause();
    }
    this.currentMusic = 'paused';
  }

  public resumeMusic(): void {
    if (this.currentMusic === 'paused') {
      for (const track of this.musicTracks) {
        track.source.play().catch(() => {});
      }
      this.currentMusic = 'playing';
    } else if (this.currentMusic === 'stopped') {
      this.startPlaylist();
    }
  }

  public stopMusic(crossfade = 1000): void {
    for (const track of this.musicTracks) {
      const fadeInterval = setInterval(() => {
        track.gain -= 0.02;
        if (track.gain <= 0) {
          track.source.pause();
          track.source.currentTime = 0;
          clearInterval(fadeInterval);
        } else {
          track.source.volume = track.gain;
        }
      }, crossfade / 50);
    }
    this.musicTracks = [];
    this.currentMusic = 'stopped';
  }

  public getCurrentMusic(): MusicState {
    return this.currentMusic;
  }

  public getCurrentTrackIndex(): number {
    return this.playlistIndex;
  }

  // --- Preloading ---

  public preload(paths: string[]): void {
    for (const path of paths) {
      if (this.loadedCache.has(path)) continue;
      try {
        const audio = new Audio(path);
        audio.preload = 'auto';
        this.loadedCache.set(path, audio);
      } catch { /* ignore */ }
    }
  }

  // --- Internal ---

  private getAudio(path: string): HTMLAudioElement | null {
    if (this.loadedCache.has(path)) {
      return this.loadedCache.get(path)!;
    }
    try {
      const audio = new Audio(path);
      audio.preload = 'auto';
      this.loadedCache.set(path, audio);
      return audio;
    } catch {
      return null;
    }
  }

  public destroy(): void {
    this.stopMusic(0);
    if (this.visibilityBound) {
      document.removeEventListener('visibilitychange', this.visibilityBound);
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.masterGain = null;
    this.categoryGains.clear();
    this.activeSounds.clear();
    this.musicTracks = [];
    this.currentMusic = 'stopped';
    this.playlistIndex = 0;
    this.loadedCache.clear();
  }
}

// Export singleton instance
export const soundManager = SoundManager.getInstance();