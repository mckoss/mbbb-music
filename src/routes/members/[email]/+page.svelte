<script lang="ts">
  let { data } = $props();
  const m = $derived(data.member);
  const avatarSrc = $derived(
    `/members/${encodeURIComponent(m.email)}/avatar?v=${encodeURIComponent(m.avatarRev)}`
  );
  const alsoPlays = $derived(m.instruments.filter((i: string) => i !== m.primary));
</script>

<section class="member">
  <a class="back" href="/members">← Roster</a>

  <div class="card">
    <img class="avatar" src={avatarSrc} alt={m.name} />
    <div class="head">
      <h2>{m.name}</h2>
      {#if m.primary}<p class="primary">{m.primary}</p>{/if}
    </div>

    <dl class="fields">
      {#if alsoPlays.length}
        <dt>Also plays</dt>
        <dd>{alsoPlays.join(', ')}</dd>
      {/if}

      <dt>Phone</dt>
      <dd>{#if m.phone}<a href={`tel:${m.phone}`}>{m.phone}</a>{:else}<span class="empty">—</span>{/if}</dd>

      <dt>Email</dt>
      <dd><a href={`mailto:${m.alternateEmail ?? m.email}`}>{m.alternateEmail ?? m.email}</a></dd>

      {#if m.alternateEmail}
        <dt>Sign-in</dt>
        <dd>{m.email}</dd>
      {/if}

      <dt>Shirt size</dt>
      <dd>{#if m.shirtSize}{m.shirtSize}{:else}<span class="empty">—</span>{/if}</dd>
    </dl>

    {#if data.canEdit}
      <a class="edit" href={data.isSelf ? '/profile' : `/profile?email=${encodeURIComponent(m.email)}`}>
        {data.isSelf ? 'Edit my profile' : 'Edit this profile'}
      </a>
    {/if}
  </div>
</section>

<style>
  .member {
    max-width: 560px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .back {
    color: var(--accent-strong);
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .avatar {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--line);
    background: #efece3;
  }

  .head {
    text-align: center;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
    word-break: break-word;
  }

  .primary {
    color: var(--accent-strong);
    font-weight: 700;
    font-size: 0.95rem;
    margin-top: 2px;
  }

  .fields {
    width: 100%;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 10px 16px;
    margin: 6px 0 0;
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }

  dt {
    color: var(--muted);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
    align-self: center;
  }

  dd {
    margin: 0;
    font-size: 0.95rem;
    word-break: break-word;
  }

  dd a {
    color: var(--accent-strong);
  }

  .empty {
    color: var(--muted);
  }

  .edit {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: 0 18px;
    border: 1px solid var(--accent-strong);
    border-radius: 6px;
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.85rem;
    text-decoration: none;
  }
</style>
