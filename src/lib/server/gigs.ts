// Server-only gig-packet store. Gigs live in a writable data/gigs.json so an
// organizer/admin can create and edit them at runtime; they survive a Drive
// re-sync (which only rewrites the manifest and content store). Atomic
// temp-file + rename writes mirror users.ts / song-status.ts.
//
// Every function takes an optional `dataDir` so tests can point the store at a
// temp directory (never the real data/). It defaults to loadConfig().dataDir.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';
// Imported by relative path (not the $lib alias) so the store is unit-testable
// under plain `node --test`. The .js specifier is the SvelteKit/TS convention;
// the test runner resolves it to the .ts source via test/loader.mjs.
import {
  makeGig,
  normalizeSets,
  normalizeTimes,
  normalizeLocation,
  normalizeUrl,
  isValidDate,
  emptySet,
  newId,
  type Gig,
  type GigInput,
  type GigSet,
} from '../gig.js';

interface GigsFile {
  gigs: Gig[];
}

function gigsPath(dataDir?: string): string {
  return resolve(dataDir ?? loadConfig().dataDir, 'gigs.json');
}

function readFile(dataDir?: string): GigsFile {
  try {
    const parsed = JSON.parse(readFileSync(gigsPath(dataDir), 'utf8'));
    return { gigs: Array.isArray(parsed.gigs) ? parsed.gigs : [] };
  } catch {
    return { gigs: [] };
  }
}

