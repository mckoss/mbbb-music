<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { enhance } from '$app/forms';
  import type { Gig, GigSet } from '$lib/gig';
  import {
    formatGigDate,
    formatGigTimes,
    formatGigTimeRange,
    mapsUrl,
  } from '$lib/gig';
  import type { Catalog, Tune } from '$lib/types';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import { activeScore } from '$lib/resolve';
  import { instrumentDisplay } from '$lib/format';
  import { ASSIGNABLE_STATUSES } from '$lib/song-status';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import PdfPager from '$lib/components/PdfPager.svelte';
  import OfflineGigButton from '$lib/components/OfflineGigButton.svelte';

  const gig = $derived(page.data.gig as Gig);
  const catalog = $derived(page.data.catalog as Catalog);
  const isAdmin = $derived(page.data.user?.role === 'admin');

  // Friendly, slug-based chart URLs (no raw sha in the address bar / save name).
  const assetIndex = $derived(assetIndexFor(catalog));
  const openUrl = (sha: string) => urlForSha(assetIndex, sha) ?? `/blob/${sha}`;

  // Global instrument/format (cookie/URL backed) drive every chart we resolve.
  const instrument = $derived($instrumentSlug);
  const format = $derived($printFormat as PrintFormat);

  // slug -> Tune lookup for titles and score resolution.
  const bySlug = $derived(new Map(catalog.tunes.map((t) => [t.slug, t])));
  const titleOf = (slug: string) => bySlug.get(slug)?.title ?? slug;

  // The pool an admin can add to a set: songs in a "current" status. Always /
  // Active / Learning are the assignable statuses minus the long-term Archive.
  const ADDABLE = new Set(['Always', 'Active', 'Learning']);
  const addable = $derived(
    catalog.tunes
      .filter((t) => ADDABLE.has(t.status))
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  // --- Info editing (admin) -------------------------------------------------
  let editing = $state(false);

  // Resolve a song's printable chart in the chosen instrument/format.
  function scoreFor(slug: string) {
    const tune = bySlug.get(slug);
    return tune ? activeScore(tune, instrument, format, null) : null;
  }

  // Every (resolvable) chart across the gig, de-duplicated by sha, for the
  // "Download all" list. A true single-zip is deferred (no zip dependency).
  const downloads = $derived.by(() => {
    const seen = new Set<string>();
    const out: { slug: string; title: string; sha: string; label: string }[] = [];
    for (const set of gig.sets) {
      for (const slug of set.songSlugs) {
        const sc = scoreFor(slug);
        if (sc && !seen.has(sc.sha)) {
          seen.add(sc.sha);
          out.push({ slug, title: titleOf(slug), sha: sc.sha, label: sc.label });
        }
      }
    }
    return out;
  });

  // Inputs for the offline-download control: the resolved chart hashes plus
  // human labels for the chosen instrument/format.
  const offlineShas = $derived(downloads.map((d) => d.sha));
  const instLabel = $derived(
    instrumentDisplay(
      catalog.instruments.find((i) => i.slug === instrument)?.label ?? instrument,
      catalog.instruments.find((i) => i.slug === instrument)?.key ?? null
    )
  );
  const fmtLabel = $derived(format === 'lyre' ? 'Lyre' : 'Letter');

  // --- Perform-set mode -----------------------------------------------------
  // Driven by the URL (?perform=<setId>&i=<index>) so it's refresh-safe and the
  // browser Back button steps out. We chain through a set's songs, paging each
  // score with the shared PdfPager, then advancing to the next song.
  const params = $derived(page.url.searchParams);
  const performSetId = $derived(params.get('perform'));
  const performSet = $derived<GigSet | null>(
    performSetId ? gig.sets.find((s) => s.id === performSetId) ?? null : null
  );
  const iParam = $derived(params.get('i'));
  const performIndex = $derived(iParam && /^\d+$/.test(iParam) ? Number(iParam) : 0);
  // Songs in the set that actually resolve to a score (skip any with none).
  const performSongs = $derived(
    performSet ? performSet.songSlugs.filter((slug) => scoreFor(slug)) : []
  );
  const clampedIndex = $derived(
    Math.min(Math.max(0, performIndex), Math.max(0, performSongs.length - 1))
  );
  const performSlug = $derived(performSongs[clampedIndex] ?? null);
  const performScore = $derived(performSlug ? scoreFor(performSlug) : null);
  const performing = $derived(Boolean(performSet && performSongs.length > 0));

  function startPerform(setId: string) {
    const p = new URLSearchParams(page.url.search);
    p.set('perform', setId);
    p.set('i', '0');
    goto(`?${p}`); // pushState so Back/Done returns to detail
  }

  function gotoIndex(i: number) {
    const p = new URLSearchParams(page.url.search);
    p.set('i', String(i));
    goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
  function prevSong() {
    if (clampedIndex > 0) gotoIndex(clampedIndex - 1);
  }
  function nextSong() {
    if (clampedIndex < performSongs.length - 1) gotoIndex(clampedIndex + 1);
  }
  function donePerform() {
    const p = new URLSearchParams(page.url.search);
    p.delete('perform');
    p.delete('i');
    const qs = p.toString();
    goto(qs ? `?${qs}` : page.url.pathname, { replaceState: true });
  }

  function onKey(e: KeyboardEvent) {
    if (!performing) return;
    if (e.key === 'Escape') donePerform();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if performing && performSet}
  <!-- Dark full-screen perform-set overlay, mirroring ScoreOverlay's
       performance mode. A floating cluster (top-right) holds song navigation
       and a clear Done button. -->
  <div class="overlay">
    <div class="floating">
      <span class="pos">
        {performSet.name || 'Set'} · {clampedIndex + 1}/{performSongs.length}
      </span>
      <button class="ghost" onclick={prevSong} disabled={clampedIndex <= 0}>‹ Prev song</button>
      <button
        class="ghost"
        onclick={nextSong}
        disabled={clampedIndex >= performSongs.length - 1}>Next song ›</button
      >
      <button class="primary" onclick={donePerform}>Done</button>
    </div>
    <div class="now-playing">{performSlug ? titleOf(performSlug) : ''}</div>
    <div class="stage">
      {#if performScore}
        {#key performScore.sha}
          <PdfPager
            sha={performScore.sha}
            title={`${performSlug ? titleOf(performSlug) : ''} — ${performScore.label}`}
            tap={true}
            openHref={openUrl(performScore.sha)}
          />
        {/key}
      {/if}
    </div>
  </div>
{/if}

<section class="detail" class:hidden={performing}>
  <a class="back" href="/gigs">← All gigs</a>

  <header class="head">
    <div>
      <p class="kicker">Gig Packet</p>
      <h2>{gig.name}</h2>
    </div>
    {#if isAdmin}
      <button class="edit" onclick={() => (editing = !editing)}>
        {editing ? 'Done editing' : 'Edit info'}
      </button>
    {/if}
  </header>

  {#if editing && isAdmin}
    <!-- Info editor. Up to a few time slots, plus location + notes. -->
    <form
      class="info-form"
      method="POST"
      action="?/updateInfo"
      use:enhance={() => async ({ update }) => {
        await update({ reset: false });
        editing = false;
      }}
    >
      <label class="field">
        <span>Name</span>
        <input name="name" value={gig.name} required />
      </label>
      <label class="field">
        <span>Date</span>
        <input type="date" name="date" value={gig.date} />
      </label>

      <fieldset class="times">
        <legend>Times</legend>
        <p class="hint">Add a start (and optional end) for each playing slot.</p>
        {#each [0, 1, 2] as i (i)}
          <div class="time-row">
            <input type="time" name="start" value={gig.times?.[i]?.start ?? ''} aria-label="Start" />
            <span>to</span>
            <input type="time" name="end" value={gig.times?.[i]?.end ?? ''} aria-label="End" />
          </div>
        {/each}
      </fieldset>

      <label class="field">
        <span>Location name</span>
        <input name="locationName" value={gig.location?.name ?? ''} />
      </label>
      <label class="field">
        <span>Address</span>
        <input name="locationAddress" value={gig.location?.address ?? ''} />
      </label>
      <label class="field">
        <span>Notes</span>
        <textarea name="notes" rows="4">{gig.notes ?? ''}</textarea>
      </label>

      <div class="form-actions">
        <button type="submit" class="primary-btn">Save</button>
        <button type="button" class="ghost-btn" onclick={() => (editing = false)}>Cancel</button>
      </div>
    </form>
  {:else}
    <!-- Read-only info. -->
    <div class="info">
      <p class="when">{formatGigDate(gig.date)}</p>
      {#if gig.times?.length}
        <ul class="time-list">
          {#each gig.times as t, i (i)}
            <li>{formatGigTimeRange(t)}</li>
          {/each}
        </ul>
      {/if}
      {#if gig.location}
        <p class="loc">
          {#if gig.location.name}<strong>{gig.location.name}</strong>{/if}
          {#if gig.location.address}
            <span class="addr">{gig.location.address}</span>
            <a class="maps" href={mapsUrl(gig.location.address)} target="_blank" rel="noopener">
              Open in Google Maps ↗
            </a>
          {/if}
        </p>
      {/if}
      {#if gig.notes}<p class="notes">{gig.notes}</p>{/if}
    </div>
  {/if}

  <!-- Setlists -->
  <div class="sets">
    {#each gig.sets as set, si (set.id)}
      <div class="set">
        <header class="set-head">
          <h3>{set.name || `Set ${si + 1}`}</h3>
          <div class="set-actions">
            {#if set.songSlugs.some((slug) => scoreFor(slug))}
              <button class="perform" onclick={() => startPerform(set.id)}>▶ Perform set</button>
            {/if}
            {#if isAdmin && gig.sets.length > 1}
              <form
                method="POST"
                action="?/removeSet"
                use:enhance
              >
                <input type="hidden" name="setId" value={set.id} />
                <button class="danger-link" type="submit">Remove set</button>
              </form>
            {/if}
          </div>
        </header>

        {#if set.songSlugs.length === 0}
          <p class="empty-set">No songs yet.</p>
        {:else}
          <ol class="songs">
            {#each set.songSlugs as slug, i (slug)}
              {@const sc = scoreFor(slug)}
              <li>
                <span class="song-title">{titleOf(slug)}</span>
                <span class="song-tools">
                  {#if sc}
                    <a class="dl" href={openUrl(sc.sha)} target="_blank" rel="noopener" title={sc.label}>
                      Chart ↓
                    </a>
                  {:else}
                    <span class="no-chart">no chart for this instrument</span>
                  {/if}
                  {#if isAdmin}
                    <form method="POST" action="?/moveSong" use:enhance>
                      <input type="hidden" name="setId" value={set.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="dir" value="up" />
                      <button type="submit" class="icon" disabled={i === 0} aria-label="Move up">↑</button>
                    </form>
                    <form method="POST" action="?/moveSong" use:enhance>
                      <input type="hidden" name="setId" value={set.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="dir" value="down" />
                      <button
                        type="submit"
                        class="icon"
                        disabled={i === set.songSlugs.length - 1}
                        aria-label="Move down">↓</button
                      >
                    </form>
                    <form method="POST" action="?/removeSong" use:enhance>
                      <input type="hidden" name="setId" value={set.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <button type="submit" class="icon danger" aria-label="Remove">×</button>
                    </form>
                  {/if}
                </span>
              </li>
            {/each}
          </ol>
        {/if}

        {#if isAdmin}
          <form class="add-song" method="POST" action="?/addSong" use:enhance>
            <input type="hidden" name="setId" value={set.id} />
            <select name="slug" aria-label="Add a song">
              <option value="">Add a song…</option>
              {#each addable as t (t.slug)}
                <option value={t.slug}>{t.title} · {t.status}</option>
              {/each}
            </select>
            <button type="submit" class="add-btn">Add</button>
          </form>
        {/if}
      </div>
    {/each}

    {#if isAdmin}
      <form class="add-set" method="POST" action="?/addSet" use:enhance>
        <input name="name" placeholder="New set name (optional)" />
        <button type="submit" class="add-btn">+ Add set</button>
      </form>
    {/if}
  </div>

  <!-- Offline access -->
  <OfflineGigButton
    gigId={page.params.id ?? ''}
    title={gig.name}
    {instrument}
    {format}
    instrumentLabel={instLabel}
    formatLabel={fmtLabel}
    shas={offlineShas}
  />

  <!-- Downloads -->
  {#if downloads.length > 0}
    <div class="downloads">
      <h3>Download charts</h3>
      <p class="hint">
        Charts resolve to your chosen instrument
        ({instrumentDisplay(
          catalog.instruments.find((i) => i.slug === instrument)?.label ?? instrument,
          catalog.instruments.find((i) => i.slug === instrument)?.key ?? null
        )}) and format ({format === 'lyre' ? 'Lyre' : 'Letter'}). A single combined
        zip is not yet available — download each chart below.
      </p>
      <ul class="dl-list">
        {#each downloads as d (d.sha)}
          <li>
            <a href={openUrl(d.sha)} target="_blank" rel="noopener">
              {d.title} <span class="dl-label">— {d.label}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Delete gig (admin) -->
  {#if isAdmin}
    <form
      class="delete-gig"
      method="POST"
      action="?/deleteGig"
      use:enhance={() => async ({ result, update }) => {
        if (result.type === 'success') {
          await goto('/gigs', { invalidateAll: true });
        } else {
          await update();
        }
      }}
    >
      <button
        type="submit"
        class="danger-btn"
        onclick={(e) => {
          if (!confirm('Delete this gig? This cannot be undone.')) e.preventDefault();
        }}>Delete gig</button
      >
    </form>
  {/if}
</section>

<style>
  .detail {
    max-width: 880px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .detail.hidden {
    display: none;
  }

  .back {
    color: var(--accent-strong);
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
    margin: 4px 0;
  }

  h3 {
    font-size: 1.05rem;
  }

  .edit {
    min-height: 38px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }

  /* Read-only info block */
  .info {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .when {
    font-weight: 700;
    font-size: 1.05rem;
  }

  .time-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    color: var(--ink);
  }

  .loc {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .addr {
    color: var(--muted);
  }

  .maps {
    color: var(--accent-strong);
    font-weight: 600;
    align-self: flex-start;
  }

  .notes {
    white-space: pre-wrap;
    color: var(--ink);
  }

  /* Info editor */
  .info-form {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field span {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
  }

  input,
  textarea,
  select {
    min-height: 40px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    padding: 6px 10px;
    font: inherit;
  }

  textarea {
    min-height: auto;
  }

  .times {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .times legend {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
    padding: 0 4px;
  }

  .time-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hint {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .form-actions {
    display: flex;
    gap: 10px;
  }

  .primary-btn {
    min-height: 40px;
    padding: 0 18px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    cursor: pointer;
  }

  .ghost-btn {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
  }

  /* Sets */
  .sets {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .set {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .set-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .set-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .perform {
    min-height: 38px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .danger-link {
    border: 0;
    background: none;
    color: #b3261e;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
    padding: 0;
  }

  .songs {
    margin: 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .songs li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .song-title {
    font-weight: 600;
  }

  .song-tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .song-tools form {
    display: inline;
  }

  .dl {
    color: var(--accent-strong);
    font-size: 0.8rem;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }

  .no-chart {
    color: var(--muted);
    font-size: 0.75rem;
    font-style: italic;
  }

  .icon {
    min-width: 30px;
    min-height: 30px;
    border-radius: 5px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
  }

  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon.danger {
    color: #b3261e;
  }

  .empty-set {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .add-song,
  .add-set {
    display: flex;
    gap: 8px;
  }

  .add-song select {
    flex: 1;
  }

  .add-set input {
    flex: 1;
  }

  .add-btn {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }

  /* Downloads */
  .downloads {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dl-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dl-list a {
    color: var(--accent-strong);
    text-decoration: none;
    font-weight: 600;
  }

  .dl-label {
    color: var(--muted);
    font-weight: 400;
  }

  .delete-gig {
    margin-top: 8px;
  }

  .danger-btn {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid #b3261e;
    background: transparent;
    color: #b3261e;
    font-weight: 700;
    cursor: pointer;
  }

  /* Perform-set overlay (mirrors ScoreOverlay performance mode). */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #202124;
    color: #fffdf7;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .floating {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  .pos {
    font-size: 0.78rem;
    color: #dfddd4;
    white-space: nowrap;
  }

  .floating button {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .floating .ghost {
    background: rgba(255, 253, 247, 0.12);
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
  }

  .floating .ghost:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .floating .primary {
    background: var(--accent);
    color: #fffdf7;
    border: 1px solid var(--accent-strong);
  }

  .now-playing {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 5;
    font-size: 0.9rem;
    color: #f2d36b;
    font-weight: 700;
    max-width: 50vw;
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    padding: 12px;
  }
</style>
