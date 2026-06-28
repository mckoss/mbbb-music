<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog, Tune } from '$lib/types';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import { stripCopyOf } from '$lib/format';
  import HelpPopup from '$lib/components/HelpPopup.svelte';
  import { viewHref } from '$lib/view';

  // Build-pipeline view: which MuseScore (.mscz) masters in the library have been
  // turned into app-generated parts/scores/audio (by `bin/build-scores.js`) and
  // which haven't. This reflects the synced Drive catalog — anything that only
  // exists on a local disk and was never synced won't appear here.
  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);

  // Friendly open URL (no raw sha leak), falling back to the blob for any sha not
  // in the player index (the .mscz master usually isn't).
  const assetIndex = $derived(assetIndexFor(catalog));
  const openUrl = (sha: string) => urlForSha(assetIndex, sha) ?? `/blob/${sha}`;

  interface GenRow {
    slug: string;
    title: string;
    master: { name: string; href: string } | null; // the .mscz master, if on file
    partFmts: string[]; // print format of each generated core-roster part
    extraFmts: string[]; // print format of each generated off-roster ("extra") part
    audio: number; // app-generated audio (band mix + any stems)
  }

  // Generated charts come in Letter + Lyre, so a raw file count doubles the number
  // of distinct charts. Summarize as "charts × formats" when every format has the
  // same number of files (a clean grid); otherwise fall back to the raw total.
  interface Counts {
    charts: number;
    formats: number;
    total: number;
    even: boolean;
  }
  function tally(fmts: string[]): Counts {
    const by = new Map<string, number>();
    for (const f of fmts) by.set(f, (by.get(f) ?? 0) + 1);
    const counts = [...by.values()];
    const total = fmts.length;
    const formats = by.size;
    const even = formats > 1 && counts.every((c) => c === counts[0]);
    return { charts: even ? counts[0] : total, formats, total, even };
  }
  const show = (c: Counts) => (c.even ? `${c.charts} × ${c.formats}` : `${c.total}`);

  // The instrument-less `scores` bucket carries no `format` field, so read the
  // Letter/Lyre token straight off the generated filename instead.
  const deriveFormat = (name: string | null): string =>
    name && /(^|[^a-z])lyre([^a-z]|$)/i.test(name) ? 'lyre' : 'letter';

  const genRows = $derived.by<GenRow[]>(() =>
    tunes.map((t: Tune) => {
      const m = t.musescore[0];
      return {
        slug: t.slug,
        title: t.title,
        master: m
          ? {
              name: m.originalName ? stripCopyOf(m.originalName) : 'MuseScore file',
              // .mscz can't be previewed → the viewer shows a download card (with a
              // back button) rather than dead-ending in a new tab.
              href: m.sha256
                ? viewHref({
                    sha: m.sha256,
                    kind: 'download',
                    title: `${t.title} — MuseScore`,
                    from: page.url.pathname,
                    url: openUrl(m.sha256),
                  })
                : '#',
            }
          : null,
        partFmts: t.parts.filter((p) => p.generated).map((p) => p.format),
        // The catalog's instrument-less `scores` bucket; for generated output these
        // are parts for instruments off the core roster (e.g. accordion), not
        // whole-band conductor scores.
        extraFmts: t.scores.filter((s) => s.generated).map((s) => deriveFormat(s.originalName)),
        audio: t.audio.filter((a) => a.generated || a.museScore).length,
      };
    })
  );

  const hasGen = (r: GenRow) => r.partFmts.length > 0 || r.extraFmts.length > 0 || r.audio > 0;
  const byTitle = (a: GenRow, b: GenRow) => a.title.localeCompare(b.title);

  // 1. Masters that still need building: a .mscz is on file but no output yet.
  const needsProcessing = $derived(genRows.filter((r) => r.master && !hasGen(r)).sort(byTitle));
  // 2. Processed: any generated output present (master may or may not be on file).
  const processed = $derived(genRows.filter(hasGen).sort(byTitle));
  // 3. Generated output whose .mscz master isn't in the library (master lives
  //    outside the synced folders) — worth flagging since it can't be rebuilt here.
  const orphanGenerated = $derived(processed.filter((r) => !r.master));

  const totals = $derived({
    parts: tally(processed.flatMap((r) => r.partFmts)),
    extra: tally(processed.flatMap((r) => r.extraFmts)),
    audio: processed.reduce((n, r) => n + r.audio, 0),
  });

  // Master count drives the "x of y processed" headline.
  const masters = $derived(genRows.filter((r) => r.master));
  const processedMasters = $derived(masters.filter(hasGen));
</script>

