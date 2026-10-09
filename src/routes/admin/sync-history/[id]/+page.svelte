<script lang="ts">
  let { data } = $props();
  const run = $derived(data.run);

  interface FieldChange {
    field: string;
    label: string;
    from: string | null;
    to: string | null;
  }
  interface Change {
    id: string;
    kind: string;
    name: string | null;
    folder: string | null;
    song: string | null;
    instrument: string | null;
    part: string | null;
    key: string | null;
    type: string | null;
    status: string | null;
    sha256: string | null;
    fields?: FieldChange[];
  }

  const SECTIONS = [
    { key: 'added', title: 'Added', blurb: 'New files imported from Drive.' },
    {
      key: 'updated',
      title: 'Updated',
      blurb: 'Renamed, moved, new content, or reclassified to a different song, instrument, or part.',
    },
    { key: 'restored', title: 'Restored', blurb: 'Files that had been removed and are back in Drive.' },
    {
      key: 'removed',
      title: 'Removed',
      blurb: 'No longer in Drive. Still in the library on its stored copy — open a file to archive it.',
    },
    { key: 'ignored', title: 'Not imported', blurb: 'Newly seen files the sync skips (shortcuts, system files, unsupported types).' },
  ];

  const changes = $derived((run.changes ?? []) as Change[]);
  const byKind = $derived(
    Object.fromEntries(SECTIONS.map((s) => [s.key, changes.filter((c) => c.kind === s.key)])) as Record<string, Change[]>,
  );

  const duration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
  const KEY_TEXT: Record<string, string> = { bflat: 'B♭', eflat: 'E♭', aflat: 'A♭', fsharp: 'F♯', f: 'F', c: 'C' };

  /** A field value for display; a content hash is shown short. */
  function show(f: FieldChange, v: string | null): string {
    if (v == null || v === '') return '—';
    if (f.field === 'content') return v.slice(0, 10) + '…';
    if (f.field === 'key') return KEY_TEXT[v] ?? v;
    return v;
  }

  /** "Trumpet (B♭) part 2" style placement for a change row. */
  function placement(c: Change): string {
    const bits = [c.instrument, c.key && c.instrument ? KEY_TEXT[c.key] ?? c.key : null, c.part ? `part ${c.part}` : null];
    const s = bits.filter(Boolean).join(' ');
    return s || (c.type ?? '');
  }

  const driveUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
</script>

<svelte:head><title>Sync {data.when} · MBBB Music</title></svelte:head>

<section class="run">
  <header>
    <p class="kicker"><a href="/admin/sync-history">Sync history</a></p>
    <h2>{data.when}</h2>
    <p class="body">
      {data.by ? `Started by ${data.by}` : 'Run from the command line'} · took {duration(data.seconds)}{#if run.summary}{' · '}{run.summary.seen}
        files checked, {run.summary.downloaded} downloaded{/if}
    </p>
    {#if !run.ok}
      <p class="alert">This sync failed: {run.error}</p>
    {/if}
  </header>

  {#if run.failed?.length}
    <div class="panel">
      <h3>Download failures · {run.failed.length}</h3>
      <ul class="plain">
        {#each run.failed as f (f.id)}
          <li><strong>{f.name}</strong> <span class="muted">— {f.error}</span></li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if run.warnings?.length}
    <div class="panel">
      <h3>Warnings · {run.warnings.length}</h3>
      <ul class="plain">
        {#each run.warnings as w, i (i)}<li>{w}</li>{/each}
      </ul>
    </div>
  {/if}

  {#if !changes.length}
    <p class="panel empty">{run.ok ? 'This sync found nothing new — no files changed.' : 'No files changed before the sync failed.'}</p>
  {/if}

  {#each SECTIONS as s (s.key)}
    {@const items = byKind[s.key]}
    {#if items.length}
      <details class="panel section {s.key}" open={s.key !== 'ignored'}>
        <summary>
          <h3>{s.title} · {items.length}</h3>
          <span class="muted">{s.blurb}</span>
        </summary>
        <ul class="changes">
          {#each items as c (c.id)}
            <li>
              <div class="file">
                <span class="song">{c.song ?? '—'}</span>
                <span class="name">
                  <a href={`/library-status/files/${encodeURIComponent(c.id)}`} title="How the library handles this file">{c.name}</a>
                </span>
                <span class="place">{placement(c)}</span>
                <a class="drive muted" href={driveUrl(c.id)} target="_blank" rel="noopener">Drive ↗</a>
              </div>
              {#if c.folder && c.folder !== c.song}<div class="folder muted">{c.folder}</div>{/if}
              {#if c.fields?.length}
                <ul class="fields">
                  {#each c.fields as f (f.field)}
                    <li>
                      <span class="label">{f.label}</span>
                      {#if f.field === 'content'}
                        <span>replaced with new content</span>
                      {:else}
                        <span class="from">{show(f, f.from)}</span>
                        <span class="arrow" aria-label="changed to">→</span>
                        <span class="to">{show(f, f.to)}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  {/each}

  {#if run.log?.length}
    <details class="panel log">
      <summary><h3>Log · {run.log.length} lines</h3></summary>
      <ol class="lines">
        {#each run.log as l, i (i)}
          <li class={l.level}>{l.msg}</li>
        {/each}
      </ol>
    </details>
  {/if}
</section>

<style>
  .run {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  h3 {
    font-size: 1.05rem;
    margin: 0;
  }

  .kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.72rem;
    font-weight: 800;
  }

  .kicker a {
    color: var(--accent-strong);
  }

  .body,
  .muted {
    color: var(--muted);
  }

  .alert {
    margin-top: 8px;
    padding: 10px 14px;
    border-radius: 8px;
    background: #f8e3e1;
    color: #8a2219;
    font-weight: 700;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 14px 18px;
  }

  .empty {
    color: var(--muted);
  }

  details > summary {
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    min-height: 32px;
  }

  .section {
    border-left: 4px solid var(--line);
  }

  .section.added {
    border-left-color: #5aa652;
  }

  .section.updated {
    border-left-color: #4a7fc0;
  }

  .section.restored {
    border-left-color: #8a5bb3;
  }

  .section.removed {
    border-left-color: #c2493d;
  }

  .plain {
    margin: 8px 0 0;
    padding-left: 18px;
    font-size: 0.88rem;
  }

  .changes {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }

  .changes > li {
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }

  .file {
    display: grid;
    grid-template-columns: minmax(120px, 0.8fr) minmax(160px, 1.6fr) minmax(120px, 1fr) auto;
    grid-template-areas: 'song name place drive';
    gap: 4px 12px;
    align-items: baseline;
    font-size: 0.9rem;
  }

  .song {
    grid-area: song;
    font-weight: 700;
  }

  .name {
    grid-area: name;
    overflow-wrap: anywhere;
  }

  .place {
    grid-area: place;
  }

  .drive {
    grid-area: drive;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .folder {
    font-size: 0.78rem;
    margin-top: 2px;
    overflow-wrap: anywhere;
  }

  .fields {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 0.85rem;
  }

  .fields li {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  }

  .label {
    min-width: 80px;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .from {
    text-decoration: line-through;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .to {
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .lines {
    margin: 10px 0 0;
    padding-left: 0;
    list-style: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.76rem;
    max-height: 420px;
    overflow: auto;
  }

  .lines .warn {
    color: #7a5208;
  }

  .lines .error {
    color: #8a2219;
  }

  @media (max-width: 720px) {
    .file {
      grid-template-columns: 1fr auto;
      grid-template-areas: 'song drive' 'name name' 'place place';
    }
  }
</style>
