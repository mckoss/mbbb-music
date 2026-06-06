import type { Catalog } from '$lib/types';

export async function load({ fetch }) {
  const catalog: Catalog = await fetch('/api/catalog').then((r) => r.json());
  return { catalog };
}