<section class="status">
  <header>
    <p class="kicker">Library Info</p>
    <nav class="tabs">
      <a href="/library-status">Coverage</a>
      <a href="/library-status/files">Files</a>
      <a class="active" aria-current="page" href="/library-status/generated-scores">Generated</a>
    </nav>
    <div class="title-row">
      <h2>Generated parts &amp; audio</h2>
      <HelpPopup title="About generated parts &amp; audio" label="About generated parts &amp; audio">
        <p>
          Tracks which MuseScore (<code>.mscz</code>) masters in the library have been
          built into app-generated parts and audio by <code>build-scores</code>.
        </p>
        <p>
          <strong>Extra parts</strong> are charts for instruments off the core roster
          (e.g. accordion). Part counts read <em>charts × formats</em> — each chart is
          rendered in Letter and Lyre.
        </p>
        <p>
          The top list is your to-do: masters with nothing generated yet. This reflects
          the synced Drive catalog, so masters that only live on a local disk (never
          synced) won't show here.
        </p>
      </HelpPopup>
    </div>
    <p class="count">
      {processedMasters.length} of {masters.length} masters processed ·
      {show(totals.parts)} parts · {show(totals.extra)} extra parts · {totals.audio} audio generated
    </p>
  </header>

  <section class="block">
    <h3>Needs processing <span class="badge">{needsProcessing.length}</span></h3>
    {#if needsProcessing.length === 0}
      <p class="ok-note">Every MuseScore master on file has generated output. 🎉</p>
    {:else}
      <p class="hint">A MuseScore master is on file but nothing has been generated for it yet.</p>
      <ul class="todo">
        {#each needsProcessing as r (r.slug)}
          <li>
            <span class="song">{r.title}</span>
            {#if r.master}
              <a class="mscz" href={r.master.href} title={r.master.name}>
                {r.master.name}
              </a>
            {/if}
            <span class="flag">⏳ not processed</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="block">
    <h3>Processed <span class="badge">{processed.length}</span></h3>
    {#if processed.length === 0}
      <p class="hint">Nothing has been generated yet.</p>
    {:else}
      <div class="scroller">
        <table>
          <thead>
            <tr>
              <th scope="col" class="song-col">Song</th>
              <th scope="col">Master</th>
              <th scope="col" class="num">Parts</th>
              <th scope="col" class="num">Extra Parts</th>
              <th scope="col" class="num">Audio</th>
            </tr>
          </thead>
          <tbody>
            {#each processed as r (r.slug)}
              {@const p = tally(r.partFmts)}
              {@const x = tally(r.extraFmts)}
              <tr>
                <th scope="row" class="song-col">{r.title}</th>
                <td>
                  {#if r.master}
                    <a class="mscz" href={r.master.href} title={r.master.name}>
                      {r.master.name}
                    </a>
                  {:else}
                    <span class="missing" title="No .mscz master in the synced library">— no master —</span>
                  {/if}
                </td>
                <td class="num" class:zero={p.total === 0} title={`${p.total} files`}>{p.total ? show(p) : '·'}</td>
                <td class="num" class:zero={x.total === 0} title={`${x.total} files`}>{x.total ? show(x) : '·'}</td>
                <td class="num" class:zero={r.audio === 0}>{r.audio || '·'}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" class="song-col">Total</th>
              <td></td>
              <td class="num">{show(totals.parts)}</td>
              <td class="num">{show(totals.extra)}</td>
              <td class="num">{totals.audio}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    {/if}
  </section>

  {#if orphanGenerated.length > 0}
    <section class="block">
      <h3>Generated, master not on file <span class="badge">{orphanGenerated.length}</span></h3>
      <p class="hint">
        These have app-generated output but no <code>.mscz</code> master in the synced
        library, so they can't be rebuilt from here — the master lives outside the
        synced folders.
      </p>
      <ul class="todo">
        {#each orphanGenerated as r (r.slug)}
          <li>
            <span class="song">{r.title}</span>
            <span class="counts">{show(tally(r.partFmts))} parts · {show(tally(r.extraFmts))} extra parts · {r.audio} audio</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>

<style>
  .status {
    max-width: 100%;
    margin: 0 auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
    background: var(--paper);
    padding: 0 4px;
    border-radius: 4px;
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

  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .block h3 {
    font-size: 0.92rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge {
    font-weight: 700;
    font-size: 0.78rem;
    color: var(--muted);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 1px 9px;
    letter-spacing: 0;
  }

  .hint {
    color: var(--muted);
    font-size: 0.82rem;
    max-width: 80ch;
  }

  .ok-note {
    color: #2e9e4f;
    font-size: 0.88rem;
    font-weight: 600;
  }

  .todo {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .todo li {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 7px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
  }

  .todo .song {
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--ink);
  }

  .todo .flag {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 700;
    color: #b06a00;
    white-space: nowrap;
  }

  .todo .counts {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .mscz {
    font-size: 0.78rem;
    color: var(--accent-strong);
    text-decoration: underline;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 22rem;
  }

  .missing {
    font-size: 0.78rem;
    color: var(--muted);
    font-style: italic;
  }

  .scroller {
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
    max-height: calc(100vh - 220px);
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
  }

  th,
  td {
    border-bottom: 1px solid var(--line);
    padding: 7px 12px;
    text-align: left;
    font-size: 0.84rem;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--panel);
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
  }

  .song-col {
    font-weight: 600;
    color: var(--ink);
    min-width: 14rem;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 5rem;
  }

  td.zero {
    color: var(--muted);
  }

  tbody tr:nth-child(even) td,
  tbody tr:nth-child(even) th {
    background: rgba(0, 0, 0, 0.02);
  }

  tfoot th,
  tfoot td {
    font-weight: 800;
    border-top: 2px solid var(--line);
    border-bottom: none;
    background: var(--paper);
  }
</style>
