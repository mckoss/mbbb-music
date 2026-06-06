<script lang="ts">
  import { audio, playSha, toggle, restart, seek } from '$lib/audio';
  import { formatTime } from '$lib/format';

  let { sha, title }: { sha: string | null; title: string } = $props();

  const isCurrent = $derived(sha != null && $audio.sha === sha);
  const playing = $derived(isCurrent && $audio.playing);
  const position = $derived(isCurrent ? $audio.position : 0);
  const duration = $derived(isCurrent ? $audio.duration : 0);
  const disabled = $derived(sha == null);

  function onPlay() {
    if (sha == null) return;
    if (isCurrent) toggle();
    else playSha(sha, title);
  }

  function onScrub(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (isCurrent) seek(v);
  }
</script>

<div class="player" class:disabled>
  <div class="buttons">
    <button class="play" onclick={onPlay} {disabled} aria-label={playing ? 'Pause' : 'Play'}>
      {playing ? '❚❚' : '▶'}
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
</style>
