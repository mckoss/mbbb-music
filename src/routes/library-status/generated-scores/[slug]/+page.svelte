<script lang="ts">
  import { page } from '$app/state';
  import { viewHref } from '$lib/view';
  import { fmtDate } from '$lib/format';
  import { instrumentDisplay } from '$lib/format';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { writeFetch } from '$lib/client-version';

  // One song's versions: every file grouped by origin (the band's originals, the
  // MuseScore master and MuseScore-built parts, LilyPond builds), a preview of
  // the LilyPond files, and a side-by-side viewer for any two part PDFs.
  type Origin = 'original' | 'musescore' | 'lilypond' | 'draft';
  interface VDoc {
    sha: string;
    name: string | null;
    instrumentSlug: string;
    instrument: string | null;
    partNumber: number | null;
    partNumbers: number[];
    format: string;
    source: string | null;
    origin: Origin;
    modified: string | null;
    current: boolean;
  }
  const data = $derived(page.data as {
    slug: string;
    title: string;
    build: {
      builtAt: string;
      builtBy: string | null;
      origin: 'mscz' | 'omr';
      passed: boolean;
      outputs: { sha256: string; name: string; kind: string; format?: string; part?: string }[];
      ai: { cost: number } | null;
    } | null;
    parts: VDoc[];
    scores: VDoc[];
    audio: VDoc[];
    musescore: VDoc[];
  });
  const ORIGIN_LABEL: Record<Origin, string> = {
    original: 'Original',
    musescore: 'MuseScore-built',
    lilypond: 'LilyPond',
    draft: 'Draft (from PDFs)',
  };

  // ── All versions: one row per part, one column per origin ──
  const origins = $derived(
    (['original', 'musescore', 'lilypond', 'draft'] as Origin[]).filter((o) =>
      [...data.parts, ...data.scores].some((d) => d.origin === o)
    )
  );
  // Drum parts share one instrument, so tell them apart by kind.
  const DRUM_KINDS: [RegExp, string][] = [
    [/snare/i, 'Snare'],
    [/tenor|toms?\b|quad/i, 'Tenors'],
    [/bass[\s_-]*drum|drums-bass/i, 'Bass drum'],
    [/kit|drum[\s_-]*set/i, 'Drum kit'],
    [/cymbal/i, 'Cymbals'],
  ];
  const drumKind = (d: VDoc) => DRUM_KINDS.find(([re]) => re.test(d.name ?? ''))?.[1] ?? '';
  const partName = (d: VDoc) => {
    const kind = d.instrumentSlug === 'drums' ? drumKind(d) : '';
    return `${d.instrument ?? d.instrumentSlug}${kind ? ` — ${kind}` : ''}${d.partNumbers.length ? ` ${d.partNumbers.join(' & ')}` : ''}`;
  };
  // A PDF in the scores bucket is either the full score or a generated part for
  // an instrument off the core roster (piccolo, xylophone) — name it as such.
  const scoreRowName = (d: VDoc) => {
    const stem = (d.name ?? '').replace(/\.pdf$/i, '').replace(/[-_ ](letter|lyre)$/i, '');
    if (d.origin === 'original' || /(^|[-_ ])(score|full|conductor)([-_ ]|$)/i.test(stem)) return 'Full score';
    const rest = stem.startsWith(`${data.slug}-`) ? stem.slice(data.slug.length + 1) : stem;
    const words = rest.replace(/[-_]+/g, ' ').trim();
    return words ? `${words[0].toUpperCase()}${words.slice(1)} (extra part)` : 'Full score';
  };
  const versionRows = $derived.by(() => {
    const rows = new Map<string, { label: string; cells: Record<string, VDoc[]> }>();
    const add = (key: string, label: string, d: VDoc) => {
      const row = rows.get(key) ?? { label, cells: {} };
      (row.cells[d.origin] ??= []).push(d);
      rows.set(key, row);
    };
    for (const d of data.parts) add(`p|${partName(d)}`, partName(d), d);
    for (const d of data.scores) add(`s|${scoreRowName(d)}`, scoreRowName(d), d);
    const rank = (l: string) => (l === 'Full score' ? 0 : /\(extra part\)$/.test(l) ? 2 : 1);
    return [...rows.values()].sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  });
  const cellLabel = (d: VDoc, all: VDoc[]) => {
    const fmt = d.format === 'lyre' ? 'Lyre' : 'Letter';
    // Several files in one cell: tell them apart by format, then by name.
    const sameFmt = all.filter((x) => x.format === d.format).length > 1;
    return sameFmt ? `${fmt} · ${d.name ?? 'file'}` : fmt;
  };
  const from = $derived(page.url.pathname + page.url.search);
  // Back to wherever the song was opened from (Library Status or Generated).
  const back = $derived.by(() => {
    const f = page.url.searchParams.get('from') ?? '';
    return f.startsWith('/library-status') ? f : '/library-status/generated-scores';
  });
  const backLabel = $derived(back.startsWith('/library-status/generated-scores') ? 'Generated' : 'Library Status');

  // ── Admin: build / rebuild this song here (same queue as the Generated tab;
  // the server re-checks the admin role on /admin/lilypond) ──
  const isAdmin = $derived(page.data.user?.role === 'admin');
  const hasMaster = $derived(data.musescore.length > 0);
  interface Job {
    slug: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    error: string | null;
    lines: { t: number; msg: string }[];
  }
  let job = $state<Job | null>(null);
  let aiAvailable = $state(false);
  let statusLoaded = $state(false);
  let buildError = $state<string | null>(null);
  const busy = $derived(job?.status === 'queued' || job?.status === 'running');

  async function refreshStatus() {
    try {
      const res = await fetch('/admin/lilypond');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const wasBusy = busy;
      job = [...(d.jobs ?? [])].reverse().find((j: Job) => j.slug === data.slug) ?? null;
      aiAvailable = Boolean(d.aiAvailable);
      statusLoaded = true;
      if (wasBusy && !(job?.status === 'queued' || job?.status === 'running')) await invalidateAll();
    } catch (err) {
      buildError = `Could not load build status (${err instanceof Error ? err.message : err})`;
    }
  }
  async function act(body: Record<string, unknown>) {
    buildError = null;
    try {
      const res = await writeFetch('/admin/lilypond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      if (out.skipped?.length) buildError = 'This song has nothing to build from.';
      await refreshStatus();
      if (body.action === 'revert') await invalidateAll();
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
    }
  }
  onMount(() => {
    if (!isAdmin) return;
    void refreshStatus();
    const timer = setInterval(() => {
      if (busy) void refreshStatus();
    }, 2500);
    return () => clearInterval(timer);
  });
  const outputs = $derived(data.build?.outputs ?? []);
  const lySource = $derived(outputs.find((o) => o.kind === 'source') ?? null);
  const audio = $derived(outputs.find((o) => o.kind === 'audio') ?? null);
  const scores = $derived(outputs.filter((o) => o.kind === 'score'));
  const partOutputs = $derived(outputs.filter((o) => o.kind === 'part'));

  // The generated parts' rows, grouped by part name with Letter / Lyre side by side.
  const partRows = $derived.by(() => {
    const by = new Map<string, { part: string; letter?: string; lyre?: string }>();
    for (const o of partOutputs) {
      const key = o.part ?? o.name;
      const row = by.get(key) ?? { part: key };
      if (o.format === 'lyre') row.lyre = o.sha256;
      else row.letter = o.sha256;
      by.set(key, row);
    }
    return [...by.values()];
  });

  // ── LilyPond source preview ──
  let lyText = $state<string | null>(null);
  let lyOpen = $state(false);
  async function toggleLy() {
    lyOpen = !lyOpen;
    if (lyOpen && lyText == null && lySource) {
      const res = await fetch(`/blob/${lySource.sha256}`);
      lyText = res.ok ? await res.text() : `Could not load the file (HTTP ${res.status}).`;
    }
  }

  // ── Side-by-side compare: up to three PDFs of one part (or the full score),
  // e.g. the band's original, the MuseScore-built and the LilyPond version. ──
  const SCORE = '__score';
  const instruments = $derived([
    ...(data.scores.length ? [{ slug: SCORE, label: 'Full score' }] : []),
    ...[...new Map(data.parts.map((p) => [p.instrumentSlug, p.instrument ?? p.instrumentSlug])).entries()]
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]);
  let instrument = $state('');
  $effect(() => {
    if (!instruments.some((i) => i.slug === instrument) && instruments.length) {
      // Start on a real part rather than the score when there is one.
      instrument = (instruments.find((i) => i.slug !== SCORE) ?? instruments[0]).slug;
    }
  });
  const describe = (p: VDoc) =>
    `${ORIGIN_LABEL[p.origin]} · ${p.format === 'lyre' ? 'Lyre' : 'Letter'}${p.partNumbers.length ? ` · part ${p.partNumbers.join(' & ')}` : ''}${p.current ? '' : ' (older version)'}`;
  const choices = $derived(instrument === SCORE ? data.scores : data.parts.filter((p) => p.instrumentSlug === instrument));
  // Three panes; an empty value hides a pane.
  let panes = $state<string[]>(['', '', '']);
  let panesFor = '';
  $effect(() => {
    // Default the panes when the instrument changes: original, MuseScore-built,
    // LilyPond (Letter preferred) — whichever exist, in that order.
    if (panesFor === instrument) return;
    panesFor = instrument;
    const pick = (o: Origin) => choices.find((p) => p.origin === o && p.format === 'letter') ?? choices.find((p) => p.origin === o);
    const picked = (['original', 'musescore', 'lilypond', 'draft'] as Origin[]).map(pick).filter(Boolean) as VDoc[];
    panes = [0, 1, 2].map((i) => picked[i]?.sha ?? '');
  });
  const shown = $derived(panes.filter(Boolean));

  const pageCounts = $state<Record<string, number>>({});
  async function pagesOf(sha: string) {
    if (!sha || pageCounts[sha] != null) return;
    try {
      const res = await fetch(`/render/${sha}/info`);
      pageCounts[sha] = res.ok ? ((await res.json()).pages ?? 0) : 0;
    } catch {
      pageCounts[sha] = 0;
    }
  }
  $effect(() => {
    for (const sha of panes) void pagesOf(sha);
  });
  const pageList = (sha: string) => Array.from({ length: pageCounts[sha] ?? 0 }, (_, i) => i + 1);
</script>

<section class="status">
  <header>
    <p class="kicker"><a href={back}>← {backLabel}</a></p>
    <h2>{data.title}</h2>
    {#if data.build}
      <p class="count">
        {data.build.origin === 'omr' ? 'Draft master from PDFs' : 'LilyPond build'} · built {fmtDate(data.build.builtAt)}
        {data.build.builtBy ? ` by ${data.build.builtBy}` : ''}
        {#if data.build.origin !== 'omr'} · {data.build.passed ? 'matches the MuseScore master' : 'some parts differ from the master'}{/if}
        {data.build.ai ? ` · AI correction $${data.build.ai.cost.toFixed(2)}` : ''}
      </p>
    {:else}
      <p class="count">No LilyPond build for this song yet.</p>
    {/if}
    {#if isAdmin}
      <div class="admin-actions">
        {#if hasMaster}
          <button type="button" class="ly-btn primary" disabled={busy} onclick={() => act({ action: 'build', slugs: [data.slug] })}
            >{data.build ? 'Rebuild with LilyPond' : 'Build with LilyPond'}</button
          >
        {:else if data.parts.length}
          <button type="button" class="ly-btn primary" disabled={busy} onclick={() => act({ action: 'build', slugs: [data.slug] })}
            >{data.build ? 'Rebuild draft from PDFs' : 'Build draft from PDFs'}</button
          >
          <button
            type="button"
            class="ly-btn"
            disabled={busy || !aiAvailable}
            title={aiAvailable ? '' : 'Off: the server has no ANTHROPIC_API_KEY'}
            onclick={() => act({ action: 'build', slugs: [data.slug], ai: true })}>Build with AI</button
          >
        {/if}
        {#if data.build}
          <button type="button" class="ly-btn ghost" disabled={busy} onclick={() => act({ action: 'revert', slug: data.slug })}>Remove LilyPond output</button>
        {/if}
        {#if busy}
          <span class="ly-status">{job?.status === 'queued' ? 'Queued' : (job?.lines.at(-1)?.msg ?? 'Running')}…</span>
        {:else if job?.status === 'failed'}
          <span class="ly-error">Failed: {job.error}</span>
        {/if}
      </div>
      {#if statusLoaded && !hasMaster && data.parts.length && !aiAvailable}
        <p class="ly-warn">
          <strong>Build with AI is off:</strong> the server has no <code>ANTHROPIC_API_KEY</code>. Add it in
          Railway → the <em>mbbb-music</em> service → <em>Variables</em>, then click <em>Deploy</em> on the
          staged-changes banner.
        </p>
      {/if}
      {#if buildError}<p class="ly-error">{buildError}</p>{/if}
    {/if}
  </header>

  <section class="block">
    <h3>All versions</h3>
    <p class="hint muted">
      Every copy of each part, by where it came from. Players see the newest generated version by
      default and can pick the others as "older version".
    </p>
    <div class="scroller">
      <table class="parts versions">
        <thead>
          <tr>
            <th scope="col">Part</th>
            {#each origins as o (o)}<th scope="col">{ORIGIN_LABEL[o]}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each versionRows as r (r.label)}
            <tr>
              <th scope="row">{r.label}</th>
              {#each origins as o (o)}
                <td>
                  {#each (r.cells[o] ?? []).sort((a, b) => a.format.localeCompare(b.format)) as d (d.sha)}
                    <a href={viewHref({ sha: d.sha, title: `${data.title} — ${r.label} (${ORIGIN_LABEL[o]})`, from })} title={d.name ?? ''}>{cellLabel(d, r.cells[o])}</a>
                  {:else}
                    <span class="muted">·</span>
                  {/each}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <ul class="files">
      {#each data.musescore as m (m.sha)}
        <li>
          <span>MuseScore master</span>
          <a href={`/blob/${m.sha}?dl=${encodeURIComponent(m.name ?? `${data.slug}.mscz`)}`}>download {m.name ?? ''}</a>
          {#if m.modified}<span class="muted">modified {fmtDate(m.modified)}</span>{/if}
        </li>
      {/each}
      {#each data.audio as a (a.sha)}
        <li>
          <span>{ORIGIN_LABEL[a.origin]} audio{a.current ? '' : ' (older version)'}</span>
          <audio controls preload="none" src={`/blob/${a.sha}`}></audio>
          <span class="muted">{a.name}</span>
        </li>
      {/each}
    </ul>
  </section>

  {#if data.build}
    <section class="block">
      <h3>LilyPond files</h3>
      <ul class="files">
        {#each scores as s (s.sha256)}
          <li><a href={viewHref({ sha: s.sha256, title: `${data.title} — Full score`, from })}>Full score</a> <span class="muted">{s.name}</span></li>
        {/each}
        {#if audio}
          <li>
            <span>Band audio</span>
            <audio controls preload="none" src={`/blob/${audio.sha256}`}></audio>
          </li>
        {/if}
        {#if lySource}
          <li>
            <button type="button" class="link" onclick={toggleLy}>{lyOpen ? 'Hide' : 'Show'} LilyPond source</button>
            <a class="muted" href={`/blob/${lySource.sha256}?dl=${encodeURIComponent(lySource.name)}`}>download {lySource.name}</a>
          </li>
        {/if}
      </ul>
      {#if lyOpen}
        <pre class="ly">{lyText ?? 'Loading…'}</pre>
      {/if}
      {#if partRows.length}
        <table class="parts">
          <thead><tr><th scope="col">Part</th><th scope="col">Letter</th><th scope="col">Lyre</th></tr></thead>
          <tbody>
            {#each partRows as r (r.part)}
              <tr>
                <th scope="row">{r.part}</th>
                <td>{#if r.letter}<a href={viewHref({ sha: r.letter, title: `${data.title} — ${r.part}`, from })}>View</a>{:else}·{/if}</td>
                <td>{#if r.lyre}<a href={viewHref({ sha: r.lyre, title: `${data.title} — ${r.part} (Lyre)`, from })}>View</a>{:else}·{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  {#if instruments.length}
    <section class="block">
      <h3>Compare side by side</h3>
      <div class="pickers">
        <label>
          Instrument
          <select bind:value={instrument}>
            {#each instruments as i (i.slug)}<option value={i.slug}>{instrumentDisplay(i.label, null)}</option>{/each}
          </select>
        </label>
        {#each [0, 1, 2] as i (i)}
          <label>
            {['First', 'Second', 'Third'][i]}
            <select bind:value={panes[i]}>
              <option value="">— none —</option>
              {#each choices as p (p.sha)}<option value={p.sha}>{describe(p)}</option>{/each}
            </select>
          </label>
        {/each}
      </div>
      <div class="compare" style:grid-template-columns={`repeat(${Math.max(shown.length, 1)}, minmax(0, 1fr))`}>
        {#each shown as sha (sha)}
          {@const d = choices.find((c) => c.sha === sha)}
          <div class="col">
            {#if d}<p class="pane-title">{describe(d)}</p>{/if}
            {#if pageCounts[sha] == null}
              <p class="muted">Loading…</p>
            {:else}
              {#each pageList(sha) as n (n)}
                <img src={`/render/${sha}/${n}.webp`} alt={`Page ${n}`} loading="lazy" />
              {/each}
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</section>

<style>
  .status {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .kicker a {
    text-decoration: none;
  }
  .admin-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
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
  .ly-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ly-status {
    color: var(--accent, #1f5f8b);
    font-size: 0.88rem;
  }
  .ly-error {
    color: #b3261e;
    font-size: 0.88rem;
  }
  .ly-warn {
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #e0b252;
    background: #fdf5e2;
    color: #5c4300;
    font-size: 0.88rem;
  }
  .count,
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .block h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }
  .files {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .files li {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    text-decoration: underline;
    color: inherit;
    font: inherit;
    min-height: 32px;
  }
  .ly {
    max-height: 420px;
    overflow: auto;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 10px;
    font-size: 0.78rem;
  }
  .parts {
    border-collapse: collapse;
    width: 100%;
    max-width: 640px;
  }
  .parts th,
  .parts td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
  }
  .versions {
    max-width: none;
  }
  .versions td {
    vertical-align: top;
  }
  .versions td a {
    display: inline-block;
    margin-right: 10px;
    min-height: 28px;
  }
  .scroller {
    overflow-x: auto;
    margin-bottom: 12px;
  }
  .hint {
    margin-bottom: 8px;
  }
  .pickers {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 12px;
  }
  .pickers label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .pickers select {
    min-height: 40px;
    min-width: 220px;
  }
  .compare {
    display: grid;
    gap: 12px;
  }
  .pane-title {
    font-size: 0.8rem;
    font-weight: 600;
    position: sticky;
    top: 0;
    background: var(--panel);
    padding: 4px 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .col img {
    width: 100%;
    height: auto;
    border: 1px solid var(--line);
    background: #fff;
  }
  @media (max-width: 700px) {
    .compare {
      grid-template-columns: 1fr !important;
    }
  }
</style>
