<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';

  const edits = $derived(page.data.edits as Array<{
    id: number;
    scope: string;
    field: string;
    value: string | null;
    target_id: string;
    targetLabel: string;
    edited_by: string;
    edited_at: string;
    deleted_by: string | null;
    deleted_at: string | null;
    canManage: boolean;
  }>);

  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };
</script>

<section class="edits">
  <header>
    <p class="kicker">Metadata corrections</p>
    <h2>Recent edits</h2>
    <p class="body">
      Every human correction to song and part metadata, newest first. An edit is
      live the moment it's made; the <strong>latest</strong> edit of a field wins.
      Deleting an edit reverts that field to its previous value — deletions are kept
      here for the record (struck through). Admins can delete any edit; you can
      always delete your own.
    </p>
    <p class="back"><a href="/library-status">← Back to Library Status</a></p>
  </header>

  {#if edits.length === 0}
    <p class="empty">No corrections have been made yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>When</th><th>Scope</th><th>Target</th><th>Field</th><th>Value</th><th>By</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each edits as e (e.id)}
          <tr class:deleted={e.deleted_at}>
            <td class="when">{fmt(e.edited_at)}</td>
            <td>{e.scope}</td>
            <td class="target" title={e.target_id}>{e.targetLabel}</td>
            <td>{e.field}</td>
            <td class="value">{e.value ?? '∅ (cleared)'}</td>
            <td class="by">{e.edited_by}</td>
            <td class="action">
              {#if e.deleted_at}
                <span class="tombstone" title={`deleted by ${e.deleted_by} on ${fmt(e.deleted_at)}`}>deleted</span>
                {#if e.canManage}
                  <form method="POST" action="?/restore" use:enhance>
                    <input type="hidden" name="id" value={e.id} />
                    <button class="restore" type="submit">Restore</button>
                  </form>
                {/if}
              {:else if e.canManage}
                <form method="POST" action="?/delete" use:enhance>
                  <input type="hidden" name="id" value={e.id} />
                  <button class="del" type="submit">Delete</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .edits {
    max-width: 1000px;
    margin: 0 auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }
  .body {
    color: var(--muted);
    max-width: 80ch;
  }
  .back a {
    color: var(--accent-strong);
    text-decoration: underline;
    font-size: 0.85rem;
  }
  .empty {
    color: var(--muted);
    padding: 16px;
    text-align: center;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.85rem;
  }
  th,
  td {
    text-align: left;
    padding: 7px 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .when,
  .by {
    white-space: nowrap;
    color: var(--muted);
  }
  .target {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value {
    font-weight: 700;
  }
  tr.deleted td {
    color: var(--muted);
    text-decoration: line-through;
  }
  tr.deleted td.action {
    text-decoration: none;
  }
  .tombstone {
    font-size: 0.72rem;
    color: #b06a1f;
    text-decoration: none;
    display: inline-block;
  }
  .del {
    border: 1px solid #d8413a;
    background: #fdf1f0;
    color: #8a1f1a;
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 0.76rem;
    font-weight: 700;
    cursor: pointer;
  }
  .action {
    white-space: nowrap;
  }
  .restore {
    margin-left: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--paper);
    color: var(--accent-strong);
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 0.76rem;
    font-weight: 700;
    cursor: pointer;
  }
</style>
