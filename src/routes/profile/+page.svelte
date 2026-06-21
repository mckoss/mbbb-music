<script lang="ts">
  import { instrumentLabel } from '$lib/members';

  let { data, form } = $props();

  const p = $derived(data.profile);
  // Cache-bust the avatar preview when the profile changes (updatedAt advances).
  const avatarSrc = $derived(
    `/members/${encodeURIComponent(p.email)}/avatar?v=${encodeURIComponent(p.updatedAt ?? '')}`
  );
  const also = $derived(new Set(p.instruments));

  // Human label for where the displayed photo actually comes from.
  const SOURCE_LABEL: Record<string, string> = {
    upload: 'your uploaded picture',
    google: 'your Google account photo',
    gravatar: 'a Gravatar matched to your email',
    initials: 'auto-generated initials (no photo found yet)',
  };
  const sourceLabel = $derived(SOURCE_LABEL[data.avatarSource] ?? 'unknown');
</script>

<section class="profile">
  <header>
    <p class="kicker">My Profile</p>
    <h2>Your band member details</h2>
    <p class="body">
      This information populates the band roster. Your sign-in email
      (<strong>{p.email}</strong>) is your account identity and can’t be changed here.
    </p>
  </header>

  {#if form?.message}
    <p class="notice" class:err={'error' in (form ?? {})}>{form.message}</p>
  {/if}

  <form class="card" method="POST" action="?/save" enctype="multipart/form-data">
    <div class="avatar-row">
      <img class="avatar" src={avatarSrc} alt="Your avatar" />
      <div class="avatar-controls">
        <p class="source">Showing {sourceLabel}.</p>
        <label class="field">
          <span class="label">{data.avatarSource === 'upload' ? 'Replace picture' : 'Upload a picture'}</span>
          <input type="file" name="avatar" accept="image/png,image/jpeg,image/gif,image/webp" />
        </label>
        {#if data.avatarSource === 'upload'}
          <label class="check remove">
            <input type="checkbox" name="removeAvatar" value="1" />
            Remove uploaded picture (revert to your Google/Gravatar photo or initials)
          </label>
        {/if}
        <p class="hint">Order of preference: your upload → Google photo → Gravatar → initials.</p>
      </div>
    </div>

    <label class="field">
      <span class="label">Full name</span>
      <input type="text" name="fullName" value={p.fullName ?? ''} autocomplete="name" />
    </label>

    <label class="field">
      <span class="label">Phone</span>
      <input type="tel" name="phone" value={p.phone ?? ''} autocomplete="tel" placeholder="555-0100" />
    </label>

    <label class="field">
      <span class="label">Primary instrument</span>
      <select name="primaryInstrument">
        <option value="">— none —</option>
        {#each data.instruments as inst (inst.slug)}
          <option value={inst.slug} selected={p.primaryInstrument === inst.slug}>{inst.label}</option>
        {/each}
      </select>
    </label>

    <fieldset class="field">
      <legend class="label">Also plays</legend>
      <div class="checks">
        {#each data.instruments as inst (inst.slug)}
          <label class="check">
            <input type="checkbox" name="instruments" value={inst.slug} checked={also.has(inst.slug)} />
            {inst.label}
          </label>
        {/each}
      </div>
    </fieldset>

    <label class="field">
      <span class="label">Shirt size</span>
      <select name="shirtSize">
        <option value="">— not set —</option>
        {#each data.shirtSizes as size (size)}
          <option value={size} selected={p.shirtSize === size}>{size}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span class="label">Alternate email <span class="muted">(where to actually reach you, if different)</span></span>
      <input type="email" name="alternateEmail" value={p.alternateEmail ?? ''} autocomplete="email" />
    </label>

    <div class="actions">
      <button type="submit" class="save">Save profile</button>
      {#if p.updatedAt}
        <span class="meta">Last updated {new Date(p.updatedAt).toLocaleString()} by {p.updatedBy}</span>
      {/if}
    </div>
  </form>

  {#if p.primaryInstrument}
    <p class="summary">
      Primary: <strong>{instrumentLabel(p.primaryInstrument)}</strong>
      {#if p.instruments.length}· also {p.instruments.map((s) => instrumentLabel(s)).join(', ')}{/if}
    </p>
  {/if}
</section>

<style>
  .profile {
    max-width: 720px;
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
    max-width: 60ch;
  }

  .notice {
    border: 1px solid var(--accent-strong);
    background: #f7f5ef;
    color: var(--ink);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 0.9rem;
  }
  .notice.err {
    border-color: #b3261e;
    color: #b3261e;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .avatar-row {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .avatar {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--line);
    background: #efece3;
    flex: 0 0 auto;
  }

  .avatar-controls {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 0;
    padding: 0;
    margin: 0;
  }

  .label {
    font-size: 0.82rem;
    font-weight: 700;
  }
  .muted {
    color: var(--muted);
    font-weight: 400;
  }

  input[type='text'],
  input[type='tel'],
  input[type='email'],
  select {
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 12px;
    background: var(--paper);
    color: var(--ink);
    font-size: 1rem;
  }

  input[type='file'] {
    font-size: 0.9rem;
  }

  .checks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    font-size: 0.9rem;
  }

  .source {
    font-size: 0.86rem;
    font-weight: 600;
  }

  .remove {
    color: var(--muted);
  }

  .hint {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .save {
    min-height: 44px;
    min-width: 140px;
    padding: 0 20px;
    border: 1px solid var(--accent-strong);
    border-radius: 6px;
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .meta {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .summary {
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
