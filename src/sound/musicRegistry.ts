// Empire Quest — Fantasy Opera Synthwave Playlist
// 7 tracks that rotate automatically. Gameplay state affects volume/intensity.

// Playlist of all available tracks (circular rotation)
export const playlist = [
  '/audio/music/track01.mp3',
  '/audio/music/track02.mp3',
  '/audio/music/track03.mp3',
  '/audio/music/track04.mp3',
  '/audio/music/track05.mp3',
  '/audio/music/track06.mp3',
  '/audio/music/track07.mp3',
];

/** Get the next track path given current index */
export function getNextTrack(currentIndex: number): string {
  return playlist[(currentIndex + 1) % playlist.length];
}

export function getTrackPath(index: number): string {
  return playlist[index % playlist.length];
}

export const TRACK_COUNT = playlist.length;