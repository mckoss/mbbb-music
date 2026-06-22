<script lang="ts">
  let { data } = $props();

  // Human verb + small tag color per event type.
  const ACTIONS: Record<string, { verb: string; tag: string }> = {
    download: { verb: 'downloaded', tag: 'dl' },
    'score-view': { verb: 'viewed score', tag: 'score' },
    'gig-view': { verb: 'viewed gig', tag: 'gig' },
    performance: { verb: 'performed', tag: 'perf' },
    'profile-edit': { verb: 'edited profile', tag: 'edit' },
  };
  const action = (type: string) => ACTIONS[type] ?? { verb: type, tag: 'other' };
</script>

<svelte:head><title>Activity · MBBB Music</title></svelte:head>

<section class="activity">
  <header>
    <p class="kicker">Admin</p>
    <h2>Site activity</h2>
    <p class="body">
      Authenticated use across the site — PDF downloads, score and gig views,
      performances, and profile edits — most recent first.
    </p>
  </header>

  {#if data.recent.length}
    <div class="panel">
      <h3>Most recent use</h3>
      <ul class="recent">
        {#each data.recent as r (r.email)}
          <li><span class="who">{r.who}</span><span class="when">{r.time}</span></li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="panel">
    <h3>Activity log</h3>
    {#if data.feed.length}
      <ul class="feed">
        {#each data.feed as item (item.at + item.email + item.type + (item.label ?? ''))}
          <li>
            <span class="tag {action(item.type).tag}">{action(item.type).tag}</span>
            <span class="line">
              <span class="who">{item.who}</span>
              {action(item.type).verb}{#if item.label} <span class="label">{item.label}</span>{/if}
            </span>
            <span class="when">{item.time}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">No activity recorded yet.</p>
    {/if}
  </div>
</section>

<style>
  .activity {
    max-width: 900px;
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

  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 16px 18px;
  }

  h3 {
    font-size: 0.95rem;
    margin-bottom: 10px;
  }

  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 6px 18px;
  }

  .recent li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.86rem;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
  }

  .feed {
    list-style: none;
    margin: 0;
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
  .tag.score { background: #d6e2f2; }
  .tag.gig { background: #f2e3c0; }
  .tag.perf { background: #efd2cf; }
  .tag.edit { background: #e4dcef; }

  .who {
    font-weight: 700;
  }

  .label {
    color: var(--accent-strong);
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
