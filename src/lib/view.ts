// Shared links into the in-app file viewer (src/routes/view/[sha]). Opening a raw
// /blob or friendly asset URL in a new tab is a dead-end in the installed
// (standalone) PWA — no chrome, no way back. Routing through /view keeps a back
// affordance and picks the right presentation per file type:
//   pdf      → the WebP PdfPager (scores, full scores, notes)
//   image    → the bytes shown inline
//   audio    → the in-app AudioPlayer
//   download → a card with a Download button (MuseScore .mscz, archives, misc)

export type ViewKind = 'pdf' | 'image' | 'audio' | 'download';

/** Map a catalog asset type to a viewer kind. Parts/scores have no assetType but
 *  are always PDFs, so callers pass 'pdf' directly for those. */
export function viewKind(assetType: string | null | undefined): ViewKind {
  switch (assetType) {
    case 'pdf':
    case 'notes':
      return 'pdf';
    case 'image':
      return 'image';
    case 'mp3':
      return 'audio';
    default:
      return 'download'; // musescore, archives, docs, unknown
  }
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg']);

/** Infer a viewer kind from a filename or URL's extension. Used where only a
 *  friendly URL is on hand (the file browser), since its extension reflects the
 *  true type even when the raw Drive name doesn't (e.g. notes → .pdf). */
export function viewKindFromName(nameOrUrl: string): ViewKind {
  const m = nameOrUrl.toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
  const ext = m ? m[1] : '';
  if (ext === 'pdf') return 'pdf';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'download';
}

/** Build a link into the in-app viewer. `kind` defaults to 'pdf' (omitted from
 *  the query when default). `url` carries the friendly asset URL the viewer uses
 *  for an image's `src` or a download target. */
export function viewHref(opts: {
  sha: string;
  kind?: ViewKind;
  title?: string;
  from?: string;
  url?: string;
}): string {
  const p = new URLSearchParams();
  if (opts.kind && opts.kind !== 'pdf') p.set('kind', opts.kind);
  if (opts.title) p.set('title', opts.title);
  if (opts.from) p.set('from', opts.from);
  if (opts.url) p.set('url', opts.url);
  const q = p.toString();
  return `/view/${opts.sha}${q ? `?${q}` : ''}`;
}
