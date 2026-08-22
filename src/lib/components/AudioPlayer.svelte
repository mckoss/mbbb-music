<script lang="ts">
  import { page } from '$app/state';

  import { audio, playSha, playFromTop, prime, toggle, restart, seek, ensureLoaded } from '$lib/audio';
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

  // One shared AudioContext for the click tones. Created lazily *inside* the
  // Play tap so iOS Safari allows it, and resumed there too (iOS suspends a
  // context that wasn't started by a user gesture).
  let ctx: AudioContext | null = null;
  // Bumped on every clear; an in-flight (async) count-in checks it after each
  // await/tick and bails when it no longer matches.
  let countToken = 0;
  // Oscillators scheduled but not yet finished. Web Audio tones fire on the
  // audio clock regardless of JS timers, so cancelling a count-in must stop
  // these explicitly or the leftover clicks sound over whatever plays next.
  let liveOscs: OscillatorNode[] = [];
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  function audioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) {
      ctx = new Ctor();
      // iOS mutes Web Audio (but not <audio> media playback) under the
      // ring/silent switch unless the page declares a playback session —
      // without this the MP3 plays while the count-in is silent.
      try {
        (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'playback';
      } catch {
        // older browsers: no audioSession — nothing to do
      }
    }
    return ctx;
  }

  // A short metronome blip. The accented (downbeat-cueing) final beat is higher
  // and louder so it's unmistakable by ear.
  function click(at: number, accent: boolean) {
    const c = ctx;
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = accent ? 1320 : 880;
    const peak = accent ? 0.5 : 0.3;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    osc.connect(gain).connect(c.destination);
    osc.start(at);
    osc.stop(at + 0.1);
    liveOscs.push(osc);
    osc.onended = () => {
      liveOscs = liveOscs.filter((o) => o !== osc);
    };
  }

  function clearCountIn() {
    countToken++;
    if (tickInterval != null) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    for (const o of liveOscs) {
      o.onended = null;
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    liveOscs = [];
    countdown = null;
    pulse = false;
  }

  // Schedule one bar of count at the song's tempo, then start the MP3 on the
  // next beat (or `pickup` beats before it, so a pickup's first full-bar
  // downbeat lands on the count). Tones, the visual countdown, and the song
  // start are all driven from the ONE AudioContext clock the tones are
  // scheduled on — so the song can never start while count tones are still
  // pending. (The old version scheduled tones on the audio clock but the
  // downbeat on setTimeout; when iOS resumed the context late, the frozen
  // clock made the tones fire in a burst after the song had already started.)
  async function runCountIn(onDownbeat: () => void) {
    const c = audioContext();
    // No Web Audio (or it failed to create): skip straight to playback so Play
    // never becomes a dead button.
    if (!c) {
      onDownbeat();
      return;
    }
    clearCountIn();
    const token = countToken;
    // Capture the count's shape for this run — props may change mid-count.
    const nBeats = countBeats;
    const beatSec = period;
    const startBeat = nBeats - pickup; // when the MP3 starts, in beats
    countdown = nBeats; // show the count immediately, before the first tone

    // Resume must COMPLETE before tones are scheduled: a suspended context's
    // currentTime is frozen, so tones scheduled against it land "in the past"
    // and squish into a burst whenever the clock finally starts. Bound the wait
    // so a wedged context can't turn Play into a dead button.
    try {
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      // resume failed — the wall-clock fallback below still runs the count
    }
    if (token !== countToken) return; // cancelled while resuming

    const lead = 0.12; // small offset so the first tone isn't clipped
    const clockLive = c.state === 'running';
    const start = c.currentTime + lead;
    if (clockLive) {
      for (let i = 0; i < nBeats; i++) {
        click(start + i * beatSec, i === nBeats - 1); // last beat accented
      }
    }

    // Drive the countdown and the song start by polling the audio clock. If
    // the clock isn't advancing (context stuck suspended — no tones sounding),
    // fall back to wall time, at most 1.5s behind, so Play never hangs.
    const wallStart = performance.now() + lead * 1000;
    let shownBeat = -1;
    let songStarted = false;
    tickInterval = setInterval(() => {
      if (token !== countToken) return;
      const audioElapsed = c.state === 'running' ? c.currentTime - start : -Infinity;
      const wallElapsed = (performance.now() - wallStart) / 1000;
      const elapsed = Math.max(audioElapsed, wallElapsed - 1.5);
      if (!songStarted && elapsed >= startBeat * beatSec) {
        songStarted = true;
        onDownbeat();
      }
      if (elapsed >= nBeats * beatSec) {
        clearCountIn(); // stops any not-yet-sounded tones once the bar is over
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
      void runCountIn(() => playFromTop(s, title));
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
