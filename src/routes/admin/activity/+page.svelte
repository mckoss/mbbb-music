<script lang="ts">
  let { data } = $props();

  // The feature columns, in the order a member meets them: open a score, work on
  // it, play it out, take it home on paper, look around the site.
  const FEATURES = [
    { key: 'score-view', label: 'Views', title: 'Score views' },
    { key: 'practice', label: 'Practice', title: 'Practice sessions (score or gig set)' },
    { key: 'performance', label: 'Perform', title: 'Performances (score or gig set)' },
    { key: 'download', label: 'PDF', title: 'PDF downloads' },
    { key: 'print', label: 'Print', title: 'Prints (opened a PDF to print)' },
    { key: 'gig-view', label: 'Gigs', title: 'Gig and set list views' },
    { key: 'members-view', label: 'Roster', title: 'Member roster and profile views' },
  ];

  // Human verb + small tag color per event type (raw feed).
  const ACTIONS: Record<string, { verb: string; tag: string }> = {
    download: { verb: 'downloaded', tag: 'dl' },
    print: { verb: 'printed', tag: 'print' },
    'score-view': { verb: 'viewed score', tag: 'score' },
    practice: { verb: 'practiced', tag: 'prac' },
    performance: { verb: 'performed', tag: 'perf' },
    'gig-view': { verb: 'viewed gig', tag: 'gig' },
    'members-view': { verb: 'viewed roster', tag: 'roster' },
    'profile-edit': { verb: 'edited profile', tag: 'edit' },
  };
  const action = (type: string) => ACTIONS[type] ?? { verb: type, tag: 'other' };

  const activeCount = $derived(data.members.filter((m) => m.lastSeenAt).length);
</script>

<svelte:head><title>Activity · MBBB Music</title></svelte:head>

<section class="activity">
  <header>
    <p class="kicker">Admin</p>
    <h2>Member activity</h2>
    <p class="body">
      Every member, most recently seen first. Each cell is
      <strong>last {data.recentDays} days</strong> / <span class="muted">all time</span>. Open a
      member to see the songs they've viewed, practiced, or performed.
    </p>
    <p class="count">{activeCount} of {data.members.length} members have used the site</p>
  </header>

  <div class="panel scroll">
    <div class="table">
      <div class="head row">
        <span></span>
        <span></span>
        <span>Member</span>
        <span>Last seen</span>
        {#each FEATURES as f (f.key)}
          <span class="num" title={f.title}>{f.label}</span>
        {/each}
      </div>

      {#each data.members as m (m.email)}
        <details class="member">
          <summary class="row">
            <span class="caret" aria-hidden="true">▸</span>
            <img
              class="avatar"
              src={`/members/${encodeURIComponent(m.email)}/avatar?v=${encodeURIComponent(m.avatarRev)}`}
              alt=""
              loading="lazy"
            />
            <span class="who">
              {m.who}
              {#if m.isFormer}<span class="badge">former</span>{/if}
            </span>
            {#if m.lastSeen}
              <span class="seen">{m.lastSeen}</span>
            {:else}
              <span class="seen never">Never signed in</span>
            {/if}
            {#each FEATURES as f (f.key)}
              {@const c = m.counts[f.key]}
              <span class="num" class:zero={!c.total}>
                {#if c.total}
                  <strong>{c.recent}</strong><span class="muted">/{c.total}</span>
                {:else}—{/if}
              </span>
            {/each}
          </summary>

          <div class="detail">
            {#if m.songs.length}
              <h4>Songs · {m.songs.length}</h4>
              <ul class="songs">
                {#each m.songs as s (s.title)}
                  <li>
                    <span class="title">{s.title}</span>
                    <span class="kinds">{s.kinds.join(', ')}</span>
                    <span class="num"><strong>{s.recent}</strong><span class="muted">/{s.total}</span></span>
                    <span class="when">{s.last}</span>
                  </li>
                {/each}
              </ul>
            {:else if m.allTotal}
              <p class="empty">No songs opened yet — {m.allTotal} other actions recorded.</p>
            {:else}
              <p class="empty">No recorded activity.</p>
            {/if}
          </div>
        </details>
      {/each}
    </div>
  </div>

  <details class="panel log">
    <summary><h3>Activity log · {data.feed.length} events</h3></summary>
    {#if data.feed.length}
      <ul class="feed">
        {#each data.feed as item (item.at + item.email + item.type + (item.label ?? ''))}
          <li>
            <span class="tag {action(item.type).tag}">{action(item.type).tag}</span>
            <span class="line">
              <span class="who">{item.who}</span>
              {action(item.type).verb}{#if item.label}{' '}<span class="label">{item.label}</span>{/if}
              {#if item.offline}<span class="offline">offline</span>{/if}
            </span>
            <span class="when">{item.time}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">No activity recorded yet.</p>
    {/if}
  </details>
</section>

<style>
  .activity {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  .body {
    color: var(--muted);
    max-width: 70ch;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
    margin-top: 4px;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 16px 18px;
  }

  /* The member grid is wide; let it scroll rather than squeeze the columns. */
  .scroll {
    overflow-x: auto;
  }

  .table {
    min-width: 720px;
  }

  /* One shared template, so every member's columns line up under the header. */
  .row {
    display: grid;
    grid-template-columns: 14px 30px minmax(140px, 1fr) 170px repeat(7, 58px);
    align-items: center;
    gap: 8px;
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.86rem;
  }

  .head {
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    border-bottom: 2px solid var(--accent);
  }

  .member > summary {
    cursor: pointer;
    list-style: none;
  }

  .member > summary::-webkit-details-marker {
    display: none;
  }

  .member > summary:hover {
    background: var(--accent-soft, rgba(0, 0, 0, 0.03));
  }

  .caret {
    color: var(--muted);
    font-size: 0.7rem;
    transition: transform 0.12s ease;
  }

  .member[open] .caret {
    transform: rotate(90deg);
  }

  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--line);
    background: #efece3;
  }

  .who {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    margin-left: 6px;
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 1px 6px;
  }

  .seen {
    color: var(--ink);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .seen.never {
    color: var(--muted);
    font-style: italic;
  }

  .num {
    text-align: right;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .num.zero {
    color: var(--muted);
  }

  .muted {
    color: var(--muted);
  }

  /* --- Expanded member: their songs --- */

  .detail {
    padding: 10px 0 14px 52px;
    border-bottom: 1px solid var(--line);
  }

  h4 {
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 6px;
  }

  .songs {
    list-style: none;
    margin: 0;
    padding: 0;
    max-width: 720px;
  }

  .songs li {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) 170px 60px 150px;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    font-size: 0.84rem;
  }

  .songs .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kinds {
    color: var(--accent-strong);
    font-size: 0.76rem;
  }

  /* --- Raw feed --- */

  .log > summary {
    cursor: pointer;
  }

  .log h3 {
    display: inline;
    font-size: 0.95rem;
  }

  .feed {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }

  .feed li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.88rem;
  }

  .tag {
    font-size: 0.62rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 999px;
    color: #050505;
    background: #e7e3d7;
    white-space: nowrap;
  }
  .tag.dl { background: #cfe6d8; }
  .tag.print { background: #d8e8cf; }
  .tag.score { background: #d6e2f2; }
  .tag.prac { background: #cfe4e6; }
  .tag.gig { background: #f2e3c0; }
  .tag.perf { background: #efd2cf; }
  .tag.roster { background: #e6dfd0; }
  .tag.edit { background: #e4dcef; }

  .label {
    color: var(--accent-strong);
  }

  .offline {
    margin-left: 6px;
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .when {
    color: var(--muted);
    font-size: 0.78rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
