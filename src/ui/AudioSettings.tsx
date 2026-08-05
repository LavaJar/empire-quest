// ============================================================
// Empire Quest — Audio Settings Panel
// ============================================================

import { useState, useEffect } from 'react';
import { soundManager } from '../sound/SoundManager';
import type { SoundVolumes } from '../sound/SoundManager';

interface AudioSettingsProps {
  onClose: () => void;
}

const CATEGORIES = [
  { key: 'master' as const, label: 'Master', icon: '🔊' },
  { key: 'music' as const, label: 'Music', icon: '🎵' },
  { key: 'interface' as const, label: 'Interface', icon: '🖱️' },
  { key: 'environment' as const, label: 'Environment', icon: '🌍' },
  { key: 'battles' as const, label: 'Battles', icon: '⚔️' },
  { key: 'notifications' as const, label: 'Notifications', icon: '🔔' },
];

export default function AudioSettings({ onClose }: AudioSettingsProps) {
  const [volumes, setVolumes] = useState<SoundVolumes>(soundManager.getVolumes());
  const [muted, setMuted] = useState(soundManager.isMuted());
  const [reducedSound, setReducedSound] = useState(soundManager.isReducedSound());

  useEffect(() => {
    setVolumes(soundManager.getVolumes());
    setMuted(soundManager.isMuted());
    setReducedSound(soundManager.isReducedSound());
  }, []);

  const handleVolumeChange = (key: keyof SoundVolumes, value: number) => {
    soundManager.setVolume(key, value);
    setVolumes(soundManager.getVolumes());
  };

  const handleMuteToggle = () => {
    soundManager.toggleMute();
    setMuted(soundManager.isMuted());
  };

  const handleReducedSoundToggle = () => {
    soundManager.setReducedSound(!reducedSound);
    setReducedSound(soundManager.isReducedSound());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="empire-panel w-[400px] max-w-[90vw] rounded-lg p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="empire-heading text-lg text-empire-gold">Audio Settings</h2>
          <button className="empire-button text-xs" onClick={onClose}>Close</button>
        </div>

        {/* Mute / Reduced Sound */}
        <div className="mb-4 flex gap-2">
          <button
            className={`empire-button flex-1 ${muted ? 'border-red-600 bg-red-950/50' : ''}`}
            onClick={handleMuteToggle}
          >
            {muted ? '🔇 Unmute' : '🔈 Mute All'}
          </button>
          <button
            className={`empire-button flex-1 ${reducedSound ? 'border-blue-600 bg-blue-950/50' : ''}`}
            onClick={handleReducedSoundToggle}
          >
            {reducedSound ? '🔊 Normal Sound' : '👂 Reduced Sound'}
          </button>
        </div>

        {/* Volume Sliders */}
        <div className="space-y-3">
          {CATEGORIES.map(cat => (
            <div key={cat.key} className="flex items-center gap-3">
              <span className="w-6 text-center text-lg">{cat.icon}</span>
              <span className="w-24 text-sm text-amber-100">{cat.label}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volumes[cat.key]}
                onChange={e => handleVolumeChange(cat.key, parseFloat(e.target.value))}
                className="flex-1 accent-empire-gold"
              />
              <span className="w-10 text-right text-xs text-stone-400">
                {Math.round(volumes[cat.key] * 100)}%
              </span>
            </div>
          ))}
        </div>

        {/* Music Info */}
        <div className="mt-4 rounded border border-stone-700 p-3">
          <p className="text-sm text-empire-gold">🎵 Fantasy Opera Synthwave Playlist</p>
          <p className="mt-1 text-xs text-stone-400">
            7 tracks rotate automatically. Music volume shifts based on game intensity — louder during sieges, quieter in peace.
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Current: Track {soundManager.getCurrentTrackIndex() + 1} / 7 &middot; State: {soundManager.getCurrentMusic()}
          </p>
        </div>

        <p className="mt-3 text-xs text-stone-500">
          Settings are saved automatically.
        </p>
      </div>
    </div>
  );
}