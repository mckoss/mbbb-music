<script lang="ts">
  import { INSTRUMENT_CHOICES, instrumentLabel } from '$lib/members';
  import { isMapCoordinate, type MemberLocation } from '$lib/member-map';
  import MemberMap from '$lib/components/MemberMap.svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { formatPacificDateTime } from '$lib/time';
  import { SvelteSet } from 'svelte/reactivity';
  import type { SubmitFunction } from '@sveltejs/kit';

  let { data } = $props();

  // Contacts-sheet import (admins only; null for everyone else).
  const contacts = $derived(data.contactsSheet);
  const contactsRun = $derived(contacts?.lastRun ?? null);
  const contactsError = $derived((page.form?.contactsError ?? null) as string | null);
  let syncingContacts = $state(false);
  let contactsOpen = $state(false);
  const added = new SvelteSet<string>();
  const syncContacts: SubmitFunction = () => {
    syncingContacts = true;
    return async ({ update }) => {
      await update({ reset: false });
      syncingContacts = false;
      contactsOpen = true;
    };
  };

  type Member = (typeof data.members)[number];

  const active = $derived(data.members.filter((m) => !m.isFormer));
  const former = $derived(data.members.filter((m) => m.isFormer));
  const mappedMembers = $derived(
    active.flatMap((member): MemberLocation[] =>
      member.address && isMapCoordinate(member.latitude, member.longitude)
        ? [{
            name: member.name,
            address: member.address,
            latitude: member.latitude!,
            longitude: member.longitude!,
            instrumentSlug: member.instrumentSlug,
          }]
        : [])
  );

  // A representative glyph per instrument (zero-asset, cross-platform). Brass
  // share the trumpet glyph; reeds/woodwinds and percussion get their own.
  const EMOJI: Record<string, string> = {
    'alto-sax': '🎷',
    'soprano-sax': '🎷',
    'tenor-sax': '🎷',
    'bari-sax': '🎷',
    clarinet: '🪈',
    flute: '🪈',
    trumpet: '🎺',
    mellophone: '🎺',
    'french-horn': '🎺',
    'alto-horn': '🎺',
    trombone: '🎺',
    euphonium: '🎺',
    tuba: '🎺',
    melodica: '🎹',
    drums: '🥁',
  };
  const glyph = (slug: string | null) => (slug && EMOJI[slug]) || '🎵';

  // Instruments with an isolated sprite in /static/instruments (the rest fall
  // back to the emoji glyph).
  const HAS_IMG = new Set([
    'alto-horn', 'alto-sax', 'bari-sax', 'clarinet', 'drums', 'euphonium', 'flute',
    'french-horn', 'mellophone', 'melodica', 'soprano-sax', 'tenor-sax', 'trombone',
    'trumpet', 'tuba',
  ]);

  const ORDER = new Map(INSTRUMENT_CHOICES.map((i, idx) => [i.slug, idx]));

  // Active members grouped into instrument sections, in canonical instrument
  // order; members with no instrument fall into a trailing "No instrument" group.
  const sections = $derived.by(() => {
    const groups = new Map<string, Member[]>();
    for (const m of active) {
      const key = m.instrumentSlug ?? '';
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }
    return [...groups.keys()]
      .sort((a, b) => {
        if (a === b) return 0;
        if (a === '') return 1;
        if (b === '') return -1;
        return (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999);
      })
      .map((key) => ({
        slug: key || null,
        label: key ? instrumentLabel(key) ?? key : 'No instrument listed',
        glyph: glyph(key || null),
        members: groups.get(key)!,
      }));
  });
</script>

