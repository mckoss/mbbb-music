<script lang="ts">
  import { page } from '$app/state';
  import { instrumentSlug, printFormat } from '$lib/stores';
  import type { Catalog, Tune } from '$lib/types';
  import TuneList from '$lib/components/TuneList.svelte';
  import TuneDetail from '$lib/components/TuneDetail.svelte';

  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);

  // The selected song lives in the URL (?song=<slug>) so it survives a refresh
  // and each change is a history entry. Falls back to the first tune when unset.
  const selected = $derived<Tune | null>(
    tunes.find((t) => t.slug === page.url.searchParams.get('song')) ?? tunes[0] ?? null
  );
</script>

<div class="collection">
  <TuneList {tunes} selectedSlug={selected?.slug ?? null} />
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
    /* Don't stretch the panes to equal height: the detail pane (with its PDF
       preview) is tall, and stretching the list pane to match left dead space
       below the (shorter) list. Let each pane take its natural height. */
    align-items: start;
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
