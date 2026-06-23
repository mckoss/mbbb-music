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
