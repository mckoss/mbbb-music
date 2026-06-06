<script lang="ts">
  import { browser } from '$app/environment';
  import { score, printFormat } from '$lib/stores';
  import AudioPlayer from './AudioPlayer.svelte';

  const current = $derived($score);
  const aspect = $derived($printFormat === 'lyre' ? 7 / 5 : 8.5 / 11);

  // Open behavior: push a history entry so the browser Back button closes the
  // overlay. We track whether we pushed so closing via the button can pop it
  // back, keeping history tidy.
  let pushed = false;

  $effect(() => {
    if (!browser) return;
    if (current && !pushed) {
      history.pushState({ scoreOverlay: true }, '');
      pushed = true;
    }
  });

  function close() {
    if (browser && pushed) {
      pushed = false;
      // Popping triggers popstate, which clears the store below.
      history.back();
    } else {
      score.set(null);
    }
  }

  function onPopState() {
    if (current) {
      pushed = false;
      score.set(null);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && current) close();
  }

  function print() {
    if (browser) window.print();
  }
</script>

<svelte:window onpopstate={onPopState} onkeydown={onKey} />

{#if current}
  <div class="overlay">
    <header class="bar">
      <div class="info">
        <p class="kicker perf">Performance view</p>
        <h2>{current.title}</h2>
        <p class="sub">{current.label} · {$printFormat === 'lyre' ? 'Lyre' : 'Letter'}</p>
      </div>

      <div class="controls">
        <label class="fmt">
          <span class="eyebrow">Format</span>
          <select bind:value={$printFormat}>
            <option value="letter">Letter</option>
            <option value="lyre">Lyre</option>
          </select>
        </label>
        <button class="ghost" onclick={print}>Print</button>
        <button class="primary" onclick={close}>Collection</button>
      </div>
    </header>

    <div class="practice">
      <AudioPlayer sha={current.sha ? current.sha : null} title={current.title} />
    </div>

    <div class="stage" class:lyre={$printFormat === 'lyre'}>
      <iframe
        title={`${current.title} — ${current.label}`}
        src={`/blob/${current.sha}#toolbar=0&view=FitH`}
        style={`aspect-ratio:${aspect};`}
      ></iframe>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #202124;
    color: #fffdf7;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-end;
    justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid rgba(255, 253, 247, 0.12);
  }

  .perf {
    color: #f2d36b;
  }

  h2 {
    font-size: 1.4rem;
    margin-top: 4px;
  }

  .sub {
    color: #dfddd4;
    font-size: 0.85rem;
    margin-top: 2px;
  }

  .controls {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }

  .fmt {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
  }

  .fmt span {
    color: #dfddd4;
  }

  select {
    min-height: 44px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #2c2d31;
    color: #fffdf7;
    padding: 0 10px;
  }

  button {
    min-height: 44px;
    padding: 0 18px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.82rem;
  }

  .ghost {
    background: transparent;
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
  }

  .primary {
    background: var(--accent);
    color: #fffdf7;
    border: 1px solid var(--accent-strong);
  }

  .practice {
    padding: 14px 24px;
  }

  .stage {
    flex: 1;
    display: flex;
    justify-content: center;
    padding: 8px 24px 28px;
  }

  .stage iframe {
    width: 100%;
    max-width: 780px;
    border: 0;
    background: #fff;
    box-shadow: var(--shadow);
  }

  .stage.lyre iframe {
    max-width: 620px;
  }

  @media print {
    .bar,
    .practice {
      display: none;
    }

    .overlay {
      position: static;
      background: #fff;
    }
  }
</style>
