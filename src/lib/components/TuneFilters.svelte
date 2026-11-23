<script lang="ts">
  import { ALL_STATUSES, STATUS_DESC, type SongStatus } from '$lib/song-status';

  let { query = $bindable(), show = $bindable(), hidden = [] }: {
    query: string;
    show: Record<SongStatus, boolean>;
    // Search matches in statuses the chips hide (see hiddenStatusMatches). A
    // search lists them anyway; this says so and offers to add the status.
    hidden?: { status: SongStatus; count: number }[];
  } = $props();
</script>

<input class="search" type="search" placeholder="Search titles…"
  bind:value={query} aria-label="Search titles" />
<div class="status-filter" role="group" aria-label="Filter by status">
  {#each ALL_STATUSES as s (s)}
    <button type="button" class="chip" class:on={show[s]} title={STATUS_DESC[s]}
      aria-pressed={show[s]} onclick={() => (show[s] = !show[s])}>{s}</button>
  {/each}
</div>
{#if hidden.length}
  <div class="hidden-note" role="status">
    {#each hidden as h (h.status)}
      <p>
        <span>
          Showing {h.count} matching {h.count === 1 ? 'song' : 'songs'} from <strong>{h.status}</strong>,
          which your filter hides.
        </span>
        <button type="button" class="add" onclick={() => (show[h.status] = true)}>Add {h.status} to filter</button>
      </p>
    {/each}
  </div>
{/if}

<style>
  .search {
    width: 100%;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 12px;
    background: var(--paper);
    color: var(--ink);
  }
  .status-filter { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .chip {
    border: 1px solid var(--line);
    border-radius: 999px;
    min-height: 44px;
    padding: 4px 12px;
    font-size: 0.76rem;
    font-weight: 600;
    background: var(--paper);
    color: var(--muted);
    cursor: pointer;
  }
  .chip.on { background: var(--accent); border-color: var(--accent-strong); color: #fffdf7; }
  .hidden-note {
    margin-top: 8px;
    padding: 8px 12px;
    border: 1px solid #f0c674;
    border-left: 4px solid #b26a00;
    border-radius: 6px;
    background: #fff7e6;
    color: #4a3a16;
    font-size: 0.85rem;
  }
  .hidden-note p {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }
  .hidden-note p + p { margin-top: 6px; }
  .add {
    min-height: 44px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid #b26a00;
    background: #fffdf7;
    color: #8a5200;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
</style>
