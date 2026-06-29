// A tiny client-only signal that the current user just performed a content
// mutation (e.g. editing a gig or its setlist). The root layout uses it to tell
// *your own* edit from a passive background change: when the service worker's
// revalidate reports newer data shortly after you saved, the layout silently
// refreshes the page (it's your edit landing) instead of raising the dismissible
// nudge. Updates that arrive without a recent self-mutation — another admin's
// change, a re-sync — still nudge, so content never swaps under you mid-task.
//
// A plain module variable (not a store) is enough: the layout reads it
// imperatively inside the service-worker message handler, never in markup.

let lastSelfMutation = 0;

/** Call right after a successful user-initiated mutation. */
export function markSelfMutation(): void {
  lastSelfMutation = Date.now();
}

/**
 * True (once) when an update arriving now is plausibly the user's own edit
 * landing. Consumes the signal so only the edit's own revalidate auto-applies;
 * a later passive update falls through to the nudge. The window bounds the gap
 * between saving and the background revalidate posting its message.
 */
export function consumeSelfMutation(windowMs = 15_000): boolean {
  if (Date.now() - lastSelfMutation < windowMs) {
    lastSelfMutation = 0;
    return true;
  }
  return false;
}
