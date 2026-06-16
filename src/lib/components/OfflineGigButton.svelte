<script lang="ts">
  import {
    downloadGig,
    removeGig,
    getManifest,
    storageEstimate,
    type GigManifest,
    type DownloadProgress,
  } from '$lib/offline';

  let {
    gigId,
    title,
    instrument,
    format,
    instrumentLabel,
    formatLabel,
    shas,
  }: {
    gigId: string;
    title: string;
    instrument: string;
    format: string;
    instrumentLabel: string;
    formatLabel: string;
    shas: string[];
  } = $props();

  type Status = 'unknown' | 'idle' | 'downloading' | 'saved' | 'unsupported';
  let status = $state<Status>('unknown');
  let manifest = $state<GigManifest | null>(null);
  let progress = $state<DownloadProgress | null>(null);
  let error = $state<string | null>(null);
  let usageLabel = $state<string | null>(null);

  // The saved set is for whatever instrument/format was chosen at download time;
  // flag a mismatch so the player can refresh it for their current selection.
  const stale = $derived(
    manifest != null && (manifest.instrument !== instrument || manifest.format !== format)
  );

  async function refresh() {
    if (typeof caches === 'undefined') {
      status = 'unsupported';
      return;
    }
    manifest = await getManifest(gigId);
    status = manifest ? 'saved' : 'idle';
    const est = await storageEstimate();
    usageLabel = est ? `${fmtBytes(est.usage)} of ${fmtBytes(est.quota)} used on this device` : null;
  }

  $effect(() => {
    void refresh();
  });

  async function onDownload() {
    error = null;
    status = 'downloading';
    progress = { done: 0, total: shas.length + 2 };
    try {
      manifest = await downloadGig(
        { id: gigId, title, instrument, format, shas },
        (p) => (progress = p)
      );
      status = 'saved';
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Download failed.';
      status = manifest ? 'saved' : 'idle';
    } finally {
      progress = null;
    }
  }

  async function onRemove() {
    error = null;
    await removeGig(gigId);
    await refresh();
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  const pct = $derived(progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0);
</script>

{#if status !== 'unsupported' && shas.length > 0}
  <div class="offline">
    <div class="head">
      <span class="ico" aria-hidden="true">⤓</span>
      <div class="copy">
        <h3>Offline access</h3>
        <p class="sub">
          Save these {shas.length} chart{shas.length === 1 ? '' : 's'} ({instrumentLabel} · {formatLabel})
          so they open with no wifi at the gig.
        </p>
      </div>
    </div>

    {#if status === 'downloading'}
      <div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100">
        <span class="fill" style:width={`${pct}%`}></span>
      </div>
      <p class="status">Downloading… {progress?.done ?? 0}/{progress?.total ?? 0}</p>
    {:else if status === 'saved'}
      <p class="status ok">
        ✓ Available offline{manifest ? ` — ${manifest.pageCount} page${manifest.pageCount === 1 ? '' : 's'}, saved ${manifest.instrument}/${manifest.format}` : ''}.
      </p>
      {#if stale}
        <p class="status warn">
          Your current selection ({instrumentLabel} · {formatLabel}) differs from what's saved.
          <button class="link" onclick={onDownload}>Re-download for it</button>.
        </p>
      {/if}
      <div class="actions">
        <button class="btn ghost" onclick={onRemove}>Remove download</button>
      </div>
    {:else if status === 'idle'}
      <div class="actions">
        <button class="btn" onclick={onDownload}>Download for offline</button>
      </div>
    {/if}

    {#if error}<p class="status err">{error}</p>{/if}
    {#if usageLabel}<p class="hint">{usageLabel}. Tip: add this app to your Home Screen so downloads aren't auto-cleared.</p>{/if}
  </div>
{/if}

<style>
  .offline {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px 16px;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .ico {
    font-size: 1.4rem;
    color: var(--accent-strong);
    line-height: 1.4;
  }
  h3 {
    font-size: 1rem;
    margin: 0;
  }
  .sub {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 2px 0 0;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .btn {
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid var(--accent-strong);
    border-radius: 6px;
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .btn.ghost {
    background: #f7f5ef;
    color: var(--accent-strong);
    border-color: var(--line);
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 120ms ease;
  }
  .status {
    font-size: 0.82rem;
    color: var(--muted);
    margin: 0;
  }
  .status.ok {
    color: var(--accent-strong);
    font-weight: 600;
  }
  .status.warn {
    color: #8a5a00;
  }
  .status.err {
    color: #b3261e;
  }
  .hint {
    font-size: 0.76rem;
    color: var(--muted);
    margin: 0;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent-strong);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
