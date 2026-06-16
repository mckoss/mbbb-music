import { streamFriendly } from '$lib/server/download';

// Friendly, slug-addressed downloads for the "file" family. The bytes resolve
// from the path via the catalog index; see src/lib/server/download.ts.
export const GET = ({ params, request, url }) => streamFriendly('file', params.rest, request, url);
