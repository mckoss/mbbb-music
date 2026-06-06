import { json } from '@sveltejs/kit';

import { getCatalog } from '$lib/server/library';

// The catalog is small (tens of tunes) and changes only on sync, so send it
// whole and let the client filter by instrument. No-store keeps a freshly
// synced manifest from being masked by a stale cache during development.
export function GET() {
  return json(getCatalog(), { headers: { 'cache-control': 'no-store' } });
}
