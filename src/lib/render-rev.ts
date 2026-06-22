// Single source of truth for how scores are rasterized server-side. Both the
// client (which builds the image URL) and the server (which writes the on-disk
// cache path) import these, so a change is applied in lockstep.
//
// Rendered pages are served with `immutable` caching keyed by the PDF's content
// hash, so the bytes for a given URL can never change on their own. The ONE thing
// that *can* change the pixels is a rendering change (engine, DPI). Bumping
// RENDER_REV changes the `?r=` on every image URL, cleanly busting browser/CDN
// caches, while each individual URL stays safely immutable.
//
// Bump RENDER_REV whenever the rasterization changes in any visible way — DPI,
// renderer, encoder settings. RENDER_DPI is folded into the on-disk cache dir
// name for readability; RENDER_REV is what actually invalidates client caches.
export const RENDER_REV = 2;
export const RENDER_DPI = 200;
