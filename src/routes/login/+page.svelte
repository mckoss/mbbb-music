<script lang="ts">
  let { data }: { data: { error: string | null; next: string } } = $props();

  const ERRORS: Record<string, string> = {
    denied: 'Sign-in was cancelled.',
    state: 'Your sign-in attempt expired. Please try again.',
    verify: "We couldn't verify your Google account. Please try again.",
  };
  const message = $derived(data.error ? (ERRORS[data.error] ?? 'Sign-in failed. Please try again.') : null);
  const href = $derived(`/auth/login?next=${encodeURIComponent(data.next || '/')}`);
</script>

<svelte:head><title>Sign in · MBBB Music</title></svelte:head>

<div class="screen">
  <div class="card">
    <enhanced:img class="logo" src="$lib/assets/mbbb-logo.png?w=240" alt="Mutiny Bay Brass Band logo" />
    <p class="eyebrow">Mutiny Bay Brass Band</p>
    <h1>Music Portfolio</h1>
    <p class="sub">Sign in with your Google account to access the band's music library.</p>

    {#if message}<p class="error" role="alert">{message}</p>{/if}

    <a class="google" {href}>
      <span class="g" aria-hidden="true">G</span>
      Sign in with Google
    </a>

    <p class="hint">Access is limited to approved band members.</p>
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
    width: min(420px, 100%);
    background: var(--panel);
    color: var(--ink);
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    padding: 32px 28px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .logo {
    width: 96px;
    height: auto;
    border-radius: 50%;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
    margin-bottom: 8px;
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--accent-strong);
  }

  h1 {
    font-size: 1.6rem;
    line-height: 1.1;
  }

  .sub {
    color: var(--muted);
    font-size: 0.9rem;
    max-width: 32ch;
  }

  .error {
    width: 100%;
    background: #fdf1f0;
    border: 1px solid #d8413a;
    color: #8a1f1a;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 0.84rem;
  }

  .google {
    margin-top: 10px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 22px;
    border-radius: 8px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    text-decoration: none;
  }

  .g {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fffdf7;
    color: var(--accent-strong);
    font-weight: 900;
  }

  .hint {
    margin-top: 6px;
    color: var(--muted);
    font-size: 0.78rem;
  }
</style>
