<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';

  import { audio, playSha, playFromTop, prime, toggle, restart, seek, ensureLoaded } from '$lib/audio';
  import { buildCountInWav, COUNT_IN_LEAD_SECONDS, songPlayTime } from '$lib/count-in';
  import { formatTime } from '$lib/format';
  import type { Catalog, TuneTempo } from '$lib/types';

  let {
    sha,
    title,
    compact = false
  }: { sha: string | null; title: string; compact?: boolean } = $props();

  // The count-in tempo self-resolves from the catalog by the recording's sha —
  // whichever tune owns this recording supplies its meter/BPM. Doing the lookup
  // here (not at call sites) keeps every practice surface uniform: score
  // overlay, gig set practice, the file viewer, and anything added later.
  const tempo = $derived.by<TuneTempo | null>(() => {
    if (sha == null) return null;
    const catalog = page.data.catalog as Catalog | undefined;
    const tune = catalog?.tunes?.find((t) => t.audio?.some((a) => a.sha256 === sha));
    return tune?.tempo ?? null;
  });

  const isCurrent = $derived(sha != null && $audio.sha === sha);
  const playing = $derived(isCurrent && $audio.playing);
  const position = $derived(isCurrent ? $audio.position : 0);
  const duration = $derived(isCurrent ? $audio.duration : 0);
  const disabled = $derived(sha == null);

  // Load this track's metadata as soon as the player is shown (and whenever the
  // selected recording changes), so the scrub bar knows the duration and is
  // draggable — with live timecode feedback — before the first Play.
  $effect(() => {
    if (sha != null) ensureLoaded(sha, title);
  });

  // Count-in: a metronome lead-in so a player knows when the downbeat lands
  // instead of being caught out by the MP3 jumping straight into the first
  // note. When the catalog carries the song's tempo (extracted from its
  // MuseScore file, or a human override), the count matches the music: felt
  // beats per bar at the song's felt BPM, with playback starting early under a
  // pickup bar. Without metadata it falls back to the manual N-beat, ~60 BPM
  // count. The final beat is accented.
  let countIn = $state(true);
  let beats = $state(4); // manual fallback: 3 or 4, picked by the user
  // One bar of count at the song's tempo (fallback: 1s beats).
  const period = $derived(tempo ? 60 / tempo.bpm : 1.0);
  const countBeats = $derived(tempo ? tempo.beatsPerBar : beats);
  // A pickup (anacrusis) shorter than a bar: the MP3 starts this many felt
  // beats BEFORE the count's downbeat, so the first full-bar downbeat lands on
  // the count while the clicks carry through the pickup notes.
  const pickup = $derived(
    tempo?.pickupBeats && tempo.pickupBeats < tempo.beatsPerBar ? tempo.pickupBeats : 0
  );
  // While counting in, this holds the current beat number shown big in the UI
  // (beats..1); null means no count-in is running.
  let countdown = $state<number | null>(null);
  // Pulses true for a moment on each beat to drive the flashing-dot indicator.
  let pulse = $state(false);

  // Bumped on every clear; an in-flight (async) count-in checks it after each
  // media event/tick and bails when it no longer matches.
  let countToken = 0;
  // The entire count is one generated WAV played through HTML media. iPadOS
  // routes this like the MP3, whereas Web Audio can remain silent in an
  // installed PWA even while its AudioContext claims to be running.
  let countAudio: HTMLAudioElement | null = null;
  let countUrl: string | null = null;
  let countShape = '';
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  function prepareCountAudio(nBeats: number, beatSec: number): HTMLAudioElement | null {
    if (!browser) return null;
    const shape = `${nBeats}:${beatSec}`;
    if (countAudio && countShape === shape) return countAudio;

    if (countAudio) countAudio.pause();
    if (countUrl) URL.revokeObjectURL(countUrl);
    countUrl = URL.createObjectURL(
      new Blob([buildCountInWav(nBeats, beatSec)], { type: 'audio/wav' })
    );
    countAudio = new Audio(countUrl);
    countAudio.preload = 'auto';
    countShape = shape;
    return countAudio;
  }

  function clearCountIn() {
    countToken++;
    if (tickInterval != null) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (countAudio) {
      countAudio.pause();
      try {
        countAudio.currentTime = 0;
      } catch {
        // The element may not have loaded enough metadata to seek yet.
      }
    }
    countdown = null;
    pulse = false;
  }

  $effect(() => {
    return () => {
      clearCountIn();
      if (countUrl) URL.revokeObjectURL(countUrl);
    };
  });

  // Schedule one bar of count at the song's tempo, then start the MP3 on the
  // next beat (or `pickup` beats before it, so a pickup's first full-bar
  // downbeat lands on the count). The WAV, visual countdown, and song start
  // all follow the media element's clock, so stalled media cannot leave the
  // visuals pretending that silent beats are sounding.
  function runCountIn(onDownbeat: () => void) {
    clearCountIn();
    const token = countToken;
    const nBeats = countBeats;
    const beatSec = period;
    const startBeat = nBeats - pickup;
    const playAt = songPlayTime(startBeat, beatSec);
    const a = prepareCountAudio(nBeats, beatSec);
    if (!a) {
      onDownbeat();
      return;
    }
    countdown = nBeats;
    try {
      a.currentTime = 0;
    } catch {
      // A fresh blob has no prior position, so an early seek failure is safe.
    }
    const playPromise = a.play(); // invoked directly inside the user's Play tap
    if (playPromise) {
      void playPromise.catch(() => {
        if (token !== countToken) return;
        clearCountIn();
        onDownbeat(); // media was refused: do not leave Play stuck
      });
    }

    let shownBeat = -1;
    let songStarted = false;
    tickInterval = setInterval(() => {
      if (token !== countToken) return;
      const elapsed = a.currentTime - COUNT_IN_LEAD_SECONDS;
      // Request the MP3 shortly before the musical target. On iPad the media
      // startup delay consumes that lead, while the click track stays exactly
      // on its original beat grid.
      if (!songStarted && (a.ended || a.currentTime >= playAt)) {
        songStarted = true;
        onDownbeat();
      }
      if (a.ended || elapsed >= nBeats * beatSec) {
        clearCountIn();
        return;
      }
      if (elapsed >= 0) {
        const beatIndex = Math.min(Math.floor(elapsed / beatSec), nBeats - 1);
        if (beatIndex !== shownBeat) {
          shownBeat = beatIndex;
          countdown = nBeats - beatIndex;
          pulse = true;
          setTimeout(() => (pulse = false), 150);
        }
      }
    }, 50);
  }

  function startPlayback() {
    if (sha == null) return;
    if (isCurrent) toggle();
    else playSha(sha, title);
  }

  function onPlay() {
    if (sha == null) return;

    // Already playing → just pause (and abort any count-in in progress).
    if (playing || countdown != null) {
      clearCountIn();
      if (playing) toggle();
      return;
    }

    // Count-in only makes sense when starting from the top. If we're resuming a
    // paused track partway through, skip the lead-in and resume immediately.
    const fromTop = !isCurrent || position < 0.5;
    if (countIn && fromTop) {
      // Restart from the top so the count-in actually leads into the first note.
      if (isCurrent) restart();
      // Warm the MP3 *inside this tap* so it buffers during the count-in and the
      // downbeat starts instantly — otherwise a cold load stalls after the beats.
      prime(sha, title);
      // The downbeat always plays from 0:00 (playFromTop supersedes the warm-up
      // and rewinds), rather than toggle(), which would *pause* if the muted
      // warm-up play were still in flight.
      const s = sha;
      runCountIn(() => playFromTop(s, title));
    } else {
      startPlayback();
    }
  }

  function onScrub(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (isCurrent) seek(v);
  }

  // Label/icon: show the live countdown number while leading in.
  const playLabel = $derived(
    countdown != null ? 'Counting in' : playing ? 'Pause' : 'Play'
  );
