<script lang="ts">
  import { audio, playSha, toggle, restart, seek } from '$lib/audio';
  import { formatTime } from '$lib/format';

  let { sha, title }: { sha: string | null; title: string } = $props();

  const isCurrent = $derived(sha != null && $audio.sha === sha);
  const playing = $derived(isCurrent && $audio.playing);
  const position = $derived(isCurrent ? $audio.position : 0);
  const duration = $derived(isCurrent ? $audio.duration : 0);
  const disabled = $derived(sha == null);

  // Count-in: a fixed metronome lead-in so a player knows when the downbeat
  // lands instead of being caught out by the MP3 jumping straight into the
  // first note. There's no BPM in the catalog, so this is a plain N-beat,
  // one-second-apart count (~60 BPM); the final beat is accented and the MP3
  // starts on the beat immediately after it.
  let countIn = $state(true);
  let beats = $state(4); // 3 or 4 — picked by the user, kept simple
  // While counting in, this holds the current beat number shown big in the UI
  // (beats..1); null means no count-in is running.
  let countdown = $state<number | null>(null);
  // Pulses true for a moment on each beat to drive the flashing-dot indicator.
  let pulse = $state(false);

  // One shared AudioContext for the click tones. Created lazily *inside* the
  // Play tap so iOS Safari allows it, and resumed there too (iOS suspends a
  // context that wasn't started by a user gesture).
  let ctx: AudioContext | null = null;
  // Timers for an in-progress count-in, so we can cancel it cleanly.
  let beatTimers: ReturnType<typeof setTimeout>[] = [];

  function audioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
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
  }

  function clearCountIn() {
    for (const t of beatTimers) clearTimeout(t);
    beatTimers = [];
    countdown = null;
    pulse = false;
  }

  // Schedule N beats one second apart, then start the MP3 on the next beat.
  // Tones are scheduled on the AudioContext clock (sample-accurate), while the
  // visual countdown is driven by setTimeout on the same 1s grid.
  function runCountIn(onDownbeat: () => void) {
    const c = audioContext();
    // No Web Audio (or it failed to create): skip straight to playback so Play
    // never becomes a dead button.
    if (!c) {
      onDownbeat();
      return;
    }
    void c.resume(); // required on iOS; safe elsewhere

    clearCountIn();
    const start = c.currentTime + 0.12; // small offset so the first tone isn't clipped
    for (let i = 0; i < beats; i++) {
      const accent = i === beats - 1; // last beat is the accented pickup to the downbeat
      click(start + i, accent);
      const n = beats - i; // big number: beats..1
      beatTimers.push(
        setTimeout(() => {
          countdown = n;
          pulse = true;
          setTimeout(() => (pulse = false), 150);
        }, i * 1000)
      );
    }
    // The downbeat falls one beat after the last count tone.
    beatTimers.push(
      setTimeout(() => {
        clearCountIn();
        onDownbeat();
      }, beats * 1000)
    );
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
      runCountIn(startPlayback);
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
      <label class="beats">
        <span class="eyebrow">Beats</span>
        <select bind:value={beats} {disabled}>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>
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
</style>
