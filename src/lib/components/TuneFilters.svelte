<script lang="ts">
  import { ALL_STATUSES, STATUS_DESC, type SongStatus } from '$lib/song-status';

  let { query = $bindable(), show = $bindable() }: {
    query: string;
    show: Record<SongStatus, boolean>;
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
</style>
