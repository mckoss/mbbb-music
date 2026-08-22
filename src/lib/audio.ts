import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface AudioState {
  sha: string | null;
  title: string;
  playing: boolean;
  position: number;
  duration: number;
}

const initial: AudioState = {
  sha: null,
  title: '',
  playing: false,
  position: 0,
  duration: 0,
};

// A single shared transport. Both the collection player and the score overlay
// player bind to this store and call the same functions, so position and play
// state stay continuous when moving between views.
export const audio = writable<AudioState>(initial);

let el: HTMLAudioElement | null = null;

function element(): HTMLAudioElement | null {
  if (!browser) return null;
  if (el) return el;
  el = new Audio();
  el.preload = 'metadata';

  el.addEventListener('timeupdate', () => {
    audio.update((s) => ({ ...s, position: el!.currentTime }));
  });
  el.addEventListener('loadedmetadata', () => {
    audio.update((s) => ({ ...s, duration: Number.isFinite(el!.duration) ? el!.duration : 0 }));
  });
  el.addEventListener('durationchange', () => {
    audio.update((s) => ({ ...s, duration: Number.isFinite(el!.duration) ? el!.duration : 0 }));
  });
  el.addEventListener('play', () => {
    audio.update((s) => ({ ...s, playing: true }));
  });
  el.addEventListener('pause', () => {
    audio.update((s) => ({ ...s, playing: false }));
  });
  el.addEventListener('ended', () => {
    audio.update((s) => ({ ...s, playing: false, position: 0 }));
  });
  return el;
}

// Each prime() gets a generation number; any real play bumps it. On a cold
// load the muted warm-up's play() promise can resolve *after* the count-in's
// downbeat has started real playback — without the generation check, its
// pause/rewind would silence the song that just started.
let primeGeneration = 0;

/**
 * Select a blob and start buffering it *now*, without audible playback. Call
 * this inside the Play tap so a count-in can overlap the network fetch — by the
 * downbeat the file is warm and playback starts instantly instead of stalling
 * on a cold load. The silent muted play/pause also blesses the element so the
 * later programmatic `play()` is allowed on iOS (which only permits playback
 * that traces back to a user gesture).
 */
export function prime(sha: string, title: string): void {
  const a = element();
  if (!a) return;
  const gen = ++primeGeneration;
  const changed = !a.src.endsWith(`/blob/${sha}`);
  if (changed) {
    a.src = `/blob/${sha}`;
    a.currentTime = 0;
    audio.update((s) => ({ ...s, sha, title, position: 0, duration: 0 }));
  } else {
    audio.update((s) => ({ ...s, sha, title }));
  }
  a.preload = 'auto';
  a.muted = true;
  void a
    .play()
    .then(() => {
      if (gen !== primeGeneration) return; // real playback superseded this warm-up
      a.pause();
      a.currentTime = 0;
      a.muted = false;
    })
    .catch(() => {
      if (gen === primeGeneration) a.muted = false;
    });
}

/**
 * Make `sha` the loaded (paused) track so its duration is known and the scrub
 * bar is live *before* the first Play — letting a player drag to a start point
 * with timecode feedback on a freshly-loaded page. No-op when it's already the
 * selected track; declines to disturb a different track that's actively playing,
 * so the shared transport stays continuous.
 */
export function ensureLoaded(sha: string, title: string): void {
  const a = element();
  if (!a) return;
  if (a.src.endsWith(`/blob/${sha}`)) {
    // Already selected — keep the title fresh, preserve any scrub position.
    audio.update((s) => ({ ...s, sha, title }));
    return;
  }
  if (!a.paused) return; // something else is playing — don't interrupt it
  a.src = `/blob/${sha}`;
  a.preload = 'metadata';
  a.currentTime = 0;
  audio.update((s) => ({ ...s, sha, title, position: 0, duration: 0 }));
}

/** Play the given blob. Resets position only when the sha changes. */
export function playSha(sha: string, title: string): void {
  const a = element();
  if (!a) return;
  primeGeneration++;
  a.muted = false;
  const src = `/blob/${sha}`;
  const changed = !a.src.endsWith(`/blob/${sha}`);
  if (changed) {
    a.src = src;
    a.currentTime = 0;
    audio.update((s) => ({ ...s, sha, title, position: 0, duration: 0 }));
  } else {
    audio.update((s) => ({ ...s, sha, title }));
  }
  void a.play();
}

/**
 * Start the given blob from the very beginning — the count-in downbeat. Unlike
 * playSha this always rewinds, so a warm-up that advanced the muted element a
 * little can't make the downbeat start mid-phrase.
 */
export function playFromTop(sha: string, title: string): void {
  const a = element();
  if (!a) return;
  primeGeneration++;
  a.muted = false;
  const changed = !a.src.endsWith(`/blob/${sha}`);
  if (changed) a.src = `/blob/${sha}`;
  a.currentTime = 0;
  audio.update((s) => ({ ...s, sha, title, position: 0, ...(changed ? { duration: 0 } : {}) }));
  void a.play();
}

/** Toggle play/pause for the current track. */
export function toggle(): void {
  const a = element();
  if (!a || !a.src) return;
  if (a.paused) {
    primeGeneration++;
    a.muted = false;
    void a.play();
  } else {
    a.pause();
  }
}

export function pause(): void {
  const a = element();
  if (a) a.pause();
}

export function seek(seconds: number): void {
  const a = element();
  if (!a) return;
  a.currentTime = seconds;
  audio.update((s) => ({ ...s, position: seconds }));
}

export function restart(): void {
  seek(0);
}
