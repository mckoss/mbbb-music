<script lang="ts">
  let { data } = $props();
</script>

{#snippet card(m: (typeof data.active)[number])}
  <li>
    <a class="card" href={`/members/${encodeURIComponent(m.email)}`}>
      <img
        class="avatar"
        src={`/members/${encodeURIComponent(m.email)}/avatar?v=${encodeURIComponent(m.avatarRev)}`}
        alt={m.name}
        loading="lazy"
      />
      <span class="name">{m.name}</span>
      <span class="inst">{m.instrument ?? '—'}</span>
    </a>
  </li>
{/snippet}

<section class="roster">
  <header>
    <p class="kicker">Members</p>
    <h2>Band roster</h2>
    <p class="count">
      {data.active.length} active{#if data.former.length} · {data.former.length} former{/if}
    </p>
  </header>

  {#if data.active.length}
    <ul class="grid">
      {#each data.active as m (m.email)}{@render card(m)}{/each}
    </ul>
  {/if}

  {#if data.former.length}
    <div class="divider"><span>Former members</span></div>
    <ul class="grid former">
      {#each data.former as m (m.email)}{@render card(m)}{/each}
    </ul>
  {/if}

  {#if !data.active.length && !data.former.length}
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

  .count {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
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
    width: 96px;
    height: 96px;
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

  .inst {
    color: var(--muted);
    font-size: 0.82rem;
  }

  /* Labeled separator between the active roster and former members. */
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

  /* Dim former members slightly to set them apart. */
  .former .card .avatar {
    filter: grayscale(0.35);
    opacity: 0.9;
  }

  .empty {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
