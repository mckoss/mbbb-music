// Fire-and-forget client beacon for view/performance activity. The server
// attaches the signed-in identity; we only report the kind of view. The service
// worker owns offline queueing/replay for this endpoint.

type BeaconType = 'score-view' | 'performance';

let listenersInstalled = false;

export function startActivitySync(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  const flush = () => navigator.serviceWorker?.controller?.postMessage({ type: 'flush-activity' });
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
  flush();
}

export function track(type: BeaconType, label: string | null, detail?: string | null): void {
  if (typeof fetch === 'undefined') return;
  startActivitySync();
  try {
    void fetch('/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, label, detail: detail ?? null, at: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Best effort. If the service worker is active it queues failed POSTs.
  }
}
