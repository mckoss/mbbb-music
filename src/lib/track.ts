// Fire-and-forget client beacon for view/performance activity. The server
// attaches the signed-in identity; we only report the kind of view. Failures are
// swallowed — analytics must never disrupt the page.

type BeaconType = 'score-view' | 'performance';

export function track(type: BeaconType, label: string | null, detail?: string | null): void {
  if (typeof fetch === 'undefined') return;
  try {
    void fetch('/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, label, detail: detail ?? null }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
