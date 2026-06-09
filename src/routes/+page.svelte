<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog, Tune } from '$lib/types';
  import TuneList from '$lib/components/TuneList.svelte';

  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);

  // The selected song lives in the URL (?song=<slug>) so it survives a refresh
  // and each change is a history entry. Falls back to the first tune when unset.
  const selected = $derived<Tune | null>(
    tunes.find((t) => t.slug === page.url.searchParams.get('song')) ?? tunes[0] ?? null
  );
</script>

<!-- One full-width collection list. The selected song expands in place (the
     detail used to live in a separate side panel that fell to the bottom on
     mobile). No outer card: the list sits directly on the page background. -->
<div class="collection">
  <TuneList {tunes} {selected} />
</div>

<style>
  .collection {
    max-width: 900px;
    margin: 0 auto;
  }
</style>
