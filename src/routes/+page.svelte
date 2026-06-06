<script lang="ts">
  import { page } from '$app/state';
  import { selectedSlug, instrumentSlug, printFormat } from '$lib/stores';
  import type { Catalog, Tune } from '$lib/types';
  import TuneList from '$lib/components/TuneList.svelte';
  import TuneDetail from '$lib/components/TuneDetail.svelte';

  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);

  // Default the selection to the first tune once tunes are available.
  $effect(() => {
    if ($selectedSlug == null && tunes.length > 0) {
      selectedSlug.set(tunes[0].slug);
    }
  });

  const selected = $derived<Tune | null>(
    tunes.find((t) => t.slug === $selectedSlug) ?? tunes[0] ?? null
  );
</script>

<div class="collection">
  <TuneList {tunes} />
  {#if selected}
    <TuneDetail tune={selected} instrumentSlug={$instrumentSlug} printFormat={$printFormat} />
  {:else}
    <section class="empty">
      <p class="kicker">Selected music</p>
      <p>No tunes in the library yet. Run a sync to populate the collection.</p>
    </section>
  {/if}
</div>

<style>
  .collection {
    display: grid;
    grid-template-columns: minmax(300px, 0.9fr) minmax(460px, 1.35fr);
    gap: 18px;
    max-width: 1480px;
    margin: 0 auto;
  }

  .empty {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    color: var(--muted);
  }

  @media (max-width: 980px) {
    .collection {
      grid-template-columns: 1fr;
    }
  }
</style>