</script>

{#if compact}
  <!-- Single-row variant for the immersive Practice bar. Order matches the
       issue: count-in, Play (shows the live countdown), Rewind, slider, time.
       The big beat-indicator is dropped — the Play button carries the count. -->
  <div class="player compact" class:disabled class:counting={countdown != null}>
    <label class="toggle">
      <input type="checkbox" bind:checked={countIn} {disabled} />
      <span>Count-in</span>
    </label>
    {#if countIn}
      {#if tempo}
        <span
          class="tempo-chip"
          title={`Count-in from the song: ${tempo.beatsPerBar} beats at ${tempo.bpm} bpm${tempo.pickupBeats ? `, ${tempo.pickupBeats}-beat pickup` : ''}`}
          >{tempo.timeSig} · {tempo.bpm}</span
        >
      {:else}
        <select class="beats-sel" bind:value={beats} {disabled} aria-label="Count-in beats">
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      {/if}
    {/if}
    <button class="play" onclick={onPlay} {disabled} aria-label={playLabel}>
      {#if countdown != null}{countdown}{:else}{playing ? '❚❚' : '▶'}{/if}
    </button>
    <button class="beginning" onclick={restart} disabled={disabled || !isCurrent} aria-label="Beginning">
      ⏮
    </button>
    <input
      class="scrub"
      type="range"
      min="0"
      max={duration || 0}
      step="1"
      value={position}
      oninput={onScrub}
      {disabled}
      aria-label="Seek"
    />
    <span class="time">{formatTime(position)} / {formatTime(duration)}</span>
  </div>
{:else}
  <div class="player" class:disabled class:counting={countdown != null}>
    <div class="buttons">
      <button class="play" onclick={onPlay} {disabled} aria-label={playLabel}>
        {#if countdown != null}{countdown}{:else}{playing ? '❚❚' : '▶'}{/if}
      </button>
      <button class="beginning" onclick={restart} disabled={disabled || !isCurrent} aria-label="Beginning">
        ⏮
      </button>
    </div>

    <input
      class="scrub"
      type="range"
      min="0"
      max={duration || 0}
      step="1"
      value={position}
      oninput={onScrub}
      {disabled}
      aria-label="Seek"
    />

    <span class="time">{formatTime(position)} / {formatTime(duration)}</span>

    <!-- Count-in controls: a toggle and a 3/4 beat picker. Kept on their own row
         so the transport above stays unchanged. -->
    <div class="countin-row">
      <label class="toggle">
        <input type="checkbox" bind:checked={countIn} {disabled} />
        <span>Count-in</span>
      </label>
      {#if countIn}
        {#if tempo}
          <span
            class="tempo-chip"
            title={`Count-in from the song: ${tempo.beatsPerBar} beats at ${tempo.bpm} bpm${tempo.pickupBeats ? `, ${tempo.pickupBeats}-beat pickup` : ''}`}
            >{tempo.timeSig} · {tempo.bpm} bpm</span
          >
        {:else}
          <label class="beats">
            <span class="eyebrow">Beats</span>
            <select bind:value={beats} {disabled}>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
        {/if}
      {/if}
      <!-- Visual beat indicator: a big number plus a dot that flashes on each
           beat, so the downbeat is visible even with the sound off. -->
      {#if countdown != null}
        <div class="beat-indicator" aria-live="polite">
          <span class="dot" class:pulse></span>
          <span class="big">{countdown}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .player {
    display: grid;
    grid-template-columns: auto minmax(160px, 1fr) auto;
    align-items: center;
    gap: 12px;
    background: #f7f5ef;
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 10px 14px;
  }

  .player.disabled {
    border-color: var(--line);
    opacity: 0.7;
  }

  .buttons {
    display: flex;
    gap: 6px;
  }

  button {
    min-width: 44px;
    min-height: 44px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fffdf7;
    border-radius: 6px;
    font-size: 0.9rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* While counting in, the Play button shows the live beat number. */
  .player.counting button.play {
    font-size: 1.3rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  button.beginning {
    background: var(--panel);
    color: var(--accent-strong);
  }

  button:disabled {
    background: var(--line);
    border-color: var(--line);
    color: var(--muted);
    cursor: not-allowed;
  }

  .scrub {
    width: 100%;
    accent-color: var(--accent);
    min-height: 44px;
  }

  .time {
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
    color: var(--muted);
    white-space: nowrap;
  }

  /* The count-in controls span the full width below the transport. */
  .countin-row {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.82rem;
    color: var(--muted);
  }

  .toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }

  .beats {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.82rem;
    color: var(--muted);
  }

  /* Read-only tempo badge shown when the song's meter/BPM are known. */
  .tempo-chip {
    font-size: 0.82rem;
    color: var(--muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .beats select {
    min-height: 36px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 0 8px;
    background: var(--panel);
    color: var(--ink);
  }

  .beat-indicator {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--line);
    transition: background 60ms ease, transform 60ms ease;
  }

  /* Flashes on each beat so the pulse is visible with the sound off. */
  .dot.pulse {
    background: var(--accent);
    transform: scale(1.5);
  }

  .big {
    font-size: 1.6rem;
    font-weight: 800;
    line-height: 1;
    color: var(--accent-strong);
    font-variant-numeric: tabular-nums;
    min-width: 1ch;
    text-align: center;
  }

  /* Compact single-row variant for the immersive Practice bar. Transparent —
     the floating bar supplies the pill — with light text/controls for the dark
     background. Grows to fill the bar so the slider takes the slack. */
  .player.compact {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 10px;
    background: transparent;
    border: 0;
    padding: 0;
  }

  .player.compact .toggle,
  .player.compact .tempo-chip,
  .player.compact .time {
    color: #dfddd4;
  }

  .player.compact .scrub {
    flex: 1;
    min-width: 100px;
    width: auto;
  }

  .player.compact .beats-sel {
    min-height: 36px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #2c2d31;
    color: #fffdf7;
    padding: 0 6px;
  }
</style>
