const PACIFIC_TIME = 'America/Los_Angeles';

const pacificDateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: PACIFIC_TIME,
  timeZoneName: 'short',
});

export function formatPacificDateTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : pacificDateTime.format(d);
}

// --- Relative "last seen" phrasing -----------------------------------------

const pacificYmd = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: PACIFIC_TIME,
});

const pacificClock = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: PACIFIC_TIME,
});

const pacificDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: PACIFIC_TIME,
});

/** Calendar days between two instants, counted in Pacific time (not 24h spans). */
function pacificDaysApart(then: Date, now: Date): number {
  // "2026-07-13" → midnight UTC of that Pacific calendar day, so the difference
  // is a whole number of calendar days no matter where DST falls between them.
  const dayStart = (d: Date) => Date.parse(`${pacificYmd.format(d)}T00:00:00Z`);
  return Math.round((dayStart(now) - dayStart(then)) / 86_400_000);
}

/** "5:04pm" — the en-US "5:04 PM" tightened up. */
function clock(d: Date): string {
  return pacificClock.format(d).replace(/\s+/g, '').toLowerCase();
}

/**
 * How long ago, in band time: "Today @ 5:04pm", "Yesterday @ 9:12am",
 * "6 days ago @ 8:30am". Past a month the relative form stops meaning much, so
 * it falls back to the date: "Mar 4, 2026 @ 7:15pm".
 */
export function formatLastSeen(at: string, now: Date = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;

  const days = pacificDaysApart(d, now);
  const when =
    days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days <= 30 ? `${days} days ago` : pacificDate.format(d);
  return `${when} @ ${clock(d)}`;
}
