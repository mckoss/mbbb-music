<script lang="ts">
  // The shared practice-player organ: recording picker + chosen-take state +
  // compact transport + no-recording fallback. Used by every practice surface
  // (score overlay's practice bar and score-view player row, the gig set
  // practice bar) so the behavior can't drift between them — the surrounding
  // chrome (back arrows, part pickers, set navigation) stays in each parent.
  //
  // Renders as a fragment (no wrapper element) so the picker and player sit as
  // direct flex children of whatever bar contains them.
  import AudioPlayer from './AudioPlayer.svelte';
  import { audioLabel } from '$lib/format';
  import type { Tune } from '$lib/types';

  let { tune }: { tune: Tune | null } = $props();

  const audios = $derived(tune?.audio ?? []);
  // Default to the first take (the catalog orders the full-band mix first);
  // reset the choice whenever the song changes.
  let chosenSha = $state<string | null>(null);
  $effect(() => {
    void tune?.slug;
    chosenSha = (tune?.audio ?? [])[0]?.sha256 ?? null;
  });
  const chosen = $derived(audios.find((a) => a.sha256 === chosenSha) ?? audios[0] ?? null);
</script>

{#if audios.length > 1}
  <select
    class="rec-sel"
    value={chosenSha}
    onchange={(e) => (chosenSha = e.currentTarget.value)}
    aria-label="Recording"
  >
    {#each audios as a (a.sha256)}
      <option value={a.sha256}>{audioLabel(a.originalName, a.museScore)}</option>
    {/each}
  </select>
{/if}
{#if chosen}
  <AudioPlayer compact sha={chosen.sha256} title={tune?.title ?? ''} />
{:else}
  <span class="no-audio">No recording for this song.</span>
{/if}

<style>
  /* Styled for the dark bars all practice surfaces share. */
  .rec-sel {
    min-height: 44px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #2c2d31;
    color: #fffdf7;
    padding: 0 8px;
    max-width: 32vw;
    flex: none;
  }

  /* Fills the player's slot when a song has no recording, so anything pinned
     after it (set navigation) still sits flush right. */
  .no-audio {
    flex: 1;
    color: #b9b6ac;
    font-size: 0.85rem;
  }
</style>
