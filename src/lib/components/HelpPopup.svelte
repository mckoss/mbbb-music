<script lang="ts">
  import type { Snippet } from 'svelte';

  // A small "?" trigger that opens a modal carrying explanatory text, so a tab's
  // header stays compact. Shared by the Library Info tabs (Coverage / Files /
  // Generated). The modal is fixed-position, so this component can sit inline next
  // to a heading without its popup affecting layout.
  let {
    title = 'How to read this view',
    label = 'How to read this view',
    children,
  }: { title?: string; label?: string; children: Snippet } = $props();

  let open = $state(false);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      e.stopPropagation();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<button class="help-btn" onclick={() => (open = true)} aria-label={label} title={label}>?</button>

{#if open}
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header class="modal-head">
        <h3>{title}</h3>
        <button class="x" onclick={() => (open = false)} aria-label="Close">×</button>
      </header>
      <div class="help-body">
        {@render children()}
      </div>
      <p class="modal-hint">Press Esc to close</p>
    </div>
  </div>
{/if}

<style>
  .help-btn {
    vertical-align: middle;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--accent-strong);
    background: var(--paper);
    color: var(--accent-strong);
    font-size: 0.9rem;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
  }
  .help-btn:hover {
    background: var(--accent);
    color: #fffdf7;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal {
    background: var(--panel);
    color: var(--ink);
    border-radius: 8px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
    width: min(440px, 100%);
    max-height: 80vh;
    overflow: auto;
    padding: 18px 20px;
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .modal-head h3 {
    font-size: 1.05rem;
  }

  .x {
    border: 0;
    background: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: var(--muted);
    padding: 0 4px;
  }

  .help-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--ink);
    font-size: 0.88rem;
    line-height: 1.5;
  }
  /* The body text is slotted in from the parent, so reset its paragraph margins
     here (scoped rules don't reach slotted content — :global does). */
  .help-body :global(p) {
    margin: 0;
  }

  .modal-hint {
    margin-top: 12px;
    color: var(--muted);
    font-size: 0.78rem;
    text-align: right;
  }
</style>
