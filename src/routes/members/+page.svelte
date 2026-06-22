<script lang="ts">
  import { page } from '$app/state';
  import { INSTRUMENT_CHOICES, instrumentLabel } from '$lib/members';

  let { data } = $props();

  type Member = (typeof data.members)[number];

  const active = $derived(data.members.filter((m) => !m.isFormer));
  const former = $derived(data.members.filter((m) => m.isFormer));

  // View is URL-driven (shareable, survives reload). Default: by seniority.
  const view = $derived(page.url.searchParams.get('view') === 'instrument' ? 'instrument' : 'seniority');

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
      <div class="toggle" role="tablist" aria-label="Roster view">
        <a class:on={view === 'seniority'} href="/members">By seniority</a>
        <a class:on={view === 'instrument'} href="/members?view=instrument">By instrument</a>
      </div>
    </div>
  </header>

  {#if view === 'instrument'}
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
  {:else}
    {#if active.length}
      <ul class="grid">
        {#each active as m (m.email)}{@render card(m, true)}{/each}
      </ul>
    {/if}
    {@render formerGrid()}
  {/if}

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

  .toggle {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 999px;
    overflow: hidden;
  }

  .toggle a {
    padding: 8px 14px;
    font-size: 0.78rem;
    font-weight: 700;
    text-decoration: none;
    color: var(--muted);
    background: var(--panel);
  }

  .toggle a.on {
    background: var(--accent);
    color: #fffdf7;
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
