<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import type { Gig } from '$lib/gig';
  import {
    canEditGigs,
    formatGigDate,
    formatGigTime,
    formatGigTimes,
    formatGigLocation,
    isValidDate,
  } from '$lib/gig';
  import { listDownloaded } from '$lib/offline';
  import MonthCalendar from '$lib/MonthCalendar.svelte';
  import type { RsvpStatus } from '$lib/rsvp';
  import { formatPacificDateTime } from '$lib/time';

  const gigs = $derived(page.data.gigs as Gig[]);
  const canEdit = $derived(canEditGigs(page.data.user?.role));

  // Gig-sheet import (admins only; null for everyone else). The last run's
  // report comes back from the load, so it refreshes after every sync.
  interface SheetReport {
    at: string;
    trigger: 'manual' | 'daily';
    ok: boolean;
    error?: string;
    columns: number;
    created: { gigId: string; name: string; date: string }[];
    linked: { gigId: string; name: string; date: string }[];
    canceled: { gigId: string; name: string; date: string }[];
    rsvpCount: number;
    rsvps: { gigId: string; gigName: string; member: string; status: RsvpStatus }[];
    conflicts: number;
    ambiguous: { date: string; header: string }[];
    deleted: number;
    unmatched: { key: string; name: string; instrument: string; reason: 'none' | 'several' }[];
    undated: string[];
  }
  interface GigSheetData {
    url: string;
    lastRun: SheetReport | null;
    links: Record<string, string>;
    members: { email: string; name: string }[];
  }
  const gigSheet = $derived((page.data.gigSheet ?? null) as GigSheetData | null);
  const sheetError = $derived((page.form?.sheetError ?? null) as string | null);
  let syncing = $state(false);
  let sheetOpen = $state(false);
  const lastRun = $derived(gigSheet?.lastRun ?? null);

  function sheetSummary(r: SheetReport): string {
    if (!r.ok) return 'Last sync failed';
    const bits = [
      `${r.created.length} new gig${r.created.length === 1 ? '' : 's'}`,
      `${r.rsvpCount} RSVP${r.rsvpCount === 1 ? '' : 's'} set`,
    ];
    if (r.conflicts) bits.push(`${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'}`);
    if (r.canceled.length) bits.push(`${r.canceled.length} canceled`);
    if (r.unmatched.length) bits.push(`${r.unmatched.length} unlinked player${r.unmatched.length === 1 ? '' : 's'}`);
    return bits.join(' · ');
  }

  // The signed-in member's own replies, by gig id (from the layout load).
  const myRsvps = $derived((page.data.myRsvps ?? {}) as Record<string, RsvpStatus>);

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

  // The signed-in member's reply per day, for the calendar ✓/?/✗ marks. When a
  // day holds more than one gig, the strongest reply wins (Yes > Maybe > No).
  const RANK: Record<RsvpStatus, number> = { yes: 3, maybe: 2, no: 1 };
  const rsvpByDate = $derived.by(() => {
    const m = new Map<string, RsvpStatus>();
    for (const g of gigs) {
      if (!isValidDate(g.date)) continue;
      const s = myRsvps[g.id];
      if (!s) continue;
      const cur = m.get(g.date);
      if (!cur || RANK[s] > RANK[cur]) m.set(g.date, s);
    }
    return m;
  });

  // Future, non-canceled, dated gigs the member still hasn't replied to — the
  // bold reminder at the top of the list links straight to each.
  const unconfirmed = $derived(
    upcoming.filter((g) => isValidDate(g.date) && !g.canceled && !myRsvps[g.id])
  );

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
    <div class="head-actions">
      <!-- What the public sees. Opens in its own tab: /shows is a standalone,
           band-branded page with no way back into the app. -->
      <a class="shows-link" href="/shows" target="_blank" rel="noopener">Public shows page ↗</a>
      {#if gigSheet}
        <form
          method="POST"
          action="?/syncSheet"
          use:enhance={() => {
            syncing = true;
            return async ({ update }) => {
              await update({ reset: false });
              syncing = false;
              sheetOpen = true;
            };
          }}
        >
          <button type="submit" class="sync" disabled={syncing || !gigSheet.url}
            title={gigSheet.url ? 'Import new gigs and Yes replies from the Gig sheet' : 'Save the Gig sheet link below first'}
          >{syncing ? 'Syncing…' : '⟳ Sync Gig Sheet'}</button>
        </form>
      {/if}
      {#if canEdit}
        <form method="POST" action="?/create" use:enhance>
          <button type="submit" class="new">+ New gig</button>
        </form>
      {/if}
    </div>
  </header>

  {#if gigSheet}
    <details class="sheet-panel" open={sheetOpen || !gigSheet.url || undefined}>
      <summary>
        <strong>Gig sheet sync</strong>
        {#if lastRun}
          <span class:bad={!lastRun.ok}>
            {sheetSummary(lastRun)} · {formatPacificDateTime(lastRun.at)}{lastRun.trigger === 'daily' ? ' (daily)' : ''}
          </span>
        {:else}
          <span>Not run yet. Runs daily once a sheet link is saved.</span>
        {/if}
      </summary>

      <form
        class="sheet-url"
        method="POST"
        action="?/syncSheet"
        use:enhance={() => {
          syncing = true;
          return async ({ update }) => {
            await update({ reset: false });
            syncing = false;
            sheetOpen = true;
          };
        }}
      >
        <label for="sheet-url">Sheet link (include the tab's <code>#gid=</code>)</label>
        <div class="row">
          <input id="sheet-url" name="url" type="url" value={gigSheet.url}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…" />
          <button type="submit" class="sync" disabled={syncing}>{syncing ? 'Syncing…' : 'Save & sync'}</button>
        </div>
        <p class="hint">
          Runs daily. Sheet gigs missing here are added, marked “Imported from Gig sheet” (public unless the sheet
          says “private”); gigs are never deleted. Sheet yes/no answers fill in members who haven't replied on the
          website; a website reply always wins, and disagreements are flagged “Gig Sheet Conflict” on the gig.
        </p>
      </form>
      {#if sheetError}<p class="bad">{sheetError}</p>{/if}

      {#if lastRun}
        {#if !lastRun.ok}
          <p class="bad">{lastRun.error}</p>
        {/if}
        {#if lastRun.created.length}
          <h4>Added</h4>
          <ul>
            {#each lastRun.created as g (g.gigId)}
              <li><a href={`/gigs/${g.gigId}`}>{g.name}</a> · {formatGigDate(g.date)}</li>
            {/each}
          </ul>
        {/if}
        {#if lastRun.canceled.length}
          <h4>Marked canceled</h4>
          <ul>
            {#each lastRun.canceled as g (g.gigId)}
              <li><a href={`/gigs/${g.gigId}`}>{g.name}</a> · {formatGigDate(g.date)}</li>
            {/each}
          </ul>
        {/if}
        {#if lastRun.rsvps.length}
          <h4>RSVPs set ({lastRun.rsvpCount})</h4>
          {#if lastRun.rsvpCount > lastRun.rsvps.length}<p class="hint">Showing the first {lastRun.rsvps.length}.</p>{/if}
          <ul>
            {#each lastRun.rsvps as r, i (i)}
              <li>{r.member}: {r.status === 'yes' ? 'Yes' : 'No'} for <a href={`/gigs/${r.gigId}`}>{r.gigName}</a></li>
            {/each}
          </ul>
        {/if}
        {#if lastRun.ambiguous.length}
          <h4>Not sure which gig</h4>
          <p class="hint">These sheet columns match more than one gig on the same day, so they were left alone.</p>
          <ul>
            {#each lastRun.ambiguous as a, i (i)}
              <li>{formatGigDate(a.date)}: {a.header}</li>
            {/each}
          </ul>
        {/if}
        {#if lastRun.unmatched.length}
          <h4>Players to link</h4>
          <p class="hint">
            These sheet names didn't match exactly one member, so their answers were skipped. Pick who each one is,
            then sync again.
          </p>
          <ul class="links">
            {#each lastRun.unmatched as p (p.key)}
              <li>
                <form method="POST" action="?/linkPlayer" use:enhance={() => async ({ update }) => {
                  sheetOpen = true; // keep the panel open through the reload
                  await update({ reset: false });
                }}>
                  <input type="hidden" name="key" value={p.key} />
                  <span class="who">
                    {p.name}{p.instrument ? ` (${p.instrument})` : ''}
                    {#if p.reason === 'several'}<em>· several members match</em>{/if}
                  </span>
                  <select name="email" value={gigSheet.links[p.key] ?? ''}>
                    <option value="">Not linked</option>
                    {#each gigSheet.members as m (m.email)}
                      <option value={m.email}>{m.name}</option>
                    {/each}
                  </select>
                  <button type="submit" class="small">Save</button>
                </form>
              </li>
            {/each}
          </ul>
        {/if}
        {#if lastRun.undated.length}
          <p class="hint">Skipped {lastRun.undated.length} column{lastRun.undated.length === 1 ? '' : 's'} with no readable date.</p>
        {/if}
      {/if}
    </details>
  {/if}

  {#if unconfirmed.length > 0}
    <div class="rsvp-reminder" role="status">
      <strong>
        You haven't RSVP'd for {unconfirmed.length} upcoming gig{unconfirmed.length === 1 ? '' : 's'}:
      </strong>
      <ul>
        {#each unconfirmed as g (g.id)}
          <li><a href={`/gigs/${g.id}`}>{g.name} · {formatGigDate(g.date)}</a></li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if gigs.length > 0}
    <div class="calendars">
      {#each months as m (`${m.year}-${m.month}`)}
        <MonthCalendar year={m.year} month={m.month} {gigsByDate} {rsvpByDate} {today} />
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
            {#if gig.importedFrom === 'gig-sheet'}<span class="import-badge" title="Imported from Gig sheet">Imported</span>{/if}
            {#if offlineIds.has(gig.id)}<span class="offline-badge" title="Saved for offline">⤓ Offline</span>{/if}
          </h3>
          <p class="when">{formatGigDate(gig.date)}</p>
          {#if gig.callTime}
            <p class="meta call">Call time {formatGigTime(gig.callTime)}</p>
          {/if}
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

  .head-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  /* Secondary to "+ New gig": a way to check what the public sees, not a primary
     action. Sized to be tappable on a tablet all the same. */
  .shows-link {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--accent-strong);
    font-weight: 700;
    font-size: 0.82rem;
    text-decoration: none;
    white-space: nowrap;
  }

  .shows-link:hover {
    border-color: var(--accent-strong);
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

  .sync {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--panel);
    color: var(--accent-strong);
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .sync:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .sheet-panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 0.9rem;
  }

  .sheet-panel summary {
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
    min-height: 32px;
  }

  .sheet-panel summary span {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .sheet-panel h4 {
    margin: 14px 0 4px;
    font-size: 0.9rem;
  }

  .sheet-panel ul {
    margin: 0;
    padding-left: 20px;
  }

  .sheet-panel .bad {
    color: #b3261e;
    font-weight: 600;
  }

  .sheet-url {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sheet-url label {
    font-weight: 700;
    font-size: 0.82rem;
  }

  .sheet-url .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sheet-url input {
    flex: 1 1 280px;
    min-height: 40px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    font: inherit;
  }

  .hint {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 2px 0 0;
  }

  .links {
    list-style: none;
    padding: 0 !important;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .links form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .links .who {
    min-width: 160px;
  }

  .links select {
    min-height: 40px;
    border-radius: 6px;
    border: 1px solid var(--line);
    font: inherit;
  }

  .small {
    min-height: 40px;
    padding: 0 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--panel);
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
  }

  .import-badge {
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #2f5d62;
    background: #eaf1f1;
    border: 1px solid #b9d3d3;
    border-radius: 999px;
    padding: 1px 8px;
    vertical-align: middle;
    margin-left: 6px;
    white-space: nowrap;
  }

  .rsvp-reminder {
    background: #fff7e6;
    border: 1px solid #f0c674;
    border-left: 4px solid #b26a00;
    border-radius: 8px;
    padding: 12px 16px;
    color: #4a3a16;
  }

  .rsvp-reminder strong {
    font-size: 0.95rem;
  }

  .rsvp-reminder ul {
    margin: 8px 0 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .rsvp-reminder a {
    color: #8a5200;
    font-weight: 600;
    text-decoration: none;
  }

  .rsvp-reminder a:hover {
    text-decoration: underline;
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

  .meta.call {
    color: var(--accent-strong);
    font-weight: 600;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
    white-space: nowrap;
  }
</style>
