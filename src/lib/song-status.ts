// Shared song-status model used by both client and server (no server imports, so
// it's safe to import anywhere). An admin annotates a song with one of the four
// assignable statuses; a song with no annotation is "Unfiled".

export type SongStatus = 'Always' | 'Active' | 'Learning' | 'Archive' | 'Unfiled';

/** The statuses an admin can assign (persisted). "Unfiled" is the absence of one. */
export const ASSIGNABLE_STATUSES = ['Always', 'Active', 'Learning', 'Archive'] as const;

/** Display/group order, including the catch-all for unannotated songs. */
export const ALL_STATUSES: SongStatus[] = ['Always', 'Active', 'Learning', 'Archive', 'Unfiled'];

/** A song with no stored annotation. */
export const DEFAULT_STATUS: SongStatus = 'Unfiled';

/** One-line meaning of each status, for tooltips/help text. */
export const STATUS_DESC: Record<SongStatus, string> = {
  Always: 'Long-term repertoire',
  Active: "In the current season's set list",
  Learning: 'New song being added to the Active set',
  Archive: 'No longer actively played',
  Unfiled: 'Not yet categorized',
};

/**
 * Coerce arbitrary input to a stored status, or null to clear it. "Unfiled" and
 * anything unrecognized clear the annotation (the song falls back to default).
 */
export function normalizeStatus(value: unknown): (typeof ASSIGNABLE_STATUSES)[number] | null {
  return (ASSIGNABLE_STATUSES as readonly string[]).includes(value as string)
    ? (value as (typeof ASSIGNABLE_STATUSES)[number])
    : null;
}
