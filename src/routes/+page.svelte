<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog } from '$lib/types';
  import TuneList from '$lib/components/TuneList.svelte';

  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);
</script>

<!-- One full-width collection list. Every song is an always-visible, folder-style
     summary row (status, instrument part count, content badges, date, quick
     actions) — no inline expansion. No outer card: the list sits directly on the
     page background. -->
<div class="collection">
  <TuneList {tunes} />
</div>

<style>
  .collection {
    max-width: 900px;
    margin: 0 auto;
  }
</style>