function writeFileAtomic(data: GigsFile, dataDir?: string): void {
  const path = gigsPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/** All gigs, in stored order (callers sort for display). */
export function listGigs(dataDir?: string): Gig[] {
  return readFile(dataDir).gigs;
}

/** A single gig by id, or null when not found. */
export function getGig(id: string, dataDir?: string): Gig | null {
  return readFile(dataDir).gigs.find((g) => g.id === id) ?? null;
}

/** Create a new gig from input, returning the stored gig (with its new id). */
export function createGig(input: GigInput, dataDir?: string): Gig {
  const gig = makeGig(input);
  const data = readFile(dataDir);
  data.gigs.push(gig);
  writeFileAtomic(data, dataDir);
  return gig;
}

/** Duplicate an existing gig, copying its info and setlists into a new gig. */
export function duplicateGig(id: string, dataDir?: string): Gig | null {
  const source = getGig(id, dataDir);
  if (!source) return null;
  return createGig(
    {
      name: `${source.name} Copy`,
      date: source.date,
      ...(source.times ? { times: source.times.map((t) => ({ ...t })) } : {}),
      ...(source.location ? { location: { ...source.location } } : {}),
      ...(source.notes ? { notes: source.notes } : {}),
      ...(source.publicNotes ? { publicNotes: source.publicNotes } : {}),
      ...(source.eventUrl ? { eventUrl: source.eventUrl } : {}),
      // A copy of a private booking stays private until someone says otherwise.
      ...(source.hidden ? { hidden: true } : {}),
      sets: source.sets.map((set) => ({
        ...set,
        id: newId(),
        songSlugs: [...set.songSlugs],
      })),
    },
    dataDir
  );
}

/**
 * The parts of a gig that a calendar subscriber can see. Comparing this before
 * and after an edit tells us whether to bump `rev` (the iCal SEQUENCE): a
 * setlist change is invisible to a subscriber and shouldn't churn their
 * calendar, but a moved date or a new venue must.
 */
function calendarFingerprint(gig: Gig): string {
  const { name, date, times, location, publicNotes, eventUrl, canceled, hidden } = gig;
  return JSON.stringify({ name, date, times, location, publicNotes, eventUrl, canceled, hidden });
}

/**
 * Apply a partial patch to a gig's top-level fields (name/date/times/location/
 * notes/publicNotes/hidden/sets), normalizing each. Returns the updated gig, or
 * null when the id is unknown. Only the keys present in `patch` are touched.
 */
export function updateGig(id: string, patch: Partial<GigInput>, dataDir?: string): Gig | null {
  const data = readFile(dataDir);
  const gig = data.gigs.find((g) => g.id === id);
  if (!gig) return null;

  const before = calendarFingerprint(gig);

  if (patch.name !== undefined) gig.name = String(patch.name).trim() || 'Untitled gig';
  if (patch.date !== undefined) gig.date = isValidDate(patch.date) ? patch.date : '';
  if (patch.times !== undefined) {
    const times = normalizeTimes(patch.times);
    if (times.length > 0) gig.times = times;
    else delete gig.times;
  }
  if (patch.location !== undefined) {
    const loc = normalizeLocation(patch.location);
    if (loc) gig.location = loc;
    else delete gig.location;
  }
  if (patch.notes !== undefined) {
    const notes = String(patch.notes);
    if (notes.trim()) gig.notes = notes;
    else delete gig.notes;
  }
  if (patch.publicNotes !== undefined) {
    const publicNotes = String(patch.publicNotes);
    if (publicNotes.trim()) gig.publicNotes = publicNotes;
    else delete gig.publicNotes;
  }
  if (patch.eventUrl !== undefined) {
    // A URL we can't vouch for is dropped, not stored — see normalizeUrl.
    const eventUrl = normalizeUrl(patch.eventUrl);
    if (eventUrl) gig.eventUrl = eventUrl;
    else delete gig.eventUrl;
  }
  if (patch.hidden !== undefined) {
    if (patch.hidden) gig.hidden = true;
    else delete gig.hidden;
  }
  if (patch.sets !== undefined) {
    const sets = normalizeSets(patch.sets);
    gig.sets = sets.length > 0 ? sets : [emptySet()];
  }
  if (patch.canceled !== undefined) {
    if (patch.canceled) gig.canceled = true;
    else delete gig.canceled;
  }

  // Anything a subscriber would notice → advance the sequence, so their calendar
  // accepts the update instead of keeping the copy it already has.
  if (calendarFingerprint(gig) !== before) gig.rev = (gig.rev ?? 0) + 1;

  writeFileAtomic(data, dataDir);
  return gig;
}

/** Delete a gig by id. Returns true when something was removed. */
export function deleteGig(id: string, dataDir?: string): boolean {
  const data = readFile(dataDir);
  const before = data.gigs.length;
  data.gigs = data.gigs.filter((g) => g.id !== id);
  if (data.gigs.length === before) return false;
  writeFileAtomic(data, dataDir);
  return true;
}

// --- Setlist mutations (convenience wrappers over updateGig) ----------------
// Each loads the gig, mutates its sets in memory, and writes the whole gig back
// through updateGig so all writes go through one normalized, atomic path.

/** Find a set within a gig by id. */
function findSet(gig: Gig, setId: string): GigSet | undefined {
  return gig.sets.find((s) => s.id === setId);
}

/** Append a new empty set to a gig. Returns the updated gig (or null). */
export function addSet(id: string, name: string | undefined, dataDir?: string): Gig | null {
  const gig = getGig(id, dataDir);
  if (!gig) return null;
  gig.sets.push(emptySet(name));
  return updateGig(id, { sets: gig.sets }, dataDir);
}

/** Rename a set. A blank name clears it (the UI falls back to "Set N"). */
export function renameSet(id: string, setId: string, name: string, dataDir?: string): Gig | null {
  const gig = getGig(id, dataDir);
  if (!gig) return null;
  const set = findSet(gig, setId);
  if (!set) return gig;
  const trimmed = name.trim();
  if (trimmed) set.name = trimmed;
  else delete set.name;
  return updateGig(id, { sets: gig.sets }, dataDir);
}

/** Remove a set from a gig (never drops the last set; clears it instead). */
export function removeSet(id: string, setId: string, dataDir?: string): Gig | null {
  const gig = getGig(id, dataDir);
  if (!gig) return null;
  gig.sets = gig.sets.filter((s) => s.id !== setId);
  return updateGig(id, { sets: gig.sets }, dataDir);
}

/** Add a song slug to a set (no duplicates within the same set). */
export function addSong(id: string, setId: string, slug: string, dataDir?: string): Gig | null {
  const gig = getGig(id, dataDir);
  if (!gig) return null;
  const set = findSet(gig, setId);
  if (!set || !slug) return gig;
  if (!set.songSlugs.includes(slug)) set.songSlugs.push(slug);
  return updateGig(id, { sets: gig.sets }, dataDir);
}

/** Remove a song slug from a set. */
export function removeSong(id: string, setId: string, slug: string, dataDir?: string): Gig | null {
  const gig = getGig(id, dataDir);
  if (!gig) return null;
  const set = findSet(gig, setId);
  if (!set) return gig;
  set.songSlugs = set.songSlugs.filter((s) => s !== slug);
  return updateGig(id, { sets: gig.sets }, dataDir);
}

/**
 * Move a song within a set by one step ('up' or 'down'). Clamped at the ends
 * (a no-op past the boundary). Returns the updated gig.
 */
export function moveSong(
  id: string,
  setId: string,
  slug: string,
  dir: 'up' | 'down',
  dataDir?: string
): Gig | null {
  const gig = getGig(id, dataDir);
  if (!gig) return null;
  const set = findSet(gig, setId);
  if (!set) return gig;
  const i = set.songSlugs.indexOf(slug);
  if (i < 0) return gig;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= set.songSlugs.length) return gig; // already at the boundary
  [set.songSlugs[i], set.songSlugs[j]] = [set.songSlugs[j], set.songSlugs[i]];
  return updateGig(id, { sets: gig.sets }, dataDir);
}
