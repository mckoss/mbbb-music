<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto, pushState, replaceState } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { track } from '$lib/track';
  import type { Gig, GigSet } from '$lib/gig';
  import {
    canEditGigs,
    formatGigDate,
    formatGigTimes,
    formatGigTimeRange,
    mapsUrl,
  } from '$lib/gig';
  import type { Catalog, Tune } from '$lib/types';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import { activePdfs, activeScore, activeScoreForRun, partsForFormat } from '$lib/resolve';
  import { instrumentDisplay, partOptionLabel, partShortLabel, audioLabel } from '$lib/format';
  import { ASSIGNABLE_STATUSES } from '$lib/song-status';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import { scoreSearch } from '$lib/nav';
  import PdfPager from '$lib/components/PdfPager.svelte';
  import AudioPlayer from '$lib/components/AudioPlayer.svelte';
  import OfflineGigButton from '$lib/components/OfflineGigButton.svelte';

  const gig = $derived(page.data.gig as Gig);
  const catalog = $derived(page.data.catalog as Catalog);
  const canEdit = $derived(canEditGigs(page.data.user?.role));

  // Record a gig view from the client (the page no longer has a server load).
  // Skipped in perform mode — that's a performance, logged below. Offline views
  // are queued by the service worker and replayed when back online.
  let viewedGig = '';
  $effect(() => {
    if (!browser || page.url.searchParams.has('perform')) return;
    if (viewedGig === gig.id) return;
    viewedGig = gig.id;
    track('gig-view', gig.name, gig.id);
  });

  // Record a set run when entering it (?perform=<setId>[&mode=practice]). A
  // performance run is a real performance; a practice run is logged as a score
  // view (rehearsal), matching the score overlay's practice/performance split.
  let lastPerform = '';
  $effect(() => {
    if (!browser) return;
    const sp = page.url.searchParams;
    const setId = sp.get('perform');
    if (!setId) {
      lastPerform = '';
      return;
    }
    const mode = sp.get('mode') === 'practice' ? 'practice' : 'performance';
    const key = `${gig.id}|${setId}|${mode}`;
    if (key === lastPerform) return;
    lastPerform = key;
    track(mode === 'practice' ? 'score-view' : 'performance', gig.name, `set:${setId}`);
  });

  // Friendly, slug-based chart URLs (no raw sha in the address bar / save name).
  const assetIndex = $derived(assetIndexFor(catalog));
  const openUrl = (sha: string) => urlForSha(assetIndex, sha) ?? `/blob/${sha}`;
  // Open a chart in the in-app viewer (a back arrow returns here) rather than a
  // raw PDF in a new tab — which is a dead-end in the installed standalone PWA.
  const viewHref = (sha: string, title: string) =>
    `/view/${sha}?title=${encodeURIComponent(title)}&from=${encodeURIComponent(page.url.pathname)}`;

  // Global instrument/format (cookie/URL backed) drive every chart we resolve.
  const instrument = $derived($instrumentSlug);
  const format = $derived($printFormat as PrintFormat);

  // slug -> Tune lookup for titles and score resolution.
  const bySlug = $derived(new Map(catalog.tunes.map((t) => [t.slug, t])));
  const titleOf = (slug: string) => bySlug.get(slug)?.title ?? slug;

  // The pool an organizer/admin can add to a set: songs in a "current" status. Always /
  // Active / Learning are the assignable statuses minus the long-term Archive.
  const ADDABLE = new Set(['Always', 'Active', 'Learning']);
  const addable = $derived(
    catalog.tunes
      .filter((t) => ADDABLE.has(t.status))
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  // --- Info editing ---------------------------------------------------------
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

  // Every recording across the gig (de-duped) so offline practice has playback.
  // Audio isn't instrument-specific, so this is independent of the chosen part.
  const offlineAudioShas = $derived.by(() => {
    const seen = new Set<string>();
    for (const set of gig.sets) {
      for (const slug of set.songSlugs) {
        for (const a of bySlug.get(slug)?.audio ?? []) seen.add(a.sha256);
      }
    }
    return [...seen];
  });
  const instLabel = $derived(
    instrumentDisplay(
      catalog.instruments.find((i) => i.slug === instrument)?.label ?? instrument,
      catalog.instruments.find((i) => i.slug === instrument)?.key ?? null
    )
  );
  const fmtLabel = $derived(format === 'lyre' ? 'Lyre' : 'Letter');

  // --- Combined-PDF download box -------------------------------------------
  // The box carries its own Instrument + Format pickers so a player can build a
  // packet for a different instrument/format without disturbing their global
  // (header) choice. They default to the global selection until changed.
  let dlInstrument = $state<string | null>(null);
  let dlFormat = $state<PrintFormat | null>(null);
  const packetInstrument = $derived(dlInstrument ?? instrument);
  const packetFormat = $derived(dlFormat ?? format);

  const packetInstLabel = $derived(
    instrumentDisplay(
      catalog.instruments.find((i) => i.slug === packetInstrument)?.label ?? packetInstrument,
      catalog.instruments.find((i) => i.slug === packetInstrument)?.key ?? null
    )
  );

  // Save-name for the combined PDF.
  const packetFileName = $derived(
    `MBBB - ${gig.name} - ${packetInstLabel} (${packetFormat === 'lyre' ? 'Lyre' : 'Letter'}).pdf`
  );

  // iOS (incl. iPadOS, which reports as MacIntel with touch) ignores both the
  // server's Content-Disposition: attachment and the anchor's `download` for
  // PDFs — it previews them inline in the PWA window, a dead-end. Detect Apple
  // touch devices so we can route their download through the share sheet instead.
  function isAppleTouch(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  let downloading = $state(false);

  // On Apple touch devices, fetch the packet and hand it to the share sheet
  // (Save to Files / Mail / AirDrop) instead of letting Safari open it inline.
  // Everywhere else we let the native <a download> do its job (no preventDefault).
  async function downloadPacket(e: MouseEvent) {
    if (!isAppleTouch()) return;
    e.preventDefault();
    if (downloading) return;
    downloading = true;
    try {
      const res = await fetch(packetHref);
      if (!res.ok) throw new Error(`packet ${res.status}`);
      const file = new File([await res.blob()], packetFileName, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: packetFileName });
      } else {
        // Older iOS without file sharing — at least give them the PDF.
        window.location.href = packetHref;
      }
    } catch (err) {
      // A user-cancelled share sheet is not an error; anything else falls back
      // to opening the packet so the player still gets it.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        window.location.href = packetHref;
      }
    } finally {
      downloading = false;
    }
  }

  // The packet, one row per song (in set order, a song shared across sets shown
  // once), each carrying every matching part for the box's chosen instrument/
  // format. Songs with no chart in that instrument/format are dropped — they
  // can't be downloaded anyway. Drives the per-song checkbox list below.
  // A song resolves to EITHER a list of instrument parts OR a single full score
  // (an undifferentiated combined PDF). Parts get a part picker; a full score
  // gets a per-page picker so a player can pull just one page out of the score.
  interface PacketSong {
    slug: string;
    title: string;
    parts: { sha: string; label: string }[];
    score: { sha: string; label: string } | null;
  }
  const packetSongs = $derived.by(() => {
    const seen = new Set<string>();
    const out: PacketSong[] = [];
    for (const set of gig.sets) {
      for (const slug of set.songSlugs) {
        if (seen.has(slug)) continue;
        const tune = bySlug.get(slug);
        const list = tune ? activePdfs(tune, packetInstrument, packetFormat) : [];
        if (list.length === 0) continue;
        seen.add(slug);
        const asScore = list.length === 1 && list[0].isScore;
        out.push({
          slug,
          title: titleOf(slug),
          parts: asScore ? [] : list.map((sc) => ({ sha: sc.sha, label: sc.label })),
          score: asScore ? { sha: list[0].sha, label: list[0].label } : null,
        });
      }
    }
    return out;
  });

  // Page counts for full scores, fetched lazily (immutable per content hash, so
  // cached forever server-side). The download box is online-only; a failed fetch
  // just leaves a score without a per-page choice. `requestedPages` is a plain
  // Set (not reactive) so the effect never re-fires on its own writes.
  const requestedPages = new Set<string>();
  let pageCounts = $state<Record<string, number>>({});
  $effect(() => {
    for (const s of packetSongs) {
      const sha = s.score?.sha;
      if (!sha || requestedPages.has(sha)) continue;
      requestedPages.add(sha);
      fetch(`/render/${sha}/info`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && typeof d.pages === 'number') pageCounts[sha] = d.pages;
        })
        .catch(() => {});
    }
  });

  // Per-song customization — we track only deviations from the default (every
  // song, all parts/pages): unchecked songs, single-part pins, single-page pins.
  // State is by slug, so it survives instrument/format changes; every pin is
  // re-validated where it's used, so a stale value just falls back to "All".
  let omitSlugs = $state<Record<string, boolean>>({});
  let partPick = $state<Record<string, string>>({});
  let pagePick = $state<Record<string, string>>({});
  // The effective part choice for a parts song: a valid pinned sha, else 'all'.
  function pickFor(song: PacketSong): string {
    const p = partPick[song.slug];
    return p && song.parts.some((x) => x.sha === p) ? p : 'all';
  }
  // The effective page choice for a full-score song: a valid 1-based page, else 'all'.
  function pageFor(song: PacketSong): string {
    const n = pageCounts[song.score?.sha ?? ''] ?? 0;
    const p = pagePick[song.slug];
    const num = p ? Number(p) : NaN;
    return Number.isInteger(num) && num >= 1 && num <= n ? p : 'all';
  }

  const hasSongs = $derived(gig.sets.some((s) => s.songSlugs.length > 0));

  // How many charts the current selection will merge — mirrors the server's
  // set-order, sha-deduped assembly so the button count matches the PDF. A full
  // score counts as one chart whether all pages or a single page are kept.
  const packetCount = $derived.by(() => {
    const seen = new Set<string>();
    for (const s of packetSongs) {
      if (omitSlugs[s.slug]) continue;
      if (s.score) {
        seen.add(s.score.sha);
        continue;
      }
      const pin = pickFor(s);
      for (const p of s.parts) {
        if (pin !== 'all' && p.sha !== pin) continue;
        seen.add(p.sha);
      }
    }
    return seen.size;
  });

  // Encode only deviations onto the existing GET link, so the default packet URL
  // is unchanged and customized ones stay short: omit=slug,slug, part=slug:sha,
  // page=slug:N.
  const packetHref = $derived.by(() => {
    const base = `/gigs/${page.params.id}/packet?instrument=${encodeURIComponent(
      packetInstrument
    )}&format=${packetFormat}`;
    const omit: string[] = [];
    let pins = '';
    for (const s of packetSongs) {
      if (omitSlugs[s.slug]) {
        omit.push(s.slug);
        continue;
      }
      if (s.score) {
        const pg = pageFor(s);
        if (pg !== 'all') pins += `&page=${encodeURIComponent(`${s.slug}:${pg}`)}`;
        continue;
      }
      const pin = pickFor(s);
      if (pin !== 'all') pins += `&part=${encodeURIComponent(`${s.slug}:${pin}`)}`;
    }
    return base + (omit.length ? `&omit=${omit.map(encodeURIComponent).join(',')}` : '') + pins;
  });

  // --- Perform-set mode -----------------------------------------------------
  // Driven by the URL (?perform=<setId>&i=<index>) so it's refresh-safe and the
  // browser Back button steps out. We chain through a set's songs, paging each
  // score with the shared PdfPager, then advancing to the next song.
  type PerformMode = 'practice' | 'performance';
  interface PerformRunState {
    setId: string;
    index: number;
    mode: PerformMode;
  }
  type GigPageState = App.PageState & { performRun?: PerformRunState };

  const params = $derived(page.url.searchParams);
  const performRun = $derived((page.state as GigPageState).performRun);
  const performSetId = $derived(performRun?.setId ?? params.get('perform'));
  const performSet = $derived<GigSet | null>(
    performSetId ? gig.sets.find((s) => s.id === performSetId) ?? null : null
  );
  const iParam = $derived(performRun ? String(performRun.index) : params.get('i'));
  const performIndex = $derived(iParam && /^\d+$/.test(iParam) ? Number(iParam) : 0);
  // The full set list, in order. We keep songs with no chart in the chosen part/
  // format rather than dropping them — a player needs to see every song in the
  // set, and switching part/format must never change the count or your position
  // (a missing chart shows a placeholder, not a gap).
  const performSongs = $derived(performSet ? performSet.songSlugs : []);
  const clampedIndex = $derived(
    Math.min(Math.max(0, performIndex), Math.max(0, performSongs.length - 1))
  );
  const performSlug = $derived(performSongs[clampedIndex] ?? null);
  const performTune = $derived(performSlug ? bySlug.get(performSlug) ?? null : null);

  // Perform-mode Part + Format pickers. Instrument stays the player's global
  // choice (they're playing their instrument); here they only pick which part of
  // it and the print format. The exact part sha lets same-number alternates
  // switch within the current song; the part number still carries song-to-song.
  let performPart = $state<number | null>(null);
  let performPartSha = $state<string | null>(null);
  const performParts = $derived(performTune ? partsForFormat(performTune, instrument, format) : []);
  const performScore = $derived(
    performTune ? activeScoreForRun(performTune, instrument, format, performPartSha, performPart) : null
  );
  const performing = $derived(Boolean(performSet && performSongs.length > 0));

  // Practice vs performance run (mirrors the score overlay). Practice keeps the
  // same set chaining and tap-paging but adds the compact one-line player for
  // the current song so you can rehearse a set with audio + count-in.
  const performMode = $derived<PerformMode>(
    performRun?.mode ?? (params.get('mode') === 'practice' ? 'practice' : 'performance')
  );
  const isPractice = $derived(performMode === 'practice');

  // The current song's recordings, for the practice player. Reset the picker to
  // the first take whenever the song changes so each song starts on its default.
  const performAudios = $derived(performTune?.audio ?? []);
  let chosenAudioSha = $state<string | null>(null);
  $effect(() => {
    void performSlug;
    chosenAudioSha = performAudios[0]?.sha256 ?? null;
  });
  const practiceAudio = $derived(
    performAudios.find((a) => a.sha256 === chosenAudioSha) ?? performAudios[0] ?? null
  );

  function setPerformPart(sha: string) {
    performPartSha = sha || null;
    performPart = performParts.find((p) => p.sha256 === sha)?.partNumber ?? null;
  }
  function setPerformFormat(value: PrintFormat) {
    printFormat.set(value);
  }

  function currentSearch(): URLSearchParams {
    return new URLSearchParams(browser ? window.location.search : page.url.search);
  }

  function searchUrl(p: URLSearchParams): string {
    const qs = p.toString();
    return qs ? `?${qs}` : page.url.pathname;
  }

  function stateWith(run: PerformRunState | null): App.PageState {
    const next: GigPageState = { ...(page.state as GigPageState) };
    if (run) next.performRun = run;
    else delete next.performRun;
    return next;
  }

  function startSet(setId: string, mode: PerformMode) {
    const p = currentSearch();
    p.set('perform', setId);
    p.set('i', '0');
    if (mode === 'practice') p.set('mode', 'practice');
    else p.delete('mode');
    pushState(searchUrl(p), stateWith({ setId, index: 0, mode }));
  }

  function gotoIndex(i: number) {
    if (!performSetId) return;
    const p = currentSearch();
    const nextIndex = Math.min(Math.max(0, i), Math.max(0, performSongs.length - 1));
    p.set('perform', performSetId);
    p.set('i', String(nextIndex));
    if (performMode === 'practice') p.set('mode', 'practice');
    else p.delete('mode');
    replaceState(searchUrl(p), stateWith({ setId: performSetId, index: nextIndex, mode: performMode }));
  }
  function prevSong() {
    if (clampedIndex > 0) gotoIndex(clampedIndex - 1);
  }
  function nextSong() {
    if (clampedIndex < performSongs.length - 1) gotoIndex(clampedIndex + 1);
  }
  function donePerform() {
    const p = currentSearch();
    p.delete('perform');
    p.delete('i');
    p.delete('mode');
    replaceState(searchUrl(p), stateWith(null));
  }

  function onKey(e: KeyboardEvent) {
    if (!performing) return;
    if (e.key === 'Escape') donePerform();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if performing && performSet}
  <!-- Dark full-screen perform-set overlay, mirroring ScoreOverlay's immersive
       modes. The back arrow (top-left) is the single, consistent exit to the
       packet; Practice adds a one-line player, Perform stays chrome-light. -->
  <div class="overlay">
    {#if isPractice}
      <!-- Practice run: one clean top bar, matching the single-song practice
           layout. The compact player stretches to fill, so the set navigation
           sits flush right with Next song pinned at the very end. -->
      <div class="practice-bar">
        <button class="exit" onclick={donePerform} aria-label="Back to packet" title="Back to packet">←</button>
        <span class="pos">{clampedIndex + 1}/{performSongs.length}</span>
        {#if performAudios.length > 1}
          <select
            class="rec-sel"
            value={chosenAudioSha}
            onchange={(e) => (chosenAudioSha = e.currentTarget.value)}
            aria-label="Recording"
          >
            {#each performAudios as a (a.sha256)}
              <option value={a.sha256}>{audioLabel(a.originalName, a.museScore)}</option>
            {/each}
          </select>
        {/if}
        {#if performParts.length > 1}
          <select
            class="part-sel"
            value={performScore?.sha ?? ''}
            onchange={(e) => setPerformPart(e.currentTarget.value)}
            aria-label="Part"
          >
            {#each performParts as p (p.sha256)}
              <option value={p.sha256}>{partShortLabel(p, performParts)}</option>
            {/each}
          </select>
        {/if}
        {#if practiceAudio}
          <AudioPlayer compact sha={practiceAudio.sha256} title={performSlug ? titleOf(performSlug) : ''} />
        {:else}
          <span class="no-audio">No recording for this song.</span>
        {/if}
        <button class="ghost nav" onclick={prevSong} disabled={clampedIndex <= 0} aria-label="Previous song" title="Previous song">‹</button>
        <button class="ghost nav" onclick={nextSong} disabled={clampedIndex >= performSongs.length - 1}>Next song ›</button>
      </div>
    {:else}
      <!-- Perform: the back arrow + current title sit in a solid pill (top-left)
           so they stay visible over a white score page; it's the single exit to
           the packet. A floating cluster (top-right) holds Part/Format and song
           nav. -->
      <div class="perform-corner">
        <button class="exit" onclick={donePerform} aria-label="Back to packet" title="Back to packet">←</button>
        <span class="now-playing">
          <span class="run-mode">{performSet.name || 'Set'}</span>
          {performSlug ? titleOf(performSlug) : ''}
        </span>
      </div>
      <div class="floating">
        <span class="pos">{clampedIndex + 1}/{performSongs.length}</span>
        {#if performParts.length > 1}
          <label class="sel">
            <span class="eyebrow">Part</span>
            <select value={performScore?.sha ?? ''} onchange={(e) => setPerformPart(e.currentTarget.value)}>
              {#each performParts as p (p.sha256)}
                <option value={p.sha256}>{partOptionLabel(p, performParts)}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label class="sel">
          <span class="eyebrow">Format</span>
          <select value={format} onchange={(e) => setPerformFormat(e.currentTarget.value as PrintFormat)}>
            <option value="letter">Letter</option>
            <option value="lyre">Lyre</option>
          </select>
        </label>
        <button class="ghost nav" onclick={prevSong} disabled={clampedIndex <= 0} aria-label="Previous song" title="Previous song">‹</button>
        <button class="ghost nav" onclick={nextSong} disabled={clampedIndex >= performSongs.length - 1}>Next song ›</button>
      </div>
    {/if}
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
      {:else}
        <div class="no-chart">
          <p>No {instLabel} chart for “{performSlug ? titleOf(performSlug) : ''}”{format === 'lyre' ? ' in Lyre' : ''}.</p>
          <p class="hint">Switch your instrument or format to find a chart for this song.</p>
        </div>
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
    {#if canEdit}
      <div class="editor-actions">
        <form method="POST" action="?/duplicateGig" use:enhance>
          <button type="submit" class="edit">Duplicate packet</button>
        </form>
        <button class="edit" onclick={() => (editing = !editing)}>
          {editing ? 'Done editing' : 'Edit info'}
        </button>
      </div>
    {/if}
  </header>

  {#if editing && canEdit}
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
              <button class="practice-set" onclick={() => startSet(set.id, 'practice')}>✎ Practice set</button>
              <button class="perform" onclick={() => startSet(set.id, 'performance')}>▶ Perform set</button>
            {/if}
            {#if canEdit && gig.sets.length > 1}
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
                <a class="song-title" href={scoreSearch({ song: slug, instrument, format })}>
                  {titleOf(slug)}
                </a>
                <span class="song-tools">
                  {#if sc}
                    <a class="dl" href={viewHref(sc.sha, sc.label)} title={sc.label}>
                      Chart ↓
                    </a>
                  {:else}
                    <span class="no-chart">no chart for this instrument</span>
                  {/if}
                  {#if canEdit}
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

        {#if canEdit}
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

    {#if canEdit}
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
    audioShas={offlineAudioShas}
  />

  <!-- Downloads -->
  {#if hasSongs}
    <div class="downloads">
      <h3>Download charts</h3>
      <p class="hint">
        Pick the instrument and format for this packet — defaults to your current
        choice and doesn't change it. Uncheck songs, or pin one to a single part,
        to leave charts out of the PDF.
      </p>

      <div class="dl-pickers">
        <label class="dl-pick">
          <span>Instrument</span>
          <select value={packetInstrument} onchange={(e) => (dlInstrument = e.currentTarget.value)}>
            {#each catalog.instruments as inst (inst.slug)}
              <option value={inst.slug}>{instrumentDisplay(inst.label, inst.key)}</option>
            {/each}
          </select>
        </label>
        <label class="dl-pick">
          <span>Format</span>
          <select
            value={packetFormat}
            onchange={(e) => (dlFormat = e.currentTarget.value as PrintFormat)}
          >
            <option value="letter">Letter</option>
            <option value="lyre">Lyre</option>
          </select>
        </label>
      </div>

      {#if packetSongs.length > 0}
        {#if packetCount > 0}
          <a
            class="packet-btn"
            class:busy={downloading}
            href={packetHref}
            download={packetFileName}
            onclick={downloadPacket}
            aria-busy={downloading}
          >
            {#if downloading}
              ⏳ Preparing…
            {:else}
              ⬇ Download as one PDF ({packetCount} chart{packetCount === 1 ? '' : 's'})
            {/if}
          </a>
        {:else}
          <span class="packet-btn disabled" aria-disabled="true">⬇ No songs selected</span>
        {/if}
        <ul class="dl-list">
          {#each packetSongs as s (s.slug)}
            {@const included = !omitSlugs[s.slug]}
            {@const picked = pickFor(s)}
            {@const pages = s.score ? pageCounts[s.score.sha] ?? 0 : 0}
            {@const openSha = s.score ? s.score.sha : picked === 'all' ? s.parts[0].sha : picked}
            {@const openLabel = s.score
              ? s.score.label
              : s.parts.find((p) => p.sha === openSha)?.label ?? s.parts[0].label}
            <li class="dl-row" class:omitted={!included}>
              <label class="dl-check">
                <input
                  type="checkbox"
                  checked={included}
                  onchange={(e) => (omitSlugs[s.slug] = !e.currentTarget.checked)}
                />
                <a href={viewHref(openSha, `${s.title} — ${openLabel}`)}>
                  {s.title}
                </a>
              </label>
              {#if s.score}
                {#if pages > 1}
                  <select
                    class="dl-part"
                    value={pageFor(s)}
                    disabled={!included}
                    onchange={(e) => (pagePick[s.slug] = e.currentTarget.value)}
                  >
                    <option value="all">All pages ({pages})</option>
                    {#each Array(pages) as _, i (i)}
                      <option value={String(i + 1)}>Page {i + 1}</option>
                    {/each}
                  </select>
                {:else}
                  <span class="dl-label">{s.score.label}</span>
                {/if}
              {:else if s.parts.length > 1}
                <select
                  class="dl-part"
                  value={picked}
                  disabled={!included}
                  onchange={(e) => (partPick[s.slug] = e.currentTarget.value)}
                >
                  <option value="all">All parts ({s.parts.length})</option>
                  {#each s.parts as p (p.sha)}
                    <option value={p.sha}>{p.label}</option>
                  {/each}
                </select>
              {:else}
                <span class="dl-label">{s.parts[0].label}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">
          No charts for {packetInstLabel} ({packetFormat === 'lyre' ? 'Lyre' : 'Letter'}) in this
          packet. Try another instrument or format.
        </p>
      {/if}
    </div>
  {/if}

  <!-- Delete gig -->
  {#if canEdit}
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

  .editor-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
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
    min-height: 44px;
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }

  /* Practice is the lower-key sibling of Perform: same shape, outlined. */
  .practice-set {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--paper);
    color: var(--accent-strong);
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
    color: var(--ink);
    text-decoration: none;
  }

  .song-title:hover {
    color: var(--accent-strong);
    text-decoration: underline;
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

  .dl-pickers {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .dl-pick {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 160px;
  }

  .dl-pick span {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
  }

  .packet-btn {
    align-self: flex-start;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: 0 18px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    text-decoration: none;
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

  .packet-btn.disabled {
    background: var(--panel);
    color: var(--muted);
    border-color: var(--line);
    cursor: default;
  }

  .packet-btn.busy {
    opacity: 0.7;
    cursor: progress;
  }

  .dl-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 38px;
  }

  .dl-check {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .dl-check input {
    width: 20px;
    height: 20px;
    flex: none;
  }

  .dl-check a {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dl-row.omitted .dl-check a,
  .dl-row.omitted .dl-label {
    opacity: 0.45;
  }

  .dl-part {
    /* Uniform width for every row's picker — long part/page labels just
       truncate rather than stretching the control to fit. */
    flex: none;
    width: 12rem;
    max-width: 45vw;
    min-height: 38px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    min-height: 44px;
    padding: 0 14px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
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

  /* Back arrow — the single, consistent exit, top-left on every overlay. Shared
     look between the Practice top bar and the floating Perform arrow. */
  .overlay .exit {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    line-height: 1;
    background: rgba(255, 253, 247, 0.12);
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
    border-radius: 8px;
    cursor: pointer;
  }

  .overlay .exit:hover {
    background: rgba(255, 253, 247, 0.22);
  }

  /* Perform: back arrow + current title in a solid dark pill (top-left), so they
     stay visible even where the white score page reaches the corner. */
  .perform-corner {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 70vw;
    padding: 6px 12px 6px 6px;
    border-radius: 10px;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  /* Part / Format pickers, styled for the dark cluster. */
  .floating .sel {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
  }

  .floating .sel .eyebrow {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #b9b6ac;
  }

  .floating .sel select {
    min-height: 44px;
    padding: 0 8px;
    border-radius: 6px;
    background: rgba(255, 253, 247, 0.12);
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
    font-size: 0.8rem;
    font-weight: 700;
  }

  .floating .sel select option {
    color: #202124;
  }

  /* Shown when a song has no chart for the chosen instrument/part/format. */
  .no-chart {
    margin: auto;
    text-align: center;
    color: #dfddd4;
    padding: 24px;
  }

  .no-chart .hint {
    font-size: 0.85rem;
    color: #b9b6ac;
    margin-top: 8px;
  }

  /* Current title, inline in the perform-corner pill beside the back arrow. */
  .now-playing {
    font-size: 0.9rem;
    color: #f2d36b;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .run-mode {
    display: inline-block;
    margin-right: 8px;
    padding: 1px 8px;
    border-radius: 999px;
    background: rgba(242, 211, 107, 0.18);
    color: #f2d36b;
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    vertical-align: middle;
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    padding: 12px;
  }

  /* Practice run: one top bar (mirrors the single-song practice bar). It runs
     along the top of the page in normal flow — reserving its height so the
     score sits below with no overlap. A single flex row: the compact player
     grows to fill, pushing the song navigation flush right so Next song lands
     at the very end. */
  .practice-bar {
    margin: 12px 12px 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 10px;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  .practice-bar .ghost {
    min-height: 44px;
    padding: 0 12px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
    background: rgba(255, 253, 247, 0.12);
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
  }

  .practice-bar .ghost:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .practice-bar .pos {
    font-size: 0.78rem;
    color: #dfddd4;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .practice-bar .rec-sel,
  .practice-bar .part-sel {
    min-height: 44px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #2c2d31;
    color: #fffdf7;
    padding: 0 8px;
  }

  .practice-bar .rec-sel {
    max-width: 28vw;
  }

  /* Part is usually a short label (1st / 2nd …); keep it tight so it steals only
     a little from the scrub bar. */
  .practice-bar .part-sel {
    max-width: 22vw;
  }

  /* Fills the player's slot when a song has no recording, so the nav buttons
     still sit flush right. */
  .practice-bar .no-audio {
    flex: 1;
    color: #b9b6ac;
    font-size: 0.85rem;
  }
</style>
