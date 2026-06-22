<script lang="ts">
  import { enhance } from '$app/forms';
  import type { UserRecord } from '$lib/server/users';
  import type { Role } from '$lib/types';

  let {
    data,
    form,
  }: {
    data: { users: UserRecord[]; roles: Role[]; me: string; authOpen: boolean };
    form: { message?: string } | null;
  } = $props();
</script>

<svelte:head><title>Users · MBBB Music</title></svelte:head>

<section class="admin">
  <header>
    <p class="kicker">Admin</p>
    <h2>Members &amp; roles</h2>
    <p class="body">
      Grant access by adding someone's Google email and a role. <strong>Admin</strong> can manage
      users and view everything; <strong>member</strong> and <strong>organizer</strong> can view the
      library. Removing a user revokes access immediately. Config-bootstrapped admins are locked.
    </p>
    {#if data.authOpen}
      <p class="warn">OAuth isn't configured — the site is currently running open (no sign-in required).</p>
    {/if}
    {#if form?.message}<p class="flash" role="status">{form.message}</p>{/if}
  </header>

  <form class="add" method="POST" action="?/add" use:enhance>
    <input name="email" type="email" placeholder="name@gmail.com" required aria-label="Email" />
    <select name="role" aria-label="Role">
      {#each data.roles as r (r)}<option value={r}>{r}</option>{/each}
    </select>
    <button type="submit">Add / update</button>
  </form>

  <table>
    <thead>
      <tr><th>Email</th><th>Role</th><th>Added</th><th></th></tr>
    </thead>
    <tbody>
      {#each data.users as u (u.email)}
        <tr>
          <td class="email">{u.email}{#if u.email === data.me}<span class="you">you</span>{/if}</td>
          <td>
            {#if u.bootstrap}
              <span class="locked">admin (config)</span>
            {:else}
              <form method="POST" action="?/setRole" use:enhance class="inline">
                <input type="hidden" name="email" value={u.email} />
                <select name="role" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
                  {#each data.roles as r (r)}<option value={r} selected={r === u.role}>{r}</option>{/each}
                </select>
              </form>
            {/if}
          </td>
          <td class="added">{u.addedAt ? new Date(u.addedAt).toLocaleDateString() : '—'}</td>
          <td class="actions">
            {#if !u.bootstrap}
              <form
                method="POST"
                action="?/remove"
                use:enhance={({ cancel }) => {
                  if (!confirm(`Remove ${u.email} from the sign-in list?\nThey will lose access to the site immediately.`)) cancel();
                }}
              >
                <input type="hidden" name="email" value={u.email} />
                <button type="submit" class="remove">Remove</button>
              </form>
            {/if}
          </td>
        </tr>
      {/each}
      {#if data.users.length === 0}
        <tr><td colspan="4" class="empty">No users yet.</td></tr>
      {/if}
    </tbody>
  </table>
</section>

<style>
  .admin {
    max-width: 900px;
    margin: 0 auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  .body {
    color: var(--muted);
    max-width: 75ch;
  }

  .warn {
    background: #fdf6e3;
    border: 1px solid #e0c46a;
    color: #6b531a;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 0.85rem;
  }

  .flash {
    background: #edf4f3;
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 0.85rem;
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .add input {
    flex: 1;
    min-width: 220px;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 12px;
    background: var(--paper);
    color: var(--ink);
  }

  select {
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 10px;
    background: var(--panel);
    color: var(--ink);
  }

  .add button,
  .remove {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
  }

  .add button {
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    font-size: 0.88rem;
  }

  th {
    color: var(--muted);
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .email {
    font-weight: 600;
    word-break: break-word;
  }

  .you,
  .locked {
    margin-left: 8px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .inline {
    margin: 0;
  }

  .actions {
    text-align: right;
  }

  .remove {
    border: 1px solid var(--line);
    background: #fdf1f0;
    color: #8a1f1a;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 16px;
  }
</style>
