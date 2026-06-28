<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { onDestroy } from 'svelte';
  import type { Catalog, Tune, CatalogPart, CatalogAsset, UnreachableItem } from '$lib/types';
  import { instrumentDisplay, partLabel, audioLabel, stripCopyOf } from '$lib/format';
  import { sourceStyle, UNREACHABLE_STYLE } from '$lib/sources';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import { ALL_STATUSES, STATUS_DESC } from '$lib/song-status';
  import { INSTRUMENT_CHOICES } from '../../sync/instruments.js';
  import { slugify } from '../../sync/slugify.js';

  // Written-key choices a part can be corrected to ('' = the instrument default).
  const KEY_CHOICES = [
    { slug: '', label: '(default)' },
    { slug: 'bflat', label: 'B♭' },
    { slug: 'eflat', label: 'E♭' },
    { slug: 'aflat', label: 'A♭' },
    { slug: 'fsharp', label: 'F♯' },
    { slug: 'f', label: 'F' },
    { slug: 'c', label: 'C (concert)' },
  ];

  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);
  const instruments = $derived(catalog.instruments ?? []);

  // Friendly open URL (no raw sha leak), falling back to the blob for any sha
  // not present in the player index.
  const assetIndex = $derived(assetIndexFor(catalog));
  const openUrl = (sha: string) => urlForSha(assetIndex, sha) ?? `/blob/${sha}`;
  // Source labels in priority order (highest first); index is the rank.
  const sources = $derived(catalog.sources ?? []);

  const rank = (label: string | null) => {
    const i = sources.indexOf(label ?? '');
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  // Anything carrying a source + (optional) instrument/format/name — covers both
  // reachable assets/parts and unreachable items.
  type Sourced = { source: string | null; sha256?: string; museScore?: boolean } & Partial<CatalogPart> &
    Partial<UnreachableItem>;

  interface CellItem {
    href: string;
    label: string; // the original source filename
    color: string; // popup link accent (red for unreachable)
    chip: string; // source color swatch
    chipName: string; // source name (tooltip)
    unreachable: boolean;
  }
  interface Cell {
    count: number;
    color: string; // square background (the principal's color; red if it's unreachable)
    text: string;
    name: string;
    // When the cell's copies span two or more source folders, the square is split
    // diagonally: `color` fills the upper-left (the principal/highest-priority
    // folder), `color2` the lower-right (the next folder by priority). Null when a
    // single folder supplies the cell, leaving the square a solid `color`.
    color2: string | null;
    name2: string | null;
    items: CellItem[];
    dot: boolean; // a non-red square that still hides an unreachable file
  }

  // The indicator for a column's reachable + unreachable items. The square is
  // colored by the principal (highest-priority source, ties preferring a
  // reachable copy); it's red only when that principal is itself unreachable.
  // Each popup item is colored by its own status (red when unreachable).
  function buildCell(
    reachable: Sourced[],
    unreachable: UnreachableItem[],
    makeLabel: (a: Sourced) => string
  ): Cell | null {
    const all = [
      ...reachable.map((it) => ({ it, unreachable: false })),
      ...unreachable.map((it) => ({ it: it as Sourced, unreachable: true })),
    ];
    if (all.length === 0) return null;

    let principal = all[0];
    for (const cur of all) {
      const better =
        rank(cur.it.source) < rank(principal.it.source) ||
        (rank(cur.it.source) === rank(principal.it.source) && principal.unreachable && !cur.unreachable);
      if (better) principal = cur;
    }
    const style = principal.unreachable ? UNREACHABLE_STYLE : sourceStyle(principal.it.source);
    // A non-red square that nonetheless hides an unreachable copy gets a corner
    // dot, so a buried permissions gap is visible at a glance.
    const dot = !principal.unreachable && all.some((a) => a.unreachable);

    // Distinct source folders feeding this cell, in priority order (highest
    // first). With two or more, the square is split into folder-colored
    // triangles; the principal (upper-left) is always distinctSources[0] since it
    // minimizes rank, so we only need the next folder's color for the lower-right.
    const distinctSources: (string | null)[] = [];
    const seenSrc = new Set<string>();
    for (const a of [...all].sort((x, y) => rank(x.it.source) - rank(y.it.source))) {
      const key = a.it.source ?? '';
      if (!seenSrc.has(key)) {
        seenSrc.add(key);
        distinctSources.push(a.it.source ?? null);
      }
    }
    const second = distinctSources.length >= 2 ? sourceStyle(distinctSources[1]) : null;

    return {
      count: all.length,
      color: style.color,
      text: style.text,
      name: style.name,
      color2: second ? second.color : null,
      name2: second ? second.name : null,
      dot,
      items: all.map(({ it, unreachable: un }) => {
        const st = un ? UNREACHABLE_STYLE : sourceStyle(it.source);
        // Show the file's real name from its source folder, not the derived label.
        const name = it.originalName ? stripCopyOf(it.originalName) : makeLabel(it);
        return {
          href: un ? (it.driveUrl ?? '#') : it.sha256 ? openUrl(it.sha256) : '#',
          label: un ? `${name} — unreachable` : name,
          color: un ? UNREACHABLE_STYLE.color : 'var(--accent-strong)',
          chip: st.color,
          chipName: st.name,
          unreachable: un,
        };
      }),
    };
  }

  const partItemLabel = (p: Sourced) =>
    `${partLabel(p as CatalogPart)} — ${p.format === 'lyre' ? 'Lyre' : 'Letter'}`;
  const audioItemLabel = (a: Sourced) => audioLabel(a.originalName ?? null, a.museScore);
  const museItemLabel = (a: Sourced) => (a.originalName ? stripCopyOf(a.originalName) : 'MuseScore file');
  const scoreItemLabel = (a: Sourced) => (a.originalName ? stripCopyOf(a.originalName) : 'Full score');
  const miscItemLabel = (a: Sourced) => (a.originalName ? stripCopyOf(a.originalName) : (a.assetType ?? 'File'));

  const partsFor = (t: Tune, slug: string) => t.parts.filter((p) => p.instrumentSlug === slug);
  // Everything in a song folder that isn't a part/score/audio/MuseScore: notes
  // (Google Docs → PDF), images, and other downloadable files.
  const miscFor = (t: Tune): Sourced[] => [...t.notes, ...t.images, ...t.files];
  // Route unreachable items to the same columns as their reachable counterparts.
  const unMusescore = (t: Tune) => (t.unreachable ?? []).filter((u) => u.assetType === 'musescore');
  const unAudio = (t: Tune) => (t.unreachable ?? []).filter((u) => u.assetType === 'mp3');
  const unScore = (t: Tune) => (t.unreachable ?? []).filter((u) => u.assetType === 'pdf' && !u.instrumentSlug);
  const unMisc = (t: Tune) =>
    (t.unreachable ?? []).filter(
      (u) => !u.instrumentSlug && !['musescore', 'mp3', 'pdf'].includes(u.assetType)
    );
  const unFor = (t: Tune, slug: string) => (t.unreachable ?? []).filter((u) => u.instrumentSlug === slug);

  // Columns, left to right: the master MuseScore source, audio, the whole-band
  // PDF (instrument-less full scores), then one column per instrument.
  const columns = $derived([
    { key: 'musescore', label: 'MuseScore (Master)' },
    { key: 'audio', label: 'Audio' },
    { key: 'score', label: 'Whole Band (PDF)' },
    { key: 'misc', label: 'Misc Files' },
    ...instruments.map((i) => ({ key: i.slug, label: instrumentDisplay(i.label, i.key) })),
  ]);

  // One row per tune; cells aligned to `columns`.
  const rows = $derived(
    tunes.map((t) => ({
      slug: t.slug,
      title: t.title,
      status: t.status,
      cells: [
        buildCell(t.musescore, unMusescore(t), museItemLabel),
        buildCell(t.audio, unAudio(t), audioItemLabel),
        buildCell(t.scores, unScore(t), scoreItemLabel),
        buildCell(miscFor(t), unMisc(t), miscItemLabel),
        ...instruments.map((inst) => buildCell(partsFor(t, inst.slug), unFor(t, inst.slug), partItemLabel)),
      ] as (Cell | null)[],
      // Manual originals masked by a generated version, aligned to the same
      // columns: only the Whole-Band (score) and per-instrument (part) columns can
      // carry them; the rest are always null. These use the normal source-colored
      // cell (the masked SUB-ROW, not the chip color, is what marks them masked).
      hasMasked: (t.masked?.length ?? 0) > 0,
      maskedCells: [
        null,
        null,
        buildCell((t.masked ?? []).filter((m) => m.bucket === 'scores'), [], scoreItemLabel),
        null,
        ...instruments.map((inst) =>
          buildCell(
            (t.masked ?? []).filter((m) => m.bucket === 'parts' && m.instrumentSlug === inst.slug),
            [],
            partItemLabel
          )
        ),
      ] as (Cell | null)[],
    }))
  );

  // Group rows into status sections (in ALL_STATUSES order), dropping empty ones.
  const groups = $derived(
    ALL_STATUSES.map((status) => ({ status, rows: rows.filter((r) => r.status === status) })).filter(
      (g) => g.rows.length > 0
    )
  );

  // Legend: one entry per configured source (linked to its Drive folder when
  // known), plus the reserved "unreachable" red.
  const legend = $derived([
    ...sources.map((s) => ({ key: s, url: catalog.sourceUrls?.[s] ?? null, ...sourceStyle(s) })),
    { key: '__unreachable', url: null, ...UNREACHABLE_STYLE },
  ]);

  // --- Admin: run the Drive sync with live progress (SSE) ------------------
  const isAdmin = $derived(page.data.user?.role === 'admin');
  // Any approved member may propose a metadata correction.
  const canEdit = $derived(Boolean(page.data.user?.role));
  // The slug-text rename (display slug) is limited to admins and organizers.
  const canEditSlug = $derived(page.data.user?.role === 'admin' || page.data.user?.role === 'organizer');

  // --- Metadata correction editor (per song) -------------------------------
  let editing = $state<Tune | null>(null);
  function openEditor(slug: string) {
    editing = tunes.find((t) => t.slug === slug) ?? null;
  }
  // Songs a file/folder can be reassigned to (alphabetical), for the move pickers.
  const songOptions = $derived(
    [...tunes].map((t) => ({ slug: t.slug, title: t.title })).sort((a, b) => a.title.localeCompare(b.title))
  );
  // Every file in the open song (parts + other assets) that carries a Drive id.
  const editingFiles = $derived.by(() => {
    if (!editing) return [];
    const all = [
      ...editing.parts,
      ...editing.scores,
      ...editing.notes,
      ...editing.audio,
      ...editing.musescore,
      ...editing.images,
      ...editing.files,
    ];
    return all
      .filter((a) => a.driveFileId)
      .map((a) => ({ driveFileId: a.driveFileId!, name: a.originalName ? stripCopyOf(a.originalName) : a.driveFileId!, folder: a.folder ?? null }));
  });
  // Distinct source folders feeding the open song, for whole-folder reassignment.
  const editingFolders = $derived.by(() => {
    const m = new Map<string, string>();
    for (const f of editingFiles) if (f.folder && !m.has(f.folder)) m.set(f.folder, f.folder);
    // folderId lives on the asset; re-derive (name -> id) from the raw parts/assets.
    const byName = new Map<string, string>();
    if (editing) {
      for (const a of [...editing.parts, ...editing.scores, ...editing.notes, ...editing.audio, ...editing.musescore, ...editing.images, ...editing.files]) {
        if (a.folder && a.folderId && !byName.has(a.folder)) byName.set(a.folder, a.folderId);
      }
    }
    return [...m.keys()].filter((name) => byName.has(name)).map((name) => ({ folderId: byName.get(name)!, folder: name }));
  });

  async function correctPost(fields: Record<string, string>): Promise<boolean> {
    const res = await fetch('/library-status?/correct', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-sveltekit-action': 'true' },
      body: new URLSearchParams(fields),
    });
    return res.ok;
  }
  async function refreshEditor() {
    const slug = editing?.slug;
    await invalidateAll();
    editing = tunes.find((t) => t.slug === slug) ?? null; // stays open (or closes if emptied)
  }
  // Reassign a file ('file') or whole folder ('folder') to an existing song.
  async function assignTo(scope: 'file' | 'folder', targetId: string, songSlug: string) {
    await correctPost({ scope, targetId, field: 'songSlug', value: songSlug });
    await refreshEditor();
  }
  // Create a brand-new song (name + slug) and move the file/folder into it.
  async function assignToNew(scope: 'file' | 'folder', targetId: string) {
    const name = window.prompt('New song name:')?.trim();
    if (!name) return;
    const slug = slugify(name);
    if (!slug) return;
    await correctPost({ scope: 'song', targetId: slug, field: 'displayName', value: name });
    await correctPost({ scope, targetId, field: 'songSlug', value: slug });
    await refreshEditor();
  }
  function onMove(scope: 'file' | 'folder', targetId: string, e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    const v = sel.value;
    sel.selectedIndex = 0; // reset the picker
    if (v === '__new__') assignToNew(scope, targetId);
    else if (v) assignTo(scope, targetId, v);
  }

  // Refresh the catalog after a correction (the overlay revision busts the cache),
  // and re-point the open editor at the (possibly renamed) song so it stays live.
  const afterCorrect =
    (prevSlug: string) =>
    () =>
    async ({ result, update }: { result: { type: string }; update: (opts?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      await invalidateAll();
      if (result.type === 'success' && editing) {
        editing = tunes.find((t) => t.slug === prevSlug || t.title === editing?.title) ?? editing;
      }
    };

  interface SyncLine {
    t: number;
    level: 'info' | 'warn' | 'error';
    msg: string;
  }

  let syncing = $state(false);
  let syncLines = $state<SyncLine[]>([]);
  let syncSummary = $state<Record<string, number> | null>(null);
  let syncError = $state<string | null>(null);
  let es: EventSource | null = null;

  function closeEs() {
    if (es) {
      es.close();
      es = null;
    }
  }

  // Start (no-op server-side if already running) then watch the progress stream.
  async function runSync() {
    syncLines = [];
    syncSummary = null;
    syncError = null;
    syncing = true;
    try {
      await fetch('/admin/sync', { method: 'POST' });
    } catch {
      /* the stream below still reports status */
    }
    watch();
  }

  function watch() {
    closeEs();
    es = new EventSource('/admin/sync');
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'state') {
        syncing = ev.state.running;
        syncLines = ev.state.lines ?? [];
        syncSummary = ev.state.summary ?? null;
        syncError = ev.state.error ?? null;
        if (!ev.state.running && (ev.state.summary || ev.state.error)) closeEs();
      } else if (ev.type === 'line') {
        syncLines = [...syncLines, ev.line];
      } else if (ev.type === 'start') {
        syncing = true;
      } else if (ev.type === 'done') {
        syncSummary = ev.summary;
      } else if (ev.type === 'error') {
        syncError = ev.error;
      } else if (ev.type === 'end') {
        syncing = false;
        closeEs();
        invalidateAll(); // refresh the catalog/matrix with freshly synced data
      }
    };
    es.onerror = () => {
      // Stream closed (normally after 'end', or a transient drop). Stop here;
      // the user can click again to reconnect — the server replays state.
      closeEs();
    };
  }

  function summaryText(s: Record<string, number>): string {
    const parts = [`${s.seen} seen`, `${s.new} new`, `${s.downloaded} downloaded`];
    if (s.unreachable) parts.push(`${s.unreachable} unreachable`);
    if (s.failed) parts.push(`${s.failed} failed`);
    if (s.warnings) parts.push(`${s.warnings} warnings`);
    return `Sync complete — ${parts.join(', ')}.`;
  }

  // --- Admin: recover per-blob provenance sidecars (data/cas/origins) -------
  interface OriginsResult {
    blobs: number;
    written: number;
    recovered: number;
    orphans: number;
    upgraded: number;
    skipped: number;
  }

  let recovering = $state(false);
  let originsResult = $state<OriginsResult | null>(null);
  let originsError = $state<string | null>(null);

  async function recoverOrigins() {
    recovering = true;
    originsResult = null;
    originsError = null;
    try {
      const res = await fetch('/admin/origins', { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      originsResult = (await res.json()) as OriginsResult;
    } catch (e) {
      originsError = e instanceof Error ? e.message : String(e);
    } finally {
      recovering = false;
    }
  }

  function originsText(r: OriginsResult): string {
    return (
      `Origins recovered — ${r.written} sidecar(s) written ` +
      `(${r.recovered} from manifest, ${r.upgraded} upgraded from unknown, ` +
      `${r.orphans} orphan(s) with no recoverable origin), ` +
      `${r.skipped} already recorded · ${r.blobs} blobs total.`
    );
  }

  onDestroy(closeEs);

  // Clicking a square: a lone file opens (full screen for a reachable file, or
  // the Drive "request access" page for an unreachable one); several open a popup
  // of links. Escape (or the ×) closes the popup.
  let popup = $state<{ title: string; items: CellItem[] } | null>(null);
  // The "?" help popup explaining how to read the coverage matrix.
  let help = $state(false);

  function openCell(cell: Cell | null, colLabel: string, songTitle: string) {
    if (!cell) return;
    if (cell.count === 1) {
      const href = cell.items[0].href;
      if (href && href !== '#') window.open(href, '_blank', 'noopener');
      return;
    }
    popup = { title: `${songTitle} — ${colLabel}`, items: cell.items };
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (help) help = false;
    else if (popup) popup = null;
    else if (editing) editing = null;
  }
</script>

<svelte:window onkeydown={onKey} />

<section class="status">
  <header>
    <p class="kicker">Library Info</p>
    <nav class="tabs">
      <a class="active" aria-current="page" href="/library-status">Coverage</a>
      <a href="/library-status/files">Files</a>
      <a href="/library-status/generated-scores">Generated</a>
    </nav>
    <h2>
      Coverage by song &amp; instrument
      <button class="help-btn" onclick={() => (help = true)} aria-label="How to read this view" title="How to read this view">?</button>
    </h2>
    <p class="count">{tunes.length} songs · {instruments.length} instruments</p>

    <p class="back"><a href="/corrections">View recent metadata edits →</a></p>

    <ul class="legend">
      {#each legend as l (l.key)}
        <li>
          <span class="swatch" style:background={l.color}></span>
          {#if l.url}
            <a href={l.url} target="_blank" rel="noopener">{l.name}</a>
          {:else}
            {l.name}
          {/if}
        </li>
      {/each}
    </ul>

    {#if isAdmin}
      <div class="sync">
        <div class="sync-head">
          <button class="sync-btn" onclick={runSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync from Drive'}
          </button>
          {#if syncing}<span class="spinner" aria-hidden="true"></span>{/if}
          {#if !syncing && syncSummary}<span class="ok">✓ done</span>{/if}
          {#if !syncing && syncError}<span class="bad">✗ failed</span>{/if}

          <button
            class="sync-btn ghost"
            onclick={recoverOrigins}
            disabled={recovering || syncing}
            title="Write a provenance sidecar (data/cas/origins/<sha>.json) for every stored blob that lacks one"
          >
            {recovering ? 'Recovering…' : 'Recover Origins'}
          </button>
          {#if recovering}<span class="spinner" aria-hidden="true"></span>{/if}
          {#if !recovering && originsResult}<span class="ok">✓ done</span>{/if}
          {#if !recovering && originsError}<span class="bad">✗ failed</span>{/if}
        </div>

        {#if originsResult}<p class="sync-result">{originsText(originsResult)}</p>{/if}
        {#if originsError}<p class="sync-result bad-text">Recover Origins failed: {originsError}</p>{/if}

        {#if syncing && syncLines.length}
          <div class="sync-log" aria-live="polite">
            {#each syncLines.slice(-12) as l (l.t + l.msg)}
              <div class="ln {l.level}">{l.msg}</div>
            {/each}
          </div>
        {/if}

        {#if syncSummary}<p class="sync-result">{summaryText(syncSummary)}</p>{/if}
        {#if syncError}<p class="sync-result bad-text">Sync failed: {syncError}</p>{/if}
      </div>
    {/if}
  </header>

  <div class="scroller">
    <table>
      <thead>
        <tr>
          <th class="corner" scope="col">Song</th>
          {#each columns as col (col.key)}
            <th class="col-head" class:special={col.key === 'musescore' || col.key === 'audio' || col.key === 'score'} scope="col">
              <span>{col.label}</span>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each groups as g (g.status)}
          <tr class="group-head">
            <th class="group-label" colspan={columns.length + 1} scope="colgroup">
              <span title={STATUS_DESC[g.status]}>{g.status}</span>
              <span class="group-count">{g.rows.length}</span>
            </th>
          </tr>
          {#each g.rows as r (r.slug)}
            <tr>
              <th class="row-head" scope="row">
                <span class="row-title">{r.title}</span>
                {#if canEdit}
                  <button class="edit-link" onclick={() => openEditor(r.slug)} title="Correct metadata for this song">✎ edit</button>
                {/if}
                {#if isAdmin}
                  <form method="POST" action="?/setStatus" use:enhance>
                    <input type="hidden" name="slug" value={r.slug} />
                    <select
                      class="status-select"
                      name="status"
                      value={r.status}
                      aria-label={`Status for ${r.title}`}
                      onchange={(e) => e.currentTarget.form?.requestSubmit()}
                    >
                      {#each ALL_STATUSES as s (s)}
                        <option value={s}>{s}</option>
                      {/each}
                    </select>
                  </form>
                {/if}
              </th>
              {#each r.cells as c, i (i)}
                <td>
                  {#if c}
                    <button
                      class="sq"
                      class:split={!!c.color2}
                      style:background={c.color2
                        ? `linear-gradient(135deg, ${c.color} 0 50%, ${c.color2} 50% 100%)`
                        : c.color}
                      style:color={c.text}
                      title={c.color2
                        ? `${c.count} × ${c.name} + ${c.name2}${c.dot ? ' — includes an unreachable copy' : ''} — click to open`
                        : c.dot
                          ? `${c.count} × ${c.name} — includes an unreachable copy — click to open`
                          : `${c.count} × ${c.name} — click to open`}
                      onclick={() => openCell(c, columns[i].label, r.title)}
                    >
                      {c.count}
                      {#if c.dot}<span class="dot" aria-hidden="true"></span>{/if}
                    </button>
                  {/if}
                </td>
              {/each}
            </tr>
            {#if r.hasMasked}
              <tr class="masked-row">
                <th class="row-head masked-head" scope="row">
                  <span class="masked-label" title="Manually-created scores hidden by a generated version — click a square to open and compare">↳ masked originals</span>
                </th>
                {#each r.maskedCells as c, i (i)}
                  <td>
                    {#if c}
                      <button
                        class="sq"
                        class:split={!!c.color2}
                        style:background={c.color2
                          ? `linear-gradient(135deg, ${c.color} 0 50%, ${c.color2} 50% 100%)`
                          : c.color}
                        style:color={c.text}
                        title={c.color2
                          ? `Masked original — ${c.count} × ${c.name} + ${c.name2} — click to open`
                          : `Masked original — ${c.count} × ${c.name} — click to open`}
                        onclick={() => openCell(c, `Masked — ${columns[i].label}`, r.title)}
                      >
                        {c.count}
                        {#if c.dot}<span class="dot" aria-hidden="true"></span>{/if}
                      </button>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/if}
          {/each}
        {/each}
        {#if rows.length === 0}
          <tr><td class="empty" colspan={columns.length + 1}>No songs in the library yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</section>

{#if help}
  <div class="modal-backdrop">
    <div class="modal help" role="dialog" aria-modal="true" aria-label="How to read the coverage view">
      <header class="modal-head">
        <h3>How to read this view</h3>
        <button class="x" onclick={() => (help = false)} aria-label="Close">×</button>
      </header>
      <div class="help-body">
        <p>
          Each square marks where a score (or recording) exists and the color shows
          its primary source. The number counts every copy in the library — all parts
          and both Letter/Lyre formats.
        </p>
        <p>
          A square <strong>split</strong> on the diagonal means copies live in two
          source folders — the upper-left is the higher-priority one.
          <strong>Red</strong> flags a part that's only a shortcut the sync can't read
          (a permissions gap to fix in Drive).
        </p>
        <p>
          The <strong>Misc Files</strong> column gathers everything else in a song's
          folder — notes (Google Docs), images, and other documents.
        </p>
        <p>
          Click a square to open it (a single file opens full screen; several open a
          list). Blank means nothing is on file.
        </p>
        <p>
          When a song has app-generated scores, the manually-created originals they
          replace are hidden from the score pages but still listed on a
          <strong>“masked originals” sub-row</strong> here (squares keep their source
          color), so you can open and compare them.
        </p>
      </div>
      <p class="modal-hint">Press Esc to close</p>
    </div>
  </div>
{/if}

{#if popup}
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-label={popup.title}>
      <header class="modal-head">
        <h3>{popup.title}</h3>
        <button class="x" onclick={() => (popup = null)} aria-label="Close">×</button>
      </header>
      <ul class="modal-list">
        {#each popup.items as it, i (i)}
          <li>
            <a
              href={it.href}
              target="_blank"
              rel="noopener"
              class:unreachable={it.unreachable}
              style:color={it.color}
              onclick={() => (popup = null)}
            >
              <span class="swatch" style:background={it.chip} title={it.chipName}></span>
              <span class="fname">{it.label}</span>
            </a>
          </li>
        {/each}
      </ul>
      <p class="modal-hint">Press Esc to close</p>
    </div>
  </div>
{/if}

{#if editing}
  <div class="modal-backdrop">
    <div class="modal editor" role="dialog" aria-modal="true" aria-label={`Edit ${editing.title}`}>
      <header class="modal-head">
        <h3>Edit metadata — {editing.title}</h3>
        <button class="x" onclick={() => (editing = null)} aria-label="Close">×</button>
      </header>

      <p class="editor-note">
        Edits are live immediately for everyone. Manage or revert them on the
        <a href="/corrections">Recent edits</a> page.
      </p>

      <section class="editor-block">
        <h4>Song</h4>
        <form class="field-row" method="POST" action="?/correct" use:enhance={afterCorrect(editing.slug)}>
          <input type="hidden" name="scope" value="song" />
          <input type="hidden" name="targetId" value={editing.slug} />
          <input type="hidden" name="field" value="displayName" />
          <label>Display name<input name="value" value={editing.title} /></label>
          <button type="submit">Save</button>
        </form>
        {#if canEditSlug}
          <form class="field-row" method="POST" action="?/correct" use:enhance={afterCorrect(editing.slug)}>
            <input type="hidden" name="scope" value="song" />
            <input type="hidden" name="targetId" value={editing.slug} />
            <input type="hidden" name="field" value="displaySlug" />
            <label
              >Display slug (filenames)<input name="value" value={editing.displaySlug ?? editing.slug} /></label
            >
            <button type="submit">Save</button>
          </form>
          <p class="muted">The song's stable id is <code>{editing.slug}</code> — used by gigs &amp; status, never changed.</p>
        {/if}
      </section>

      <section class="editor-block">
        <h4>Parts</h4>
        {#if editing.parts.length === 0}
          <p class="muted">No instrument parts in this song.</p>
        {:else}
          <ul class="part-list">
            {#each editing.parts as p (p.driveFileId ?? p.sha256)}
              <li>
                <span class="pname" title={p.originalName ?? ''}>{p.originalName ? stripCopyOf(p.originalName) : p.instrument}</span>
                {#if p.driveFileId}
                  <div class="part-fields">
                    <form method="POST" action="?/correct" use:enhance={afterCorrect(editing.slug)}>
                      <input type="hidden" name="scope" value="file" />
                      <input type="hidden" name="targetId" value={p.driveFileId} />
                      <input type="hidden" name="field" value="instrumentSlug" />
                      <select name="value" aria-label="Instrument" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
                        {#each INSTRUMENT_CHOICES as inst (inst.slug)}
                          <option value={inst.slug} selected={inst.slug === p.instrumentSlug}>{instrumentDisplay(inst.label, inst.key)}</option>
                        {/each}
                      </select>
                    </form>
                    <form method="POST" action="?/correct" use:enhance={afterCorrect(editing.slug)}>
                      <input type="hidden" name="scope" value="file" />
                      <input type="hidden" name="targetId" value={p.driveFileId} />
                      <input type="hidden" name="field" value="key" />
                      <select name="value" aria-label="Key" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
                        {#each KEY_CHOICES as k (k.slug)}
                          <option value={k.slug} selected={k.slug === (p.key ?? '')}>{k.label}</option>
                        {/each}
                      </select>
                    </form>
                    <form method="POST" action="?/correct" use:enhance={afterCorrect(editing.slug)}>
                      <input type="hidden" name="scope" value="file" />
                      <input type="hidden" name="targetId" value={p.driveFileId} />
                      <input type="hidden" name="field" value="partNumber" />
                      <input
                        class="part-num"
                        name="value"
                        type="number"
                        min="1"
                        placeholder="#"
                        value={p.partNumber ?? ''}
                        aria-label="Part number"
                        onchange={(e) => e.currentTarget.form?.requestSubmit()}
                      />
                    </form>
                  </div>
                {:else}
                  <span class="muted">no id — re-sync to enable editing</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if canEditSlug}
        <section class="editor-block">
          <h4>Reassign to another song</h4>
          <p class="muted">Fix a wrong grouping, or pull a stray file into the right song. Pick a song or create a new one.</p>

          {#if editingFolders.length > 0}
            <p class="reassign-label">Whole folder</p>
            {#each editingFolders as fol (fol.folderId)}
              <div class="reassign-row">
                <span class="rname" title={fol.folder}>📁 {fol.folder}</span>
                <select aria-label={`Move folder ${fol.folder}`} onchange={(e) => onMove('folder', fol.folderId, e)}>
                  <option value="">Move to…</option>
                  {#each songOptions as s (s.slug)}
                    {#if s.slug !== editing.slug}<option value={s.slug}>{s.title}</option>{/if}
                  {/each}
                  <option value="__new__">＋ New song…</option>
                </select>
              </div>
            {/each}
          {/if}

          <p class="reassign-label">Individual file</p>
          {#each editingFiles as f (f.driveFileId)}
            <div class="reassign-row">
              <span class="rname" title={f.name}>{f.name}</span>
              <select aria-label={`Move file ${f.name}`} onchange={(e) => onMove('file', f.driveFileId, e)}>
                <option value="">Move to…</option>
                {#each songOptions as s (s.slug)}
                  {#if s.slug !== editing.slug}<option value={s.slug}>{s.title}</option>{/if}
                {/each}
                <option value="__new__">＋ New song…</option>
              </select>
            </div>
          {/each}
        </section>
      {/if}

      <p class="modal-hint">Press Esc to close</p>
    </div>
  </div>
{/if}

<style>
  .status {
    --cell: 34px;
    --song-col: 220px;
    max-width: 100%;
    margin: 0 auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  .body {
    color: var(--muted);
    max-width: 80ch;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
  }

  /* "?" help trigger sitting next to the heading. */
  .help-btn {
    vertical-align: middle;
    margin-left: 10px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--accent-strong);
    background: var(--paper);
    color: var(--accent-strong);
    font-size: 0.9rem;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
  }
  .help-btn:hover {
    background: var(--accent);
    color: #fffdf7;
  }

  .help-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--ink);
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .help-body strong {
    font-weight: 700;
  }

  .tabs {
    display: flex;
    gap: 6px;
    margin: 6px 0;
  }
  .tabs a {
    padding: 5px 14px;
    border: 1px solid var(--line);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-decoration: none;
    background: var(--paper);
  }
  .tabs a.active {
    color: var(--ink);
    background: var(--panel);
    border-color: var(--accent-strong);
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    color: var(--ink);
  }

  .legend a {
    color: var(--accent-strong);
    text-decoration: underline;
  }

  /* Admin sync control */
  .sync {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
  }

  .sync-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .sync-btn {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
  }

  .sync-btn:disabled {
    opacity: 0.7;
    cursor: progress;
  }

  /* Secondary action (Recover Origins): same shape, muted/outline look. */
  .sync-btn.ghost {
    background: var(--paper);
    color: var(--accent-strong);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--line);
    border-top-color: var(--accent-strong);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .ok {
    color: #2e9e4f;
    font-weight: 700;
    font-size: 0.82rem;
  }

  .bad {
    color: #d8413a;
    font-weight: 700;
    font-size: 0.82rem;
  }

  .sync-log {
    max-height: 180px;
    overflow: auto;
    background: #1c1c1c;
    color: #e6e3da;
    border-radius: 6px;
    padding: 8px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    line-height: 1.5;
  }

  .ln {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .ln.warn {
    color: #f2d36b;
  }

  .ln.error {
    color: #ff8d85;
  }

  .sync-result {
    font-size: 0.82rem;
    color: var(--ink);
  }

  .bad-text {
    color: #8a1f1a;
  }

  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid rgba(0, 0, 0, 0.18);
  }

  .scroller {
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
    /* Bound the height so the sticky header/column have something to scroll
       against on long libraries. */
    max-height: calc(100vh - 120px);
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
  }

  th,
  td {
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  /* Square intersections: every value column is one cell wide and every row one
     cell tall. */
  .col-head,
  td {
    width: var(--cell);
    min-width: var(--cell);
    max-width: var(--cell);
  }

  td {
    height: var(--cell);
    padding: 0;
    text-align: center;
    vertical-align: middle;
  }

  /* Rotated column headers read bottom-to-top to keep columns narrow. */
  .col-head {
    vertical-align: bottom;
    padding: 6px 0;
    background: var(--panel);
  }

  .col-head span {
    display: inline-block;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    white-space: nowrap;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--ink);
  }

  .col-head.special span {
    color: var(--accent-strong);
  }

  /* Sticky song name column + sticky header row, with a sticky corner. */
  .row-head,
  .corner {
    width: var(--song-col);
    min-width: var(--song-col);
    max-width: var(--song-col);
    position: sticky;
    left: 0;
    background: var(--panel);
    text-align: left;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0 10px;
    z-index: 1;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  .corner {
    z-index: 3;
    vertical-align: bottom;
    padding-bottom: 8px;
  }

  .row-head {
    color: var(--ink);
    word-break: break-word;
  }

  .row-title {
    display: block;
  }

  /* The masked-originals sub-row sits directly under its song row: shorter, a
     faint neutral wash, and a quieter indented label so it reads as secondary.
     The squares themselves keep their normal source colors. */
  .masked-row td {
    height: 26px;
    background: rgba(0, 0, 0, 0.03);
  }
  .masked-row .row-head.masked-head {
    background: var(--panel);
    padding-top: 0;
    padding-bottom: 4px;
  }
  .masked-label {
    display: block;
    padding-left: 12px;
    font-size: 0.7rem;
    font-weight: 600;
    font-style: italic;
    color: var(--muted);
  }

  .row-head form {
    margin: 4px 0 0;
  }

  .status-select {
    width: 100%;
    font-size: 0.7rem;
    padding: 2px 4px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--paper);
    color: var(--ink);
  }

  /* Status section header rows. */
  .group-head .group-label {
    position: sticky;
    left: 0;
    background: var(--paper);
    text-align: left;
    padding: 10px;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink);
    border-top: 2px solid var(--line);
    z-index: 1;
  }

  .group-count {
    margin-left: 8px;
    font-weight: 600;
    color: #6b6862;
    text-transform: none;
    letter-spacing: 0;
  }

  tbody tr:nth-child(even) .row-head {
    background: var(--paper);
  }

  tbody tr:nth-child(even) td {
    background: rgba(0, 0, 0, 0.02);
  }

  .sq {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
    transition: transform 0.06s ease, box-shadow 0.06s ease;
  }

  /* Two-folder squares are split on the anti-diagonal; the centered digit sits on
     the seam, so a thin contrasting halo keeps it legible over either color. */
  .sq.split {
    text-shadow:
      0 0 2px rgba(0, 0, 0, 0.55),
      0 0 2px rgba(0, 0, 0, 0.55);
  }

  /* Corner marker: this otherwise-OK square hides an unreachable copy. */
  .dot {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d8413a;
    border: 1px solid #fffdf7;
  }

  .sq:hover {
    transform: scale(1.18);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25);
  }

  .sq:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }

  .empty {
    padding: 16px;
    color: var(--muted);
    text-align: center;
  }

  /* Popup for cells with several files. */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal {
    background: var(--panel);
    color: var(--ink);
    border-radius: 8px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
    width: min(440px, 100%);
    max-height: 80vh;
    overflow: auto;
    padding: 18px 20px;
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .modal-head h3 {
    font-size: 1.05rem;
  }

  .x {
    border: 0;
    background: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: var(--muted);
    padding: 0 4px;
  }

  .modal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .modal-list a {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    text-decoration: none;
    background: #f7f5ef;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .modal-list .swatch {
    flex: none;
  }

  .modal-list .fname {
    word-break: break-word;
  }

  .modal-list a.unreachable {
    border-color: #d8413a;
    background: #fdf1f0;
  }

  .modal-hint {
    margin-top: 12px;
    color: var(--muted);
    font-size: 0.78rem;
    text-align: right;
  }

  .back a {
    color: var(--accent-strong);
    text-decoration: underline;
    font-size: 0.82rem;
  }

  .edit-link {
    margin-left: 8px;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font-size: 0.72rem;
    cursor: pointer;
    text-decoration: underline;
  }

  /* Per-song correction editor */
  .modal.editor {
    width: min(560px, 100%);
  }

  .editor-note {
    font-size: 0.8rem;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .editor-note a {
    color: var(--accent-strong);
    text-decoration: underline;
  }

  .editor-block {
    margin-bottom: 16px;
  }
  .editor-block h4 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 8px;
  }

  .field-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 8px;
  }
  .field-row label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 0.74rem;
    color: var(--muted);
    flex: 1;
  }
  .field-row input {
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.85rem;
  }
  .field-row button,
  .editor-block button[type='submit'] {
    min-height: 34px;
    padding: 0 12px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    border-radius: 5px;
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .part-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .part-list li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .pname {
    font-size: 0.78rem;
    font-weight: 600;
    word-break: break-word;
  }
  .part-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .part-fields select,
  .part-fields .part-num {
    padding: 4px 6px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.78rem;
  }
  .part-fields .part-num {
    width: 56px;
  }
  .muted {
    color: var(--muted);
    font-size: 0.76rem;
  }
  .reassign-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 10px 0 4px;
  }
  .reassign-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 5px;
  }
  .reassign-row .rname {
    flex: 1;
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reassign-row select {
    padding: 4px 6px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.76rem;
    max-width: 45%;
  }
</style>
