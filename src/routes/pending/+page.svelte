<script lang="ts">
  let { data }: { data: { email: string } } = $props();
</script>

<svelte:head><title>Awaiting approval · MBBB Music</title></svelte:head>

<div class="screen">
  <div class="card">
    <enhanced:img class="logo" src="$lib/assets/mbbb-logo.png?w=240" alt="Mutiny Bay Brass Band logo" />
    <h1>Awaiting approval</h1>
    <p class="sub">
      You're signed in as <strong>{data.email}</strong>, but your account hasn't been
      approved for the music library yet.
    </p>
    <p class="sub">Ask a band admin to grant you access, then reload this page.</p>
    <form method="POST" action="/auth/logout">
      <button type="submit" class="signout">Sign out</button>
    </form>
  </div>
</div>

<style>
  .screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #050505;
    color: #fffdf7;
  }

  .card {
    width: min(440px, 100%);
    background: var(--panel);
    color: var(--ink);
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    padding: 32px 28px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .logo {
    width: 88px;
    height: auto;
    border-radius: 50%;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
  }

  h1 {
    font-size: 1.5rem;
  }

  .sub {
    color: var(--muted);
    font-size: 0.92rem;
    max-width: 40ch;
  }

  .signout {
    margin-top: 8px;
    min-height: 44px;
    padding: 0 18px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: #f7f5ef;
    color: var(--accent-strong);
    font-weight: 700;
    cursor: pointer;
  }
</style>
