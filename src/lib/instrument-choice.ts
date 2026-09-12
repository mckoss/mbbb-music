// Which instrument the app is set to, resolved from its three inputs at once.
//
// There are three: the URL's `?instrument` (a shareable link), the cookie-backed
// store (the member's own saved choice), and the catalog's instrument list (what
// the library actually has parts for). The layout used to reconcile these in two
// separate effects — one mirroring the URL into the store, another replacing a
// value the catalog doesn't carry — and for a URL naming an unknown instrument
// those two wrote over each other forever (effect_update_depth_exceeded), which
// aborted the page's reactivity mid-render.
//
// Resolving all three in one pure, IDEMPOTENT step is what makes that impossible:
// feeding a result back in returns the same value, so the store reaches a fixed
// point after at most one write and the effect stops.

export interface InstrumentLike {
  slug: string;
}

/**
 * The instrument slug the app should settle on.
 *
 * Precedence: a URL override the catalog carries, else the stored choice if the
 * catalog still carries it, else the catalog's first instrument. An unknown slug
 * from either source is ignored rather than re-asserted — a link naming an
 * instrument this library has no parts for (a typo, or a part reassigned since
 * the link was shared) lands the reader on a real one instead.
 *
 * With an empty catalog the stored value is returned untouched: the list isn't
 * loaded (or the viewer isn't approved to see it), and a saved choice must not be
 * thrown away on that basis.
 */
export function resolveInstrument(
  urlInstrument: string | null | undefined,
  stored: string | null | undefined,
  instruments: readonly InstrumentLike[]
): string {
  const list = instruments ?? [];
  const current = stored ?? '';
  if (list.length === 0) return current;
  const carried = (slug: string | null | undefined) => Boolean(slug) && list.some((i) => i.slug === slug);
  if (carried(urlInstrument)) return urlInstrument as string;
  if (carried(current)) return current;
  return list[0].slug;
}
