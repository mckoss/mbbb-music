<script lang="ts">
  import { onMount } from 'svelte';
  import type { GigMapLocation, MemberLocation } from '$lib/member-map';
  import MemberMapCanvas from './MemberMapCanvas.svelte';

  let { members, gigs = [] }: { members: MemberLocation[]; gigs?: GigMapLocation[] } = $props();
  let expanded = $state(false);

  function close(): void {
    expanded = false;
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && expanded) close();
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = expanded ? 'hidden' : '';
  });

  onMount(() => () => {
    document.body.style.overflow = '';
  });
</script>

<svelte:window onkeydown={keydown} />

<div
  class="preview"
  role="button"
  tabindex="0"
  aria-label="Enlarge member map"
  onclick={() => (expanded = true)}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      expanded = true;
    }
  }}
>
  <MemberMapCanvas {members} {gigs} compact interactive={false} />
  <span class="enlarge">Enlarge map</span>
</div>

{#if expanded}
  <div
    class="backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) close();
    }}
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Band member home map">
      <header>
        <div>
          <h3>Band member map</h3>
          <p>Tap a member for driving directions. Pinch or use +/− to zoom.</p>
        </div>
        <button class="close" onclick={close} aria-label="Close map">×</button>
      </header>
      <div class="large-map"><MemberMapCanvas {members} {gigs} /></div>
    </div>
  </div>
{/if}

<style>
  .preview {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
    cursor: zoom-in;
  }

  .preview:focus-visible {
    outline: 3px solid var(--accent-strong);
    outline-offset: 2px;
  }

  .enlarge {
    position: absolute;
    right: 10px;
    top: 10px;
    z-index: 500;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(32, 33, 36, 0.88);
    color: #fffdf7;
    font-size: 0.72rem;
    font-weight: 800;
    pointer-events: none;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    padding: 14px;
    background: rgba(0, 0, 0, 0.72);
  }

  .dialog {
    width: min(1100px, 100%);
    height: min(820px, calc(100dvh - 28px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 12px;
    background: var(--panel);
    box-shadow: 0 12px 50px rgba(0, 0, 0, 0.55);
  }

  header {
    min-height: 66px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 14px;
    background: #202124;
    color: #fffdf7;
  }

  h3 {
    font-size: 1rem;
  }

  header p {
    color: #c9c6bd;
    font-size: 0.75rem;
  }

  .close {
    width: 48px;
    height: 48px;
    flex: 0 0 auto;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 1.8rem;
    cursor: pointer;
  }

  .large-map {
    flex: 1;
    min-height: 0;
  }
</style>
