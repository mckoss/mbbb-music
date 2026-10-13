// Small, dependency-free helpers for fetching many things over a flaky phone or
// iPad connection (the offline gig download). Pure apart from the injected
// fetch/sleep, so they are unit-tested in test/retry.test.js.

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch with a few retries for transient trouble — a dropped connection, a busy
 * server, or the service worker's 504 while it believes we're offline (its
 * breaker clears within seconds of the network coming back). A 4xx is final.
 */
export async function fetchRetrying(
  url: string,
  delays: number[] = [1500, 4000],
  fetchFn: (url: string) => Promise<Response> = (u) => fetch(u),
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      last = await fetchFn(url);
      if (last.ok || last.status < 500) return last;
    } catch {
      last = null;
    }
    if (attempt >= delays.length) break;
    await sleep(delays[attempt]);
  }
  return last ?? new Response(null, { status: 504 });
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
