<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog, Tune } from '$lib/types';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import { stripCopyOf, fmtDate } from '$lib/format';
  import { sourceStyle } from '$lib/sources';
  import HelpPopup from '$lib/components/HelpPopup.svelte';
  import { viewHref } from '$lib/view';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { writeFetch } from '$lib/client-version';

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
    master: { name: string; href: string; source: string | null } | null; // the .mscz master, if on file
    masterDate: string | null; // when the .mscz master was last modified (source)
    genDate: string | null; // when the parts were generated (most recent output mtime)
    stale: boolean; // master is newer than the generated output → needs a rebuild
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

  // The most recent last-modified time across a tune's generated output. They're
  // all built in one pass so the dates cluster; the newest is a safe representative
  // of "when this was generated". null when nothing carries a date.
  const newestGenDate = (t: Tune): string | null => {
    const dates = [
      ...t.parts.filter((p) => p.generated),
      ...t.scores.filter((s) => s.generated),
      ...t.audio.filter((a) => a.generated || a.museScore),
    ]
      .map((a) => a.modifiedTime)
      .filter((d): d is string => !!d);
    return dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null;
  };

  const genRows = $derived.by<GenRow[]>(() =>
    tunes.map((t: Tune) => {
      const m = t.musescore[0];
      const masterDate = m?.modifiedTime ?? null;
      const genDate = newestGenDate(t);
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
              // The Drive source this master came from — shown (with the Coverage
              // color key) beneath the filename so its location is clear.
              source: m.source ?? null,
            }
          : null,
        masterDate,
        genDate,
        // Compare the displayed (Pacific) calendar dates so the badge only shows
        // when the dates a user can see actually differ.
        stale: !!(masterDate && genDate && fmtDate(masterDate) > fmtDate(genDate)),
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

  // ── LilyPond pipeline (admin-only; PLAN.md decision 9) ──────────────────
  // Admins build each MuseScore master into LilyPond-engraved parts, a full
  // score and band audio. The server enforces the role; non-admins never see
  // this panel or reach /admin/lilypond.
  const isAdmin = $derived(page.data.user?.role === 'admin');

  interface LyCheck {
    reference: string;
    drums: boolean;
    notes: number;
    match: number;
  }
  interface LyOmr {
    part: string;
    bars: number;
    notes: string[];
    skipped?: string;
    failed?: boolean;
  }
  interface LyBuild {
    ai: { model: string; calls: number; cost: number } | null;
    origin: 'mscz' | 'omr';
    omr: LyOmr[] | null;
    builtAt: string;
    builtBy: string | null;
    masterSha256: string;
    outputs: number;
    parts: number;
    passed: boolean;
    warnings: string[];
    checks: LyCheck[] | null;
  }
  interface LyJob {
    slug: string;
    title: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    error: string | null;
    lines: { t: number; msg: string }[];
    finishedAt: number | null;
  }
  let lyBuilds = $state<Record<string, LyBuild>>({});
  let lyJobs = $state<LyJob[]>([]);
  let lyError = $state<string | null>(null);
  let lyAi = $state(false); // server has an Anthropic key: offer the AI correction pass
  let lyLoaded = $state(false); // status fetched (so a missing key is reported, not guessed)
  let lyOpen = $state<string | null>(null); // slug whose report is expanded
  const lyActive = $derived(lyJobs.some((j) => j.status === 'queued' || j.status === 'running'));
  const jobFor = (slug: string) => [...lyJobs].reverse().find((j) => j.slug === slug) ?? null;

  async function lyRefresh() {
    try {
      const res = await fetch('/admin/lilypond');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const wasActive = lyActive;
      lyBuilds = data.builds ?? {};
      lyJobs = data.jobs ?? [];
      lyAi = Boolean(data.aiAvailable);
      lyLoaded = true;
      lyError = null;
      // A build just finished: reload the catalog so new parts/audio appear.
      if (wasActive && !lyJobs.some((j) => j.status === 'queued' || j.status === 'running')) await invalidateAll();
    } catch (err) {
      lyError = `Could not load LilyPond status (${err instanceof Error ? err.message : err})`;
    }
  }

  async function lyPost(body: Record<string, unknown>) {
    lyError = null;
    try {
      const res = await writeFetch('/admin/lilypond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      if (out.skipped?.length) lyError = `No MuseScore master for: ${out.skipped.join(', ')}`;
      await lyRefresh();
      if (body.action === 'revert') await invalidateAll();
    } catch (err) {
      lyError = err instanceof Error ? err.message : String(err);
    }
  }

  onMount(() => {
    if (!isAdmin) return;
    void lyRefresh();
    const timer = setInterval(() => {
      if (lyActive) void lyRefresh();
    }, 2500);
    return () => clearInterval(timer);
  });

  // Master count drives the "x of y processed" headline.
  const masters = $derived(genRows.filter((r) => r.master));
  const processedMasters = $derived(masters.filter(hasGen));

  const masterSha = (slug: string) => tunes.find((t) => t.slug === slug)?.musescore[0]?.sha256 ?? null;
  const lyRows = $derived(
    masters
      .map((r) => ({ ...r, build: lyBuilds[r.slug] ?? null, job: jobFor(r.slug) }))
      .map((r) => ({ ...r, changed: !!(r.build && r.build.masterSha256 !== masterSha(r.slug)) })),
  );
  const lyBuiltCount = $derived(lyRows.filter((r) => r.build).length);

  // PDF-only songs: no MuseScore master, but part PDFs a draft master can be
  // read from (OMR). Drafts sit beside the band's PDFs and replace nothing.
  const pdfRows = $derived(
    tunes
      .filter((t) => !t.musescore.length && t.parts.some((p) => !p.shared && !p.generated))
      .map((t) => ({
        slug: t.slug,
        title: t.title,
        partCount: new Set(t.parts.filter((p) => !p.shared && !p.generated).map((p) => `${p.instrumentSlug}|${(p.partNumbers ?? [p.partNumber]).join('-')}`)).size,
        build: lyBuilds[t.slug] ?? null,
        job: jobFor(t.slug),
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );
  const pct = (m: number) => `${Math.round(m * 100)}%`;

</script>

<!-- Master filename with the Drive source (friendly name + Coverage color key)
     beneath it, so the file's location is clear in both lists. -->
{#snippet masterBlock(master: { name: string; href: string; source: string | null })}
  {@const ss = sourceStyle(master.source)}
  <span class="master">
    <a class="mscz" href={master.href} title={master.name}>{master.name}</a>
    <span class="src" title={`Source: ${ss.name}`}>
      <span class="src-swatch" style:background={ss.color}></span>({ss.name})
    </span>
  </span>
{/snippet}

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
          Each processed row shows when its MuseScore master was last modified and when
          the parts were generated (dates in Pacific time). An <span class="badge update">Update</span>
          tag means the master is newer than the parts — regenerate to pick up the changes.
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

  {#if isAdmin}
    <section class="block ly">
      <div class="ly-head">
        <h3>LilyPond builds <span class="badge">{lyBuiltCount} of {masters.length}</span></h3>
        <button
          type="button"
          class="ly-btn primary"
          disabled={lyActive || masters.length === 0}
          onclick={() => lyPost({ action: 'build-all' })}>Build all with LilyPond</button
        >
      </div>
      <p class="hint">
        Admin only. Converts each MuseScore master to LilyPond, then engraves a full score,
        every part in Letter and Lyre, and full-band audio. Each build is checked note by
        note against the MuseScore master. LilyPond output replaces the MuseScore-built
        parts and audio for that song; <em>Remove</em> brings them back.
      </p>
      {#if lyError}<p class="ly-error" role="alert">{lyError}</p>{/if}
      <div class="scroller">
        <table class="ly-table">
          <thead>
            <tr>
              <th scope="col" class="song-col">Song</th>
              <th scope="col">LilyPond</th>
              <th scope="col">Check</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each lyRows as r (r.slug)}
              {@const busy = r.job && (r.job.status === 'queued' || r.job.status === 'running')}
              <tr>
                <th scope="row" class="song-col"><a class="song-title" href={`/library-status/generated-scores/${r.slug}?from=${encodeURIComponent('/library-status/generated-scores')}`} title="Files and side-by-side compare">{r.title}</a></th>
                <td>
                  {#if busy}
                    <span class="ly-status running">{r.job?.status === 'queued' ? 'Queued' : (r.job?.lines.at(-1)?.msg ?? 'Running')}…</span>
                  {:else if r.job?.status === 'failed'}
                    <span class="ly-status failed" title={r.job.error ?? ''}>Failed: {r.job.error}</span>
                  {:else if r.build}
                    <span class="ly-status">Built {fmtDate(r.build.builtAt)} · {r.build.parts} parts · {r.build.outputs} files</span>
                    {#if r.changed}<span class="badge update" title="The MuseScore master changed since this build">Update</span>{/if}
                  {:else}
                    <span class="muted">Not built</span>
                  {/if}
                </td>
                <td>
                  {#if r.build?.checks}
                    {@const bad = r.build.checks.filter((c) => !c.drums && c.match < 0.95)}
                    <button type="button" class="ly-link" class:fail={bad.length > 0} onclick={() => (lyOpen = lyOpen === r.slug ? null : r.slug)}>
                      {bad.length === 0 ? '✓ matches master' : `✗ ${bad.length} part${bad.length === 1 ? '' : 's'} differ`}
                    </button>
                  {:else if r.build}
                    <span class="muted">no check</span>
                  {/if}
                </td>
                <td class="ly-actions">
                  <button type="button" class="ly-btn" disabled={!!busy} onclick={() => lyPost({ action: 'build', slugs: [r.slug] })}>{r.build ? 'Rebuild' : 'Build'}</button>
                  {#if r.build}
                    <button type="button" class="ly-btn ghost" disabled={!!busy} onclick={() => lyPost({ action: 'revert', slug: r.slug })}>Remove</button>
                  {/if}
                </td>
              </tr>
              {#if lyOpen === r.slug && r.build?.checks}
                <tr class="ly-report">
                  <td colspan="4">
                    <ul>
                      {#each r.build.checks as c, i (i)}
                        <li class:fail={!c.drums && c.match < 0.95}>
                          <span>{c.reference}{c.drums ? ' (drums: timing only)' : ''}</span>
                          <span>{pct(c.match)} of {c.notes} notes</span>
                        </li>
                      {/each}
                    </ul>
                    {#each r.build.warnings as w, i (i)}<p class="ly-error">{w}</p>{/each}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if pdfRows.length}
      <section class="block ly">
        <h3>Draft masters from PDFs <span class="badge">{pdfRows.filter((r) => r.build).length} of {pdfRows.length}</span></h3>
        <p class="hint">
          Admin only. For songs with no MuseScore master: reads each part PDF with OMR, repairs
          bar counts from the printed measure numbers, merges the parts into one master score,
          and renders a full score and band audio. Drum parts are skipped. These are drafts:
          they sit beside the band's PDFs and replace nothing. OMR misreads (an odd bar
          length, a missed line) can make parts drift; the report lists every repair and gap.
        </p>
        <p class="hint">
          <strong>Build with AI</strong> adds a correction pass: Claude Opus 5.5 compares each page
          of every part with what OMR read and fixes the bars (each fix is checked against the
          time signature first). It costs roughly $0.05–0.10 per page; the report shows the cost.
        </p>
        {#if lyLoaded && !lyAi}
          <p class="ly-warn" role="status">
            <strong>Build with AI is off:</strong> the server has no <code>ANTHROPIC_API_KEY</code>.
            To turn it on, open Railway → the <em>mbbb-music</em> service → <em>Variables</em>, add
            <code>ANTHROPIC_API_KEY</code> with an Anthropic API key as its value, then click
            <em>Deploy</em> on the staged-changes banner (a code deploy alone does not apply new
            variables). Reload this page once the deploy finishes.
          </p>
        {/if}
        <div class="scroller">
          <table class="ly-table">
            <thead>
              <tr>
                <th scope="col" class="song-col">Song</th>
                <th scope="col">Draft</th>
                <th scope="col">Report</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {#each pdfRows as r (r.slug)}
                {@const busy = r.job && (r.job.status === 'queued' || r.job.status === 'running')}
                <tr>
                  <th scope="row" class="song-col"><a class="song-title" href={`/library-status/generated-scores/${r.slug}?from=${encodeURIComponent('/library-status/generated-scores')}`} title="Files and side-by-side compare">{r.title}</a> <span class="muted">· {r.partCount} part PDFs</span></th>
                  <td>
                    {#if busy}
                      <span class="ly-status running">{r.job?.status === 'queued' ? 'Queued' : (r.job?.lines.at(-1)?.msg ?? 'Running')}…</span>
                    {:else if r.job?.status === 'failed'}
                      <span class="ly-status failed" title={r.job.error ?? ''}>Failed: {r.job.error}</span>
                    {:else if r.build}
                      <span class="ly-status">Built {fmtDate(r.build.builtAt)} · {r.build.parts} parts read{r.build.ai ? ` · AI-corrected ($${r.build.ai.cost.toFixed(2)})` : ''}</span>
                    {:else}
                      <span class="muted">Not built</span>
                    {/if}
                  </td>
                  <td>
                    {#if r.build?.omr}
                      {@const gaps = r.build.omr.filter((o) => o.failed || o.skipped || o.notes.some((n) => /missed|extra|short|differs|not checked/i.test(n))).length}
                      <button type="button" class="ly-link" class:fail={gaps > 0} onclick={() => (lyOpen = lyOpen === r.slug ? null : r.slug)}>
                        {gaps === 0 ? 'clean read' : `${gaps} part${gaps === 1 ? '' : 's'} with gaps`}
                      </button>
                    {/if}
                  </td>
                  <td class="ly-actions">
                    <button type="button" class="ly-btn" disabled={!!busy} onclick={() => lyPost({ action: 'build', slugs: [r.slug] })}>{r.build ? 'Rebuild draft' : 'Build draft'}</button>
                    <button
                      type="button"
                      class="ly-btn"
                      disabled={!!busy || !lyAi}
                      title={lyAi ? '' : 'Off: the server has no ANTHROPIC_API_KEY (see the note above)'}
                      onclick={() => lyPost({ action: 'build', slugs: [r.slug], ai: true })}>Build with AI</button
                    >
                    {#if r.build}
                      <button type="button" class="ly-btn ghost" disabled={!!busy} onclick={() => lyPost({ action: 'revert', slug: r.slug })}>Remove</button>
                    {/if}
                  </td>
                </tr>
                {#if lyOpen === r.slug && r.build?.omr}
                  <tr class="ly-report">
                    <td colspan="4">
                      <ul class="omr-list">
                        {#each r.build.omr as o, i (i)}
                          <li class:fail={o.failed || !!o.skipped}>
                            <strong>{o.part}</strong>{o.bars ? ` · ${o.bars} bars` : ''}
                            {#each o.notes as n, j (j)}<div class="omr-note">{n}</div>{/each}
                          </li>
                        {/each}
                      </ul>
                      {#each r.build.warnings as w, i (i)}<p class="ly-error">{w}</p>{/each}
                      {#if r.build.ai}
                        <p class="muted">AI correction: {r.build.ai.model}, {r.build.ai.calls} calls, ${r.build.ai.cost.toFixed(2)}.</p>
                      {/if}
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}

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
              {@render masterBlock(r.master)}
            {/if}
            {#if r.masterDate}
              <span class="when">MuseScore {fmtDate(r.masterDate)}</span>
            {/if}
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
                <th scope="row" class="song-col">
                  <div class="song-cell">
                    <span class="song-title">{r.title}</span>
                    <span class="dates">
                      {#if r.masterDate}
                        <span class="d" title="MuseScore master last modified">MuseScore {fmtDate(r.masterDate)}</span>
                      {/if}
                      {#if r.genDate}
                        <span class="d" title="Parts last generated">Generated {fmtDate(r.genDate)}</span>
                      {/if}
                      {#if r.stale}
                        <span class="badge update" title="The MuseScore master is newer than the generated parts — regenerate to pick up the changes">Update</span>
                      {/if}
                    </span>
                  </div>
                </th>
                <td>
                  {#if r.master}
                    {@render masterBlock(r.master)}
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
            {#if r.genDate}<span class="when">Generated {fmtDate(r.genDate)}</span>{/if}
            <span class="counts">{show(tally(r.partFmts))} parts · {show(tally(r.extraFmts))} extra parts · {r.audio} audio</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>

<style>
  .ly-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .ly-btn {
    min-height: 40px;
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--paper);
    font-weight: 600;
  }
  .ly-btn.primary {
    background: var(--accent, #1f5f8b);
    border-color: transparent;
    color: #fff;
  }
  .ly-btn.ghost {
    background: transparent;
  }
  .ly-warn {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #e0b252;
    background: #fdf5e2;
    color: #5c4300;
    font-size: 0.88rem;
  }
  .ly-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ly-actions {
    white-space: nowrap;
    display: flex;
    gap: 6px;
  }
  .ly-status.running {
    color: var(--accent, #1f5f8b);
  }
  .ly-status.failed,
  .ly-error,
  .ly-link.fail,
  .ly-report li.fail {
    color: #b3261e;
  }
  .ly-link {
    background: none;
    border: none;
    padding: 0;
    text-decoration: underline;
    color: inherit;
    font: inherit;
  }
  .ly-report ul {
    list-style: none;
    margin: 0;
    padding: 0;
    columns: 2 18rem;
    font-size: 0.85rem;
  }
  .ly-report li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    break-inside: avoid;
    padding: 2px 0;
  }
  .muted {
    color: var(--muted);
  }
  .ly-report ul.omr-list {
    columns: 1;
  }
  .ly-report .omr-list li {
    display: block;
    padding: 4px 0;
  }
  .omr-note {
    font-size: 0.82rem;
    color: var(--muted);
    padding-left: 12px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

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

  .todo .when {
    font-size: 0.76rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .todo .counts {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .master {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    max-width: 22rem;
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

  /* Drive source beneath the master filename, with the Coverage color key. */
  .src {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.72rem;
    color: var(--muted);
  }

  .src-swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.18);
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

  /* The numeric columns line up with the song title's first line, not its
     (taller) dated cell. */
  tbody td,
  tbody th {
    vertical-align: top;
  }

  .song-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Dates wrap under the title on narrow / progressive screens rather than
     forcing the column wider. */
  .dates {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-weight: 400;
  }

  .dates .d {
    font-size: 0.74rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .badge.update {
    font-weight: 700;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #9a5b00;
    background: #fdf0d8;
    border-color: #e8c98c;
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