{#snippet card(m: Member, withInstrument: boolean)}
  <li>
    <a class="card" href={`/members/${encodeURIComponent(m.email)}`}>
      <img
        class="avatar"
        src={`/members/${encodeURIComponent(m.email)}/avatar?v=${encodeURIComponent(m.avatarRev)}`}
        alt={m.name}
        loading="lazy"
      />
      <span class="name">{m.name}</span>
      {#if withInstrument && m.instrumentSlug && HAS_IMG.has(m.instrumentSlug)}
        <img class="card-inst" src={`/instruments/${m.instrumentSlug}.png`} alt={m.instrument ?? ''} title={m.instrument ?? ''} />
      {/if}
      {#if m.tenure}<span class="tenure">{m.tenure}</span>{/if}
    </a>
  </li>
{/snippet}

{#snippet formerGrid()}
  {#if former.length}
    <div class="divider"><span>Former members</span></div>
    <ul class="grid former">
      {#each former as m (m.email)}{@render card(m, true)}{/each}
    </ul>
  {/if}
{/snippet}

<section class="roster">
  <header>
    <p class="kicker">Members</p>
    <h2>Band roster</h2>
    <div class="bar">
      <p class="count">
        {active.length} active{#if former.length} · {former.length} former{/if}
      </p>
      {#if contacts}
        <form method="POST" action="?/syncContacts" use:enhance={syncContacts}>
          <button type="submit" class="sync" disabled={syncingContacts}>
            {syncingContacts ? 'Syncing…' : '⟳ Sync Contacts'}
          </button>
        </form>
      {/if}
    </div>
  </header>

  {#if contacts}
    <details class="sheet-panel" open={contactsOpen || undefined}>
      <summary>
        <strong>Contacts sync</strong>
        {#if contactsRun}
          <span class:bad={!contactsRun.ok}>
            {#if contactsRun.ok}
              {contactsRun.rows} contacts · {contactsRun.updated.length}
              profile{contactsRun.updated.length === 1 ? '' : 's'} filled in ·
              {contactsRun.notOnSite.length} not on the site
            {:else}Last sync failed{/if}
            · {formatPacificDateTime(contactsRun.at)}
          </span>
        {:else}
          <span>Not run yet.</span>
        {/if}
      </summary>

      <form class="sheet-url" method="POST" action="?/syncContacts" use:enhance={syncContacts}>
        <label for="contacts-url">Contacts tab link (optional)</label>
        <div class="row">
          <input id="contacts-url" name="url" type="url" value={contacts.url}
            placeholder="Blank: the “Contacts” tab of the Gig sheet" />
          <button type="submit" class="sync" disabled={syncingContacts}>{syncingContacts ? 'Syncing…' : 'Save & sync'}</button>
        </div>
        <p class="hint">
          Fills in only profile fields nobody has entered on the website (name, phone, instrument, shirt size,
          alternate email). Website entries always win; differences are listed below.
        </p>
      </form>
      {#if contactsError}<p class="bad">{contactsError}</p>{/if}

      {#if contactsRun}
        {#if !contactsRun.ok}<p class="bad">{contactsRun.error}</p>{/if}
        {#if contactsRun.updated.length}
          <h4>Filled in</h4>
          <ul>
            {#each contactsRun.updated as u (u.email)}
              <li><a href={`/members/${encodeURIComponent(u.email)}`}>{u.member}</a>: {u.fields.join(', ')}</li>
            {/each}
          </ul>
        {/if}
        {#if contactsRun.differences.length}
          <h4>Website differs from the sheet (website kept)</h4>
          <ul>
            {#each contactsRun.differences as d, i (i)}
              <li>
                <a href={`/members/${encodeURIComponent(d.email)}`}>{d.member}</a> · {d.field}:
                website “{d.site}”, sheet “{d.sheet}”
              </li>
            {/each}
          </ul>
        {/if}
        {#if contactsRun.notOnSite.length}
          <h4>Not on the site yet</h4>
          <p class="hint">Adding someone lets them sign in with that Google account; sync again to fill their profile.</p>
          <ul class="links">
            {#each contactsRun.notOnSite as c, i (i)}
              <li>
                <span class="who">{c.name}{c.instrument ? ` (${c.instrument})` : ''}</span>
                {#if c.email && !added.has(c.email)}
                  <form method="POST" action="?/addMember"
                    use:enhance={() => async ({ result, update }) => {
                      if (result.type === 'success') added.add(c.email!);
                      contactsOpen = true; // keep the panel open through the reload
                      await update({ reset: false });
                    }}>
                    <input type="hidden" name="email" value={c.email} />
                    <button type="submit" class="small">Add {c.email} as member</button>
                  </form>
                {:else if c.email}
                  <em>Added</em>
                {:else}
                  <em>No email in the sheet</em>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if contactsRun.ambiguous.length}
          <h4>Matches several members (skipped)</h4>
          <ul>{#each contactsRun.ambiguous as a, i (i)}<li>{a.name}</li>{/each}</ul>
        {/if}
      {/if}
    </details>
  {/if}

  <div class="map-section">
    <MemberMap members={mappedMembers} gigs={data.gigs} />
    <p class="map-note">
      Member homes, recent and upcoming gigs. Tap a dot or data block for Google Maps driving directions.
      The street map is stored on this device for offline use.
    </p>
  </div>

  {#each sections as sec (sec.slug ?? 'none')}
    <div class="section">
      <h3 class="section-head">
        {#if sec.slug && HAS_IMG.has(sec.slug)}
          <img class="glyph-img" src={`/instruments/${sec.slug}.png`} alt="" aria-hidden="true" />
        {:else}
          <span class="glyph" aria-hidden="true">{sec.glyph}</span>
        {/if}
        {sec.label} <span class="n">{sec.members.length}</span>
      </h3>
      <ul class="grid">
        {#each sec.members as m (m.email)}{@render card(m, false)}{/each}
      </ul>
    </div>
  {/each}
  {@render formerGrid()}

  {#if !active.length && !former.length}
    <p class="empty">No members yet.</p>
  {/if}
</section>

<style>
  .roster {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  .kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.72rem;
    font-weight: 800;
    color: var(--accent-strong);
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
    margin-bottom: 18px;
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
    min-width: 0;
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

  .links li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .links .who {
    min-width: 160px;
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
    overflow-wrap: anywhere;
    text-align: left;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .map-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 6px;
  }

  .map-note {
    color: var(--muted);
    font-size: 0.75rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--accent);
    margin-bottom: 12px;
  }

  .glyph {
    font-size: 1.4rem;
    line-height: 1;
  }

  .glyph-img {
    height: 66px;
    width: auto;
    object-fit: contain;
  }

  .section-head .n {
    color: var(--muted);
    font-weight: 600;
    font-size: 0.82rem;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 18px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    padding: 14px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    color: var(--ink);
    text-decoration: none;
    cursor: pointer;
  }

  .card:hover {
    border-color: var(--accent-strong);
  }

  .avatar {
    width: 144px;
    height: 144px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--line);
    background: #efece3;
  }

  .name {
    font-weight: 700;
    font-size: 0.92rem;
    word-break: break-word;
  }

  .card-inst {
    height: 40px;
    width: auto;
    object-fit: contain;
  }

  .tenure {
    color: var(--muted);
    font-size: 0.78rem;
  }

  /* Labeled separator before former members. */
  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .former .card .avatar {
    filter: grayscale(0.35);
    opacity: 0.9;
  }

  .empty {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
