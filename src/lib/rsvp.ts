// Shared (client + server) RSVP vocabulary for gig attendance. A member's
// reply to a gig is one of three states; the absence of a reply is a fourth,
// "unconfirmed" — represented as the lack of a row, never stored.
//
//   yes   — confirmed attending (✓)
//   maybe — tentative          (?)
//   no    — can't make it       (✗)
//   (none)— unconfirmed, hasn't replied yet
//
// "Confirmed" elsewhere in the UI means specifically `yes`.

export type RsvpStatus = 'yes' | 'no' | 'maybe';

/** The three real reply states, in display order (Yes, Maybe, No). */
export const RSVP_STATUSES: RsvpStatus[] = ['yes', 'maybe', 'no'];

export function isRsvpStatus(s: unknown): s is RsvpStatus {
  return s === 'yes' || s === 'no' || s === 'maybe';
}

/**
 * Coerce a raw form value to a stored status. Blanks and the literal
 * "unconfirmed" map to null, which the store treats as "clear my reply".
 */
export function parseRsvpStatus(s: unknown): RsvpStatus | null {
  return isRsvpStatus(s) ? s : null;
}

/** Button / heading label for a status (null = the unconfirmed state). */
export function rsvpLabel(s: RsvpStatus | null): string {
  switch (s) {
    case 'yes':
      return 'Yes';
    case 'maybe':
      return 'Maybe';
    case 'no':
      return 'No';
    default:
      return 'Unconfirmed';
  }
}

/** The compact calendar-day mark for a status (empty for unconfirmed). */
export function rsvpMark(s: RsvpStatus | null): string {
  switch (s) {
    case 'yes':
      return '✓';
    case 'maybe':
      return '?';
    case 'no':
      return '✗';
    default:
      return '';
  }
}
