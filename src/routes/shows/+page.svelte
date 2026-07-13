<script lang="ts">
  // The band's public show listing — the one page anyone can see without signing
  // in. It is deliberately standalone: no app chrome, no links into the library
  // (the root layout suppresses its nav here), and its only navigation goes back
  // to the band's own site. Styling mirrors mutinybaybrassband.com's theme —
  // black/red, Playfair Display over Source Sans 3 — so arriving from there, or
  // leaving for it, doesn't feel like a different band.
  import { browser } from '$app/environment';
  import { formatGigDate, formatGigTimeRange, mapsUrl, urlHost, type PublicShow } from '$lib/gig';

  let { data }: { data: { upcoming: PublicShow[]; past: PublicShow[]; feedUrl: string } } = $props();

  const SITE = 'https://mutinybaybrassband.com';

  // Google takes the https feed URL directly; Apple/Outlook want the webcal
  // scheme, which is what makes the OS offer to *subscribe* rather than download
  // a one-off copy that never updates again.
  const googleUrl = $derived(
    `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(data.feedUrl)}`
  );
  const webcalUrl = $derived(data.feedUrl.replace(/^https?:/, 'webcal:'));

  let copied = $state(false);
  async function copyFeed() {
    if (!browser) return;
    try {
      await navigator.clipboard.writeText(data.feedUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard blocked (insecure context, or the user said no) — the URL is
      // on screen and selectable, so this is a convenience, not the only way.
    }
  }

  /** A show's venue line, or '' when we only know the date. */
  function venue(show: PublicShow): string {
    return [show.location?.name, show.location?.address].filter(Boolean).join(' · ');
  }

  // Schema.org MusicEvent data, so a search engine can show these as events
  // rather than just a page of text. Only upcoming shows: a past gig as a
  // "result" helps nobody.
  const jsonLd = $derived(
    JSON.stringify(
      data.upcoming.map((show) => ({
        '@context': 'https://schema.org',
        '@type': 'MusicEvent',
        name: show.name,
        startDate: show.times?.length ? `${show.date}T${show.times[0].start}:00-08:00` : show.date,
        eventStatus: show.canceled
          ? 'https://schema.org/EventCancelled'
          : 'https://schema.org/EventScheduled',
        performer: { '@type': 'MusicGroup', name: 'Mutiny Bay Brass Band', url: SITE },
        ...(show.location
          ? {
              location: {
                '@type': 'Place',
                name: show.location.name ?? show.location.address,
                ...(show.location.address
                  ? { address: { '@type': 'PostalAddress', streetAddress: show.location.address } }
                  : {}),
              },
            }
          : {}),
        ...(show.publicNotes ? { description: show.publicNotes } : {}),
        ...(show.eventUrl ? { url: show.eventUrl } : {}),
      }))
      // Escape '<' so the payload can never break out of the <script> tag.
    ).replace(/</g, '\\u003c')
  );
</script>

<svelte:head>
  <title>Shows — Mutiny Bay Brass Band</title>
  <meta
    name="description"
    content="Upcoming and past performances by the Mutiny Bay Brass Band, a community brass band on Whidbey Island, WA. Subscribe to the show calendar."
  />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Sans+3:wght@400;600;700&display=swap"
  />
  {@html `<script type="application/ld+json">${jsonLd}</` + `script>`}
</svelte:head>

<div class="shows-page">
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href={SITE}>
        <enhanced:img class="logo" src="$lib/assets/mbbb-logo.png?w=160" alt="" />
        <span class="site-title">Mutiny Bay <span class="accent">Brass Band</span></span>
      </a>
      <nav class="primary-nav" aria-label="Band site">
        <ul>
          <li><a href={SITE}>Home</a></li>
          <li><a href="{SITE}/#about">About</a></li>
          <li><a class="current" href="/shows" aria-current="page">Shows</a></li>
          <li><a href="{SITE}/#gallery">Gallery</a></li>
          <li><a href="{SITE}/#videos">Videos</a></li>
          <li><a href="{SITE}/#contact">Contact</a></li>
        </ul>
      </nav>
    </div>
  </header>

  <main class="container">
    <h1 class="page-title">Shows</h1>
    <p class="tagline">Whidbey Island, WA</p>

    <!-- Subscribe: the whole point of the page for anyone who wants to keep up.
         A subscription auto-updates when a show moves; the per-show buttons on
         a gig page are one-time copies. -->
    <section class="subscribe" aria-labelledby="sub-h">
      <h2 id="sub-h">Never miss a show</h2>
      <p>
        Subscribe to our calendar and every show below lands in your own — and stays right when
        something moves.
      </p>
      <div class="sub-actions">
        <a class="btn btn-primary" href={googleUrl} target="_blank" rel="noopener">
          Add to Google Calendar
        </a>
        <a class="btn btn-outline" href={webcalUrl}>Add to Apple Calendar or Outlook</a>
      </div>
      <p class="feed">
        <span class="feed-label">Or paste this into any calendar app:</span>
        <code>{data.feedUrl}</code>
        <button type="button" class="copy" onclick={copyFeed}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
    </section>

    <section aria-labelledby="up-h">
      <h2 id="up-h" class="section-title">Upcoming</h2>
      {#if data.upcoming.length === 0}
        <p class="empty">
          No shows on the books just yet. Subscribe above, or
          <a href="{SITE}/#contact">get in touch about booking us</a>.
        </p>
      {:else}
        <ul class="show-list">
          {#each data.upcoming as show (show.id)}
            <li class="show" class:canceled={show.canceled}>
              <div class="date">
                <span class="date-text">{formatGigDate(show.date)}</span>
                {#if show.canceled}<span class="cancel-badge">Canceled</span>{/if}
              </div>
              <div class="body">
                <h3>{show.name}</h3>
                {#if show.times?.length}
                  <p class="times">
                    {#each show.times as t, i (i)}
                      <span>{formatGigTimeRange(t)}</span>
                    {/each}
                  </p>
                {/if}
                {#if venue(show)}
                  <p class="venue">
                    {venue(show)}
                    {#if show.location?.address}
                      <a href={mapsUrl(show.location.address)} target="_blank" rel="noopener">Map ↗</a>
                    {/if}
                  </p>
                {/if}
                {#if show.publicNotes}<p class="blurb">{show.publicNotes}</p>{/if}
                {#if show.eventUrl}
                  <p class="event-link">
                    <a href={show.eventUrl} target="_blank" rel="noopener">
                      Full event details at {urlHost(show.eventUrl)} ↗
                    </a>
                  </p>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if data.past.length > 0}
      <section aria-labelledby="past-h">
        <h2 id="past-h" class="section-title">Past shows</h2>
        <ul class="show-list past">
          {#each data.past as show (show.id)}
            <li class="show" class:canceled={show.canceled}>
              <div class="date">
                <span class="date-text">{formatGigDate(show.date)}</span>
                {#if show.canceled}<span class="cancel-badge">Canceled</span>{/if}
              </div>
              <div class="body">
                <h3>{show.name}</h3>
                {#if venue(show)}<p class="venue">{venue(show)}</p>{/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>
        <a href={SITE}>← mutinybaybrassband.com</a>
      </p>
      <p class="member">Band member? <a href="/">Sign in to the music library</a>.</p>
    </div>
  </footer>
</div>

<style>
  /* The band site's theme (mutinybaybrassband.com/wp-content/themes/mutiny-bay-theme),
     scoped to this page so it can't bleed into the app's own look. */
  .shows-page {
    --red: #cc0000;
    --red-dark: #8b0000;
    --red-light: #ff2222;
    --black: #0a0a0a;
    --charcoal: #1a1a1a;
    --light-gray: #bbbbbb;
    --off-white: #f2ede8;
    --white: #ffffff;
    --font-display: 'Playfair Display', Georgia, serif;
    --font-body: 'Source Sans 3', 'Helvetica Neue', sans-serif;
    --radius: 4px;
    --transition: 0.25s ease;

    background: var(--black);
    color: var(--off-white);
    font-family: var(--font-body);
    font-size: 17px;
    line-height: 1.7;
    min-height: 100vh;
  }

  .shows-page :global(h1),
  .shows-page h2,
  .shows-page h3 {
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1.2;
    color: var(--white);
  }

  .container {
    max-width: 1140px;
    margin: 0 auto;
    padding: 0 1.5rem;
  }

  /* --- Header ------------------------------------------------------------- */

  .site-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(10, 10, 10, 0.97);
    border-bottom: 2px solid var(--red);
    backdrop-filter: blur(6px);
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
    padding: 0.85rem 1.5rem;
    max-width: 1140px;
    margin: 0 auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    text-decoration: none;
  }

  .logo {
    width: 48px;
    height: auto;
    border-radius: 50%;
    flex: 0 0 auto;
  }

  .site-title {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 900;
    color: var(--white);
    letter-spacing: 0.02em;
    line-height: 1.1;
  }

  .site-title .accent {
    color: var(--red);
  }

  .primary-nav ul {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    margin: 0;
    padding: 0;
  }

  .primary-nav a {
    color: var(--light-gray);
    font-size: 0.95rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-decoration: none;
    transition: color var(--transition);
  }

  .primary-nav a:hover {
    color: var(--red-light);
  }

  .primary-nav a.current {
    color: var(--red-light);
  }

  /* --- Page head ---------------------------------------------------------- */

  main {
    padding-top: 3.5rem;
    padding-bottom: 4rem;
  }

  .page-title {
    font-size: clamp(2.4rem, 5vw, 4rem);
    margin: 0;
  }

  .tagline {
    color: var(--light-gray);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.82rem;
    font-weight: 600;
    margin: 0 0 2.5rem;
  }

  .section-title {
    font-size: clamp(1.8rem, 3vw, 2.4rem);
    margin: 3.5rem 0 1.75rem;
    padding-bottom: 0.75rem;
    position: relative;
  }

  .section-title::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 64px;
    height: 3px;
    background: var(--red);
  }

  /* --- Subscribe panel ---------------------------------------------------- */

  .subscribe {
    background: var(--charcoal);
    border-left: 3px solid var(--red);
    border-radius: var(--radius);
    padding: 1.75rem;
  }

  .subscribe h2 {
    font-size: 1.5rem;
    margin: 0 0 0.35rem;
  }

  .subscribe p {
    color: var(--light-gray);
    margin: 0 0 1.25rem;
    max-width: 62ch;
  }

  .sub-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .btn {
    display: inline-block;
    padding: 0.85rem 1.6rem;
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
    border-radius: var(--radius);
    border: 2px solid transparent;
    transition: all var(--transition);
    cursor: pointer;
    /* Tablet-friendly: these get tapped on a phone in a parking lot. */
    min-height: 48px;
  }

  .btn-primary {
    background: var(--red);
    color: var(--white);
    border-color: var(--red);
  }

  .btn-primary:hover {
    background: var(--red-dark);
    border-color: var(--red-dark);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(204, 0, 0, 0.45);
  }

  .btn-outline {
    background: transparent;
    color: var(--white);
    border-color: var(--white);
  }

  .btn-outline:hover {
    background: var(--white);
    color: var(--black);
  }

  .feed {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin: 1.5rem 0 0;
    font-size: 0.85rem;
  }

  .feed-label {
    color: var(--light-gray);
  }

  .feed code {
    font-size: 0.82rem;
    color: var(--off-white);
    background: rgba(255, 255, 255, 0.07);
    padding: 0.35rem 0.6rem;
    border-radius: var(--radius);
    word-break: break-all;
  }

  .copy {
    min-height: 34px;
    padding: 0 0.9rem;
    border-radius: var(--radius);
    border: 1px solid var(--light-gray);
    background: transparent;
    color: var(--off-white);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }

  .copy:hover {
    border-color: var(--white);
    color: var(--white);
  }

  /* --- Show list ---------------------------------------------------------- */

  .show-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .show {
    display: grid;
    grid-template-columns: minmax(190px, 220px) 1fr;
    gap: 1.5rem;
    padding: 1.5rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .date {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }

  .date-text {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--red-light);
  }

  .show.canceled .date-text,
  .show.canceled h3 {
    text-decoration: line-through;
    opacity: 0.65;
  }

  .cancel-badge {
    text-transform: uppercase;
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--white);
    background: var(--red-dark);
    border-radius: 999px;
    padding: 2px 9px;
  }

  .show h3 {
    font-size: 1.35rem;
    margin: 0 0 0.35rem;
  }

  .show p {
    margin: 0.2rem 0 0;
    color: var(--light-gray);
  }

  .times span + span::before {
    content: ', ';
  }

  .venue a {
    margin-left: 0.5rem;
    color: var(--red-light);
    text-decoration: none;
    white-space: nowrap;
  }

  .venue a:hover {
    color: var(--white);
  }

  .blurb {
    margin-top: 0.6rem;
    color: var(--off-white);
    max-width: 68ch;
  }

  .event-link {
    margin-top: 0.5rem;
  }

  .event-link a {
    color: var(--red-light);
    text-decoration: none;
    font-weight: 600;
    /* Tapped on a phone, outdoors, deciding whether to go — give it room. */
    display: inline-block;
    padding: 0.35rem 0;
  }

  .event-link a:hover {
    color: var(--white);
  }

  /* Past shows are reference, not a pitch — quieter, tighter. */
  .past .show {
    padding: 1rem 0;
    opacity: 0.78;
  }

  .past .show h3 {
    font-size: 1.1rem;
    margin: 0;
  }

  .past .date-text {
    font-size: 1rem;
    color: var(--light-gray);
  }

  .empty {
    color: var(--light-gray);
  }

  .empty a,
  .member a {
    color: var(--red-light);
    text-decoration: none;
  }

  .empty a:hover,
  .member a:hover {
    color: var(--white);
  }

  /* --- Footer ------------------------------------------------------------- */

  .site-footer {
    background: var(--charcoal);
    border-top: 2px solid var(--red);
    padding: 2.5rem 0;
  }

  .site-footer p {
    margin: 0;
  }

  .site-footer a {
    color: var(--red-light);
    text-decoration: none;
    font-weight: 600;
  }

  .site-footer a:hover {
    color: var(--white);
  }

  .member {
    margin-top: 0.75rem !important;
    font-size: 0.85rem;
    color: var(--light-gray);
  }

  @media (max-width: 700px) {
    .show {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }

    .date {
      flex-direction: row;
      align-items: center;
    }

    .primary-nav ul {
      gap: 0.9rem;
    }

    .primary-nav a {
      font-size: 0.8rem;
      letter-spacing: 0.05em;
    }

    .sub-actions .btn {
      flex: 1 1 100%;
      text-align: center;
    }
  }
</style>
