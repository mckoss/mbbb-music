<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog, Tune } from '$lib/types';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import { stripCopyOf } from '$lib/format';

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
    parts: number; // app-generated instrument parts
    scores: number; // app-generated whole-band scores
    audio: number; // app-generated audio (band mix + any stems)
  }

  const genRows = $derived.by<GenRow[]>(() =>
    tunes.map((t: Tune) => {
      const m = t.musescore[0];
      return {
        slug: t.slug,
        title: t.title,
        master: m
          ? {
              name: m.originalName ? stripCopyOf(m.originalName) : 'MuseScore file',
              href: m.sha256 ? openUrl(m.sha256) : '#',
            }
          : null,
        parts: t.parts.filter((p) => p.generated).length,
        scores: t.scores.filter((s) => s.generated).length,
        audio: t.audio.filter((a) => a.generated || a.museScore).length,
      };
    })
  );

  const hasGen = (r: GenRow) => r.parts > 0 || r.scores > 0 || r.audio > 0;
  const byTitle = (a: GenRow, b: GenRow) => a.title.localeCompare(b.title);

  // 1. Masters that still need building: a .mscz is on file but no output yet.
  const needsProcessing = $derived(genRows.filter((r) => r.master && !hasGen(r)).sort(byTitle));
  // 2. Processed: any generated output present (master may or may not be on file).
  const processed = $derived(genRows.filter(hasGen).sort(byTitle));
  // 3. Generated output whose .mscz master isn't in the library (master lives
  //    outside the synced folders) — worth flagging since it can't be rebuilt here.
  const orphanGenerated = $derived(processed.filter((r) => !r.master));

  const totals = $derived.by(() => {
    let parts = 0,
      scores = 0,
      audio = 0;
    for (const r of processed) {
      parts += r.parts;
      scores += r.scores;
      audio += r.audio;
    }
    return { parts, scores, audio };
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
    <h2>Generated scores &amp; audio</h2>
    <p class="body">
      Tracks which MuseScore (<code>.mscz</code>) masters in the library have been
      built into app-generated parts, whole-band scores, and audio by
      <code>build-scores</code>. The top list is your to-do: masters with nothing
      generated yet. This reflects the synced Drive catalog, so masters that only
      live on a local disk (never synced) won't show here.
    </p>
    <p class="count">
      {processedMasters.length} of {masters.length} masters processed ·
      {totals.parts} parts · {totals.scores} scores · {totals.audio} audio generated
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
              <a class="mscz" href={r.master.href} target="_blank" rel="noopener" title={r.master.name}>
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
              <th scope="col" class="num">Scores</th>
              <th scope="col" class="num">Audio</th>
            </tr>
          </thead>
          <tbody>
            {#each processed as r (r.slug)}
              <tr>
                <th scope="row" class="song-col">{r.title}</th>
                <td>
                  {#if r.master}
                    <a class="mscz" href={r.master.href} target="_blank" rel="noopener" title={r.master.name}>
                      {r.master.name}
                    </a>
                  {:else}
                    <span class="missing" title="No .mscz master in the synced library">— no master —</span>
                  {/if}
                </td>
                <td class="num" class:zero={r.parts === 0}>{r.parts || '·'}</td>
                <td class="num" class:zero={r.scores === 0}>{r.scores || '·'}</td>
                <td class="num" class:zero={r.audio === 0}>{r.audio || '·'}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" class="song-col">Total</th>
              <td></td>
              <td class="num">{totals.parts}</td>
              <td class="num">{totals.scores}</td>
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
            <span class="counts">{r.parts} parts · {r.scores} scores · {r.audio} audio</span>
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

  .body {
    color: var(--muted);
    max-width: 80ch;
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
