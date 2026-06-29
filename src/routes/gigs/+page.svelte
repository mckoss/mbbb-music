<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import type { Gig } from '$lib/gig';
  import { canEditGigs, formatGigDate, formatGigTimes, formatGigLocation, isValidDate } from '$lib/gig';
  import { listDownloaded } from '$lib/offline';
  import MonthCalendar from '$lib/MonthCalendar.svelte';

  const gigs = $derived(page.data.gigs as Gig[]);
  const canEdit = $derived(canEditGigs(page.data.user?.role));

  // Today as a local YYYY-MM-DD string, to split past from upcoming gigs.
  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // `gigs` arrives sorted by date ascending. Undated gigs (newly created) stay
  // with upcoming so they're easy to find and edit. Upcoming keeps chronological
  // order; past gigs read most-recent first.
  const today = todayStr();
  const upcoming = $derived(gigs.filter((g) => !isValidDate(g.date) || g.date >= today));
  const past = $derived(gigs.filter((g) => isValidDate(g.date) && g.date < today).reverse());

  // Past gigs can grow without bound, so page them (newest first). Upcoming gigs
  // are always shown in full — they're the actionable ones.
  const PAST_PAGE_SIZE = 10;
  let pastPage = $state(0);
  const pastPages = $derived(Math.max(1, Math.ceil(past.length / PAST_PAGE_SIZE)));
  // Clamp for display so a shrinking list (e.g. a background refresh) can't strand
  // us past the end; the button handlers write back through this clamped value.
  const curPage = $derived(Math.min(pastPage, pastPages - 1));
  const pastStart = $derived(curPage * PAST_PAGE_SIZE);
  const pastSlice = $derived(past.slice(pastStart, pastStart + PAST_PAGE_SIZE));

  // Index dated gigs by day so the calendars can color and link them. A day can
  // hold more than one gig.
  const gigsByDate = $derived.by(() => {
    const m = new Map<string, Gig[]>();
    for (const g of gigs) {
      if (!isValidDate(g.date)) continue;
      const arr = m.get(g.date);
      if (arr) arr.push(g);
      else m.set(g.date, [g]);
    }
    return m;
  });

  // The current month and the next two, for the three-up calendar strip.
  const months = $derived.by(() => {
    const now = new Date();
    return [0, 1, 2].map((i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  });

  // Which gigs are saved for offline, so the list can flag them.
  let offlineIds = $state(new Set<string>());
  $effect(() => {
    void listDownloaded().then((m) => (offlineIds = new Set(m.map((g) => g.gigId))));
  });

  // A short summary of the sets/song counts for a gig card.
  function setsSummary(gig: Gig): string {
    const songs = gig.sets.reduce((n, s) => n + s.songSlugs.length, 0);
    const sets = gig.sets.length;
    return `${sets} set${sets === 1 ? '' : 's'} · ${songs} song${songs === 1 ? '' : 's'}`;
  }
</script>

<section class="gigs">
  <header class="head">
    <div>
      <p class="kicker">Gig Packets</p>
      <h2>Gigs</h2>
      <p class="body">
        Curated, set-list–ordered packets of charts for each gig. Pick a gig to see
        its details, download charts in your chosen instrument and format, or run a
        set in performance mode.
      </p>
    </div>
    {#if canEdit}
      <form method="POST" action="?/create" use:enhance>
        <button type="submit" class="new">+ New gig</button>
      </form>
    {/if}
  </header>

  {#if gigs.length > 0}
    <div class="calendars">
      {#each months as m (`${m.year}-${m.month}`)}
        <MonthCalendar year={m.year} month={m.month} {gigsByDate} {today} />
      {/each}
    </div>
    <p class="legend">
      <span class="swatch active"></span> Gig
      <span class="swatch canceled"></span> Canceled
    </p>
  {/if}

  {#snippet gigCard(gig: Gig)}
    <li>
      <a class="card" href={`/gigs/${gig.id}`}>
        <div class="card-main">
          <h3 class:canceled={gig.canceled}>
            <span class="title">{gig.name}</span>
            {#if gig.canceled}<span class="cancel-badge">Canceled</span>{/if}
            {#if offlineIds.has(gig.id)}<span class="offline-badge" title="Saved for offline">⤓ Offline</span>{/if}
          </h3>
          <p class="when">{formatGigDate(gig.date)}</p>
          {#if formatGigTimes(gig.times)}
            <p class="meta">{formatGigTimes(gig.times)}</p>
          {/if}
          {#if formatGigLocation(gig.location)}
            <p class="meta">{formatGigLocation(gig.location)}</p>
          {/if}
        </div>
        <span class="count">{setsSummary(gig)}</span>
      </a>
    </li>
  {/snippet}

  {#if gigs.length === 0}
    <p class="empty">No gigs yet.{#if canEdit} Use the New gig button to create one.{/if}</p>
  {:else}
    {#if upcoming.length > 0}
      <ul class="list">
        {#each upcoming as gig (gig.id)}
          {@render gigCard(gig)}
        {/each}
      </ul>
    {/if}
    {#if past.length > 0}
      <h3 class="divider">Past Gigs</h3>
      <ul class="list">
        {#each pastSlice as gig (gig.id)}
          {@render gigCard(gig)}
        {/each}
      </ul>
      {#if pastPages > 1}
        <nav class="pager" aria-label="Past gigs pages">
          <button
            type="button"
            class="page-btn"
            onclick={() => (pastPage = curPage - 1)}
            disabled={curPage === 0}
          >← Newer</button>
          <span class="page-info">
            {pastStart + 1}–{pastStart + pastSlice.length} of {past.length}
          </span>
          <button
            type="button"
            class="page-btn"
            onclick={() => (pastPage = curPage + 1)}
            disabled={curPage >= pastPages - 1}
          >Older →</button>
        </nav>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .gigs {
    max-width: 920px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
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

  .body {
    color: var(--muted);
    max-width: 60ch;
  }

  .new {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .calendars {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .legend {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--muted);
    font-size: 0.78rem;
    margin: -6px 0 0;
  }

  .legend .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    display: inline-block;
  }

  .legend .swatch:not(:first-child) {
    margin-left: 8px;
  }

  .legend .swatch.active {
    background: #2e7d32;
  }

  .legend .swatch.canceled {
    background: #b3261e;
  }

  .empty {
    color: var(--muted);
    padding: 24px;
    text-align: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 0.95rem;
    font-weight: 700;
  }

  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-top: 4px;
  }

  .page-btn {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .page-btn:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .page-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .page-info {
    color: var(--muted);
    font-size: 0.82rem;
    white-space: nowrap;
  }

  .card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    text-decoration: none;
    color: var(--ink);
  }

  .card:hover {
    border-color: var(--accent);
  }

  .card-main h3 {
    font-size: 1.1rem;
    margin: 0 0 4px;
  }

  .card-main h3.canceled .title {
    text-decoration: line-through;
    text-decoration-thickness: 2px;
    color: var(--muted);
  }

  .cancel-badge {
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #b3261e;
    background: #fbe9e7;
    border: 1px solid #f3c6c0;
    border-radius: 999px;
    padding: 1px 8px;
    vertical-align: middle;
    margin-left: 6px;
    white-space: nowrap;
  }

  .offline-badge {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--accent-strong);
    background: #eaf1f1;
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 1px 8px;
    vertical-align: middle;
    margin-left: 6px;
    white-space: nowrap;
  }

  .when {
    font-weight: 600;
    color: var(--ink);
  }

  .meta {
    color: var(--muted);
    font-size: 0.85rem;
    margin-top: 2px;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
    white-space: nowrap;
  }
</style>
