<script lang="ts">
  let { data } = $props();

  const KINDS = [
    { key: 'added', label: 'Added' },
    { key: 'updated', label: 'Updated' },
    { key: 'restored', label: 'Restored' },
    { key: 'removed', label: 'Removed' },
  ];

  const duration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
  const total = (c: Record<string, number>) => KINDS.reduce((n, k) => n + (c[k.key] ?? 0), 0);
</script>

<svelte:head><title>Sync History · MBBB Music</title></svelte:head>

<section class="history">
  <header>
    <p class="kicker">Admin</p>
    <h2>Sync history</h2>
    <p class="body">
      Every Drive sync, newest first, with the files it added, updated (renamed, moved, new
      content, or reclassified to a different song, instrument, or part), restored, or removed.
      Open a sync to see each file.
    </p>
  </header>

  {#if data.runs.length}
    <div class="panel">
      <ul class="runs">
        {#each data.runs as r (r.id)}
          <li>
            <a class="run" href={`/admin/sync-history/${r.id}`}>
              <span class="when">
                <strong>{r.when}</strong>
                <span class="muted">{r.by} · {duration(r.seconds)}{#if r.seen != null}{' · '}{r.seen} files checked{/if}</span>
              </span>
              <span class="outcome">
                {#if !r.ok}
                  <span class="chip bad" title={r.error ?? ''}>Failed</span>
                {/if}
                {#if r.failed}<span class="chip bad">{r.failed} download{r.failed === 1 ? '' : 's'} failed</span>{/if}
                {#if r.warnings}<span class="chip warn">{r.warnings} warning{r.warnings === 1 ? '' : 's'}</span>{/if}
                {#each KINDS as k (k.key)}
                  {#if r.counts[k.key]}<span class="chip {k.key}">{r.counts[k.key]} {k.label.toLowerCase()}</span>{/if}
                {/each}
                {#if r.ok && !total(r.counts)}<span class="muted">No changes</span>{/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="panel empty">
      No syncs recorded yet. Run <strong>Sync from Drive</strong> on
      <a href="/library-status">Library Status</a>; each sync from now on is kept here.
    </p>
  {/if}
</section>

<style>
  .history {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  .kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.72rem;
    font-weight: 800;
    color: var(--accent-strong);
  }

  .body,
  .muted {
    color: var(--muted);
  }

  .body {
    max-width: 70ch;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 8px 18px;
  }

  .empty {
    padding: 16px 18px;
    color: var(--muted);
  }

  .runs {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .runs li + li {
    border-top: 1px solid var(--line);
  }

  .run {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 12px 0;
    min-height: 44px;
    color: inherit;
    text-decoration: none;
  }

  .run:hover strong {
    text-decoration: underline;
  }

  .when {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.9rem;
  }

  .when .muted {
    font-size: 0.8rem;
  }

  .outcome {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 0.82rem;
  }

  .chip {
    border-radius: 999px;
    padding: 3px 10px;
    font-weight: 700;
    font-size: 0.78rem;
    border: 1px solid var(--line);
    white-space: nowrap;
  }

  .chip.added {
    background: #e3f2e1;
    color: #1f5f1a;
    border-color: #b9dcb4;
  }

  .chip.updated {
    background: #e4edf8;
    color: #1d4b80;
    border-color: #b8cde8;
  }

  .chip.restored {
    background: #efe6f6;
    color: #5b2d80;
    border-color: #d5c1e6;
  }

  .chip.removed,
  .chip.bad {
    background: #f8e3e1;
    color: #8a2219;
    border-color: #e6bab5;
  }

  .chip.warn {
    background: #fbf0d9;
    color: #7a5208;
    border-color: #ecd4a0;
  }
</style>
