<script lang="ts">
  let { data } = $props();
</script>

<section class="roster">
  <header>
    <p class="kicker">Members</p>
    <h2>Band roster</h2>
    <p class="count">{data.members.length} members</p>
  </header>

  <ul class="grid">
    {#each data.members as m (m.email)}
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
    {/each}
  </ul>
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
</style>
