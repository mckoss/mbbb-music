<script lang="ts">
  // A small, date-picker-sized month grid. Days that have a gig are colored
  // (green = active, red = canceled) and link to that gig. Used three-up at the
  // top of the gig list to show the current month and the next two.
  import type { Gig } from '$lib/gig';
  import { rsvpMark, rsvpLabel, type RsvpStatus } from '$lib/rsvp';

  interface DayCell {
    day: number;
    iso: string;
    gigs: Gig[];
  }

  let {
    year,
    month, // 0-based, like Date#getMonth
    gigsByDate,
    today,
    rsvpByDate = new Map(),
  }: {
    year: number;
    month: number;
    gigsByDate: Map<string, Gig[]>;
    today: string;
    // The signed-in member's reply for a gig on a given day (drives the ✓/?/✗ mark).
    rsvpByDate?: Map<string, RsvpStatus>;
  } = $props();

  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const monthLabel = $derived(
    new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  );

  // Leading blanks to align the 1st under its weekday, then one cell per day.
  const cells = $derived.by(() => {
    const lead = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (DayCell | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      out.push({ day: d, iso, gigs: gigsByDate.get(iso) ?? [] });
    }
    return out;
  });

  // Green if any gig that day is still on; red only when every gig is canceled.
  function status(gigs: Gig[]): 'active' | 'canceled' | null {
    if (gigs.length === 0) return null;
    return gigs.some((g) => !g.canceled) ? 'active' : 'canceled';
  }

  // Open the first live gig that day, falling back to the first one.
  function href(gigs: Gig[]): string {
    const g = gigs.find((x) => !x.canceled) ?? gigs[0];
    return `/gigs/${g.id}`;
  }

  function label(gigs: Gig[]): string {
    return gigs.map((g) => (g.canceled ? `${g.name} (canceled)` : g.name)).join(', ');
  }
</script>

<div class="cal">
  <div class="title">{monthLabel}</div>
  <div class="grid">
    {#each WEEKDAYS as w, i (i)}
      <div class="dow">{w}</div>
    {/each}
    {#each cells as cell, i (i)}
      {#if !cell}
        <span class="pad"></span>
      {:else if cell.gigs.length > 0}
        {@const mine = rsvpByDate.get(cell.iso) ?? null}
        <a
          class="day {status(cell.gigs)}"
          class:today={cell.iso === today}
          href={href(cell.gigs)}
          title={mine ? `${label(cell.gigs)} — you: ${rsvpLabel(mine)}` : label(cell.gigs)}
        >{cell.day}{#if mine}<span class="rsvp {mine}" aria-hidden="true">{rsvpMark(mine)}</span>{/if}</a>
      {:else}
        <span class="day" class:today={cell.iso === today}>{cell.day}</span>
      {/if}
    {/each}
  </div>
</div>

<style>
  .cal {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px 12px;
    flex: 1 1 220px;
    min-width: 200px;
    max-width: 280px;
  }

  .title {
    text-align: center;
    font-weight: 700;
    font-size: 0.85rem;
    margin-bottom: 6px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }

  .dow {
    text-align: center;
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--muted);
    padding-bottom: 2px;
  }

  .pad {
    aspect-ratio: 1;
  }

  .day {
    position: relative;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    border-radius: 5px;
    color: var(--ink);
    text-decoration: none;
  }

  /* The signed-in member's reply, a tiny badge in the day's top-right corner. */
  .rsvp {
    position: absolute;
    top: -3px;
    right: -2px;
    min-width: 11px;
    height: 11px;
    padding: 0 1px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    font-size: 0.56rem;
    font-weight: 800;
    line-height: 1;
    color: #fffdf7;
    border: 1px solid #fffdf7;
  }

  .rsvp.yes {
    background: #1b5e20;
  }

  .rsvp.maybe {
    background: #b26a00;
  }

  .rsvp.no {
    background: #8f1e18;
  }

  /* Gig days are filled, bold, and clickable. */
  a.day {
    font-weight: 700;
    color: #fffdf7;
  }

  a.day.active {
    background: #2e7d32;
  }

  a.day.active:hover {
    background: #246628;
  }

  a.day.canceled {
    background: #b3261e;
    text-decoration: line-through;
    text-decoration-thickness: 1.5px;
  }

  a.day.canceled:hover {
    background: #8f1e18;
  }

  /* Today gets a ring on top of whatever fill it has. */
  .day.today {
    box-shadow: inset 0 0 0 2px var(--accent-strong);
  }
</style>
