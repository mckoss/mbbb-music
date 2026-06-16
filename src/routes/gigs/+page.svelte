<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import type { Gig } from '$lib/gig';
  import { formatGigDate, formatGigTimes, formatGigLocation } from '$lib/gig';
  import { listDownloaded } from '$lib/offline';

  const gigs = $derived(page.data.gigs as Gig[]);
  const isAdmin = $derived(page.data.user?.role === 'admin');

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
    {#if isAdmin}
      <form method="POST" action="?/create" use:enhance>
        <button type="submit" class="new">+ New gig</button>
      </form>
    {/if}
  </header>

  {#if gigs.length === 0}
    <p class="empty">No gigs yet.{#if isAdmin} Use the New gig button to create one.{/if}</p>
  {:else}
    <ul class="list">
      {#each gigs as gig (gig.id)}
        <li>
          <a class="card" href={`/gigs/${gig.id}`}>
            <div class="card-main">
              <h3>
                {gig.name}
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
      {/each}
    </ul>
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
