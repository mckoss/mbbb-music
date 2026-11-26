<script lang="ts">
  import { page } from '$app/state';
  import { viewHref } from '$lib/view';
  import { fmtDate } from '$lib/format';
  import { instrumentDisplay } from '$lib/format';

  // One song's generated output: preview every LilyPond file, and compare any
  // instrument's printed part side by side — the band's original (or whatever a
  // generated part replaced) on the left, the generated part on the right.
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
    parts: {
      sha: string;
      name: string | null;
      instrumentSlug: string;
      instrument: string | null;
      partNumber: number | null;
      format: string;
      source: string | null;
      generated: boolean;
      current: boolean;
    }[];
  });
  const from = $derived(page.url.pathname);
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

  // ── Side-by-side compare ──
  const isLily = (p: { source: string | null }) => p.source === 'lilypond';
  const instruments = $derived(
    [...new Map(data.parts.filter(isLily).map((p) => [p.instrumentSlug, p.instrument ?? p.instrumentSlug])).entries()].map(
      ([slug, label]) => ({ slug, label })
    )
  );
  let instrument = $state('');
  $effect(() => {
    if (!instrument && instruments.length) instrument = instruments[0].slug;
  });
  const describe = (p: (typeof data.parts)[number]) =>
    `${p.name ?? 'Part'}${p.format === 'lyre' ? ' (Lyre)' : ''}${p.current ? '' : ' — older version'}`;
  const leftChoices = $derived(data.parts.filter((p) => p.instrumentSlug === instrument && !isLily(p)));
  const rightChoices = $derived(data.parts.filter((p) => p.instrumentSlug === instrument && isLily(p)));
  let leftSha = $state('');
  let rightSha = $state('');
  $effect(() => {
    // Default each side when the instrument changes: the band's own (manual)
    // original on the left, the Letter generated part on the right.
    if (!leftChoices.some((p) => p.sha === leftSha)) leftSha = (leftChoices.find((p) => !p.generated) ?? leftChoices[0])?.sha ?? '';
    if (!rightChoices.some((p) => p.sha === rightSha)) rightSha = (rightChoices.find((p) => p.format === 'letter') ?? rightChoices[0])?.sha ?? '';
  });

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
    void pagesOf(leftSha);
    void pagesOf(rightSha);
  });
  const pageList = (sha: string) => Array.from({ length: pageCounts[sha] ?? 0 }, (_, i) => i + 1);
</script>

<section class="status">
  <header>
    <p class="kicker"><a href="/library-status/generated-scores">← Generated</a></p>
    <h2>{data.title}</h2>
    {#if data.build}
      <p class="count">
        {data.build.origin === 'omr' ? 'Draft master from PDFs' : 'LilyPond build'} · built {fmtDate(data.build.builtAt)}
        {data.build.builtBy ? ` by ${data.build.builtBy}` : ''}
        {#if data.build.origin !== 'omr'} · {data.build.passed ? 'matches the MuseScore master' : 'some parts differ from the master'}{/if}
        {data.build.ai ? ` · AI correction $${data.build.ai.cost.toFixed(2)}` : ''}
      </p>
    {:else}
      <p class="count">No LilyPond build for this song yet — build it from the Generated tab.</p>
    {/if}
  </header>

  {#if data.build}
    <section class="block">
      <h3>Files</h3>
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
        <label>
          Left (original)
          <select bind:value={leftSha}>
            {#if !leftChoices.length}<option value="">No other PDF for this instrument</option>{/if}
            {#each leftChoices as p (p.sha)}<option value={p.sha}>{describe(p)}</option>{/each}
          </select>
        </label>
        <label>
          Right (LilyPond)
          <select bind:value={rightSha}>
            {#each rightChoices as p (p.sha)}<option value={p.sha}>{describe(p)}</option>{/each}
          </select>
        </label>
      </div>
      <div class="compare">
        {#each [leftSha, rightSha] as sha, side (side)}
          <div class="col">
            {#if !sha}
              <p class="muted">Nothing to show.</p>
            {:else if pageCounts[sha] == null}
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
    grid-template-columns: 1fr 1fr;
    gap: 12px;
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
      grid-template-columns: 1fr;
    }
  }
</style>
