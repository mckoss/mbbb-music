import { streamFriendly } from '$lib/server/download';

// Friendly, slug-addressed downloads for the "score" family. The bytes resolve
// from the path via the catalog index; see src/lib/server/download.ts.
export const GET = ({ params, request, url }) => streamFriendly('score', params.rest, request, url);
