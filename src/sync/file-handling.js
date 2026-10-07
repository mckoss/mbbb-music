// How the library handles ONE Drive file — the answer to "I can see this file in
// Drive; what did the app do with it?". Pure: it reads the (corrected) manifest
// and the catalog built from it, and explains the file's fate in the same terms
// the catalog builder uses:
//
//   - never imported (ignored type, shortcut, system file), removed from Drive,
//     unreachable, failed or still pending download;
//   - a duplicate: the same bytes live elsewhere, and that copy is the one used;
//   - placed in a song — as which instrument / part / format (and whether it's the
//     default copy players get, or an alternate in the chooser), as a score,
//     recording, notes, MuseScore source, image, or other download;
//   - kept out of the player views: hidden by an admin, or masked by an
//     app-generated replacement;
//   - an Extra File (no song), or not placed at all.

import { canonicalByContent, isLive, sourcePriority } from './catalog.js';
import { isJunkName } from './classify.js';

/** Plain-language reason for an `ignored|<reason>` status. */
export function ignoreReasonText(reason) {
  const r = String(reason ?? '');
  if (r === 'google-drive-shortcut') return 'It is a Drive shortcut. The file it points to is synced on its own.';
  if (r === 'junk') return 'It is a system file (like .DS_Store or a ._ sidecar), not music.';
  if (r === 'google-native-file') return 'It is a Google file type with no PDF export (like a Form), so there is nothing to import.';
  if (r === 'folder') return 'It is a folder.';
  if (r.startsWith('unsupported-type:')) return `Files of type .${r.slice('unsupported-type:'.length)} are not imported.`;
  if (r === 'unknown-type') return 'Its file type is not recognized, so it is not imported.';
  return `It is not imported (${r || 'unknown reason'}).`;
}

const BUCKETS = [
  { key: 'parts', label: 'Instrument part' },
  { key: 'scores', label: 'Full score' },
  { key: 'unclassified', label: 'Shared chart (needs notation review)' },
  { key: 'notes', label: 'Notes' },
  { key: 'audio', label: 'Recording' },
  { key: 'musescore', label: 'MuseScore source' },
  { key: 'images', label: 'Image' },
  { key: 'files', label: 'Other download' },
  { key: 'hiddenParts', label: 'Instrument part (hidden)' },
  { key: 'masked', label: 'Masked' },
];

const partNums = (p) => (p.partNumbers?.length ? p.partNumbers : p.partNumber != null ? [p.partNumber] : []);
const sameSlot = (a, b) =>
  a.instrumentSlug === b.instrumentSlug &&
  partNums(a).join(',') === partNums(b).join(',') &&
  (a.format ?? null) === (b.format ?? null);

/**
 * @typedef {Object} Placement
 * @property {{ slug: string, title: string }} song
 * @property {string} bucket          Catalog bucket key (parts, scores, audio, masked, …).
 * @property {string} bucketLabel     Human label for the bucket.
 * @property {string|null} instrument
 * @property {string|null} instrumentSlug
 * @property {string|null} key
 * @property {string|null} part       "2", or "1 & 2" for a combined chart.
 * @property {string|null} format     'letter' | 'lyre' for parts.
 * @property {string|null} role
 * @property {boolean} shared
 * @property {boolean} [default]      Default copy (true) or an alternate (false); absent when n/a.
 * @property {string[]} notes         Plain-language explanations.
 */

/**
 * Where one catalog item sits, with how players reach it.
 * @returns {Omit<Placement, 'song'>}
 */
function placementOf(tune, bucket, item) {
  const base = {
    bucket: bucket.key,
    bucketLabel: bucket.label,
    instrument: item.instrument ?? null,
    instrumentSlug: item.instrumentSlug ?? null,
    key: item.key ?? null,
    part: partNums(item).join(' & ') || null,
    format: item.format ?? null,
    role: item.role ?? null,
    shared: Boolean(item.shared),
    notes: [],
  };

  if (bucket.key === 'parts') {
    // Copies of the same slot (instrument, part, format): the first is the default
    // a player gets; the rest are alternates in the part chooser.
    const slot = tune.parts.filter((p) => sameSlot(p, item));
    const isDefault = slot[0] === item;
    base.default = isDefault;
    if (!isDefault) {
      base.notes.push(`An alternate copy: players get "${slot[0].originalName}" by default and can switch to this one.`);
    } else if (slot.length > 1) {
      base.notes.push(`The default copy; ${slot.length - 1} alternate${slot.length > 2 ? 's' : ''} in the part chooser.`);
    }
    // The viewer shows only the selected print format's parts when the instrument
    // has any in that format — so a part alone in its format is easy to miss.
    const formats = new Set(tune.parts.filter((p) => p.instrumentSlug === item.instrumentSlug).map((p) => p.format));
    if (formats.size > 1 && item.format) {
      const others = [...formats].filter((f) => f && f !== item.format);
      base.notes.push(
        `Shown only when the ${item.format} format is selected; this instrument also has ${others.join('/')} parts.`,
      );
    }
    if (item.shared) base.notes.push('A shared chart (by clef/role), offered to every compatible instrument.');
  } else if (bucket.key === 'audio' || bucket.key === 'scores') {
    const isDefault = tune[bucket.key][0] === item;
    base.default = isDefault;
    base.notes.push(
      isDefault
        ? bucket.key === 'audio'
          ? 'The default recording for this song.'
          : 'The default full score for this song.'
        : `An alternate; "${tune[bucket.key][0].originalName}" is the default.`,
    );
  } else if (bucket.key === 'hiddenParts') {
    base.notes.push(
      item.hiddenGlobally ? 'Hidden by an admin (the whole file).' : `Hidden by an admin for ${item.instrument}.`,
    );
  } else if (bucket.key === 'masked') {
    base.bucketLabel = `Masked ${item.bucket === 'scores' ? 'score' : 'part'}`;
    base.notes.push('Kept out of the player views because an app-generated version replaces it. Still listed on File Info.');
  }
  return base;
}

/**
 * Every catalog placement of one Drive file id.
 * @returns {Placement[]}
 */
function placementsFor(catalog, id) {
  /** @type {Placement[]} */
  const out = [];
  for (const tune of catalog.tunes || []) {
    for (const bucket of BUCKETS) {
      for (const item of tune[bucket.key] || []) {
        if (item.driveFileId === id) out.push({ song: { slug: tune.slug, title: tune.title }, ...placementOf(tune, bucket, item) });
      }
    }
  }
  return out;
}

/**
 * Explain how the library handles one Drive file.
 *
 * @param {string} id  Drive file id
 * @param {{ files: Record<string, object> }} manifest  The corrected manifest the catalog was built from.
 * @param {{ tunes: object[], extras: object[], sources: string[] }} catalog
 * @returns {null | {
 *   state: string, headline: string, detail: string|null,
 *   placements: Placement[], extra: boolean,
 *   canonical: null | { id: string, name: string|null, location: string|null },
 * }}
 */
export function describeHandling(id, manifest, catalog) {
  const e = manifest?.files?.[id];
  if (!e) return null;
  const status = String(e.status ?? '');
  const result = (state, headline, detail = null, more = {}) => ({
    state,
    headline,
    detail,
    placements: [],
    extra: false,
    canonical: null,
    ...more,
  });

  if (status === 'deleted') {
    return result('removed', 'Removed — no longer in Drive.', 'The stored copy is kept, but it is out of the library.');
  }
  if (status.startsWith('ignored')) {
    return result('ignored', 'Not imported.', ignoreReasonText(status.split('|')[1]));
  }
  if (status === 'unreachable') {
    return result(
      'unreachable',
      'Unreachable — a shortcut to a file the sync cannot read.',
      'Share the target file with the sync (or "anyone with the link") and re-sync.',
    );
  }
  if (status === 'error') return result('failed', 'Download failed.', e.error ?? null);
  if (status === 'pending') return result('pending', 'Waiting to download.', 'The next sync fetches it.');
  if (!isLive(e) || isJunkName(e.originalName)) {
    return result('ignored', 'Not imported.', ignoreReasonText('junk'));
  }

  // Identical bytes collapse to one canonical copy; any other copy is a duplicate.
  const pri = sourcePriority(catalog?.sources ?? [], manifest);
  const { canonical } = canonicalByContent(manifest, pri);
  const canon = canonical.get(e.sha256 || `id:${id}`) ?? e;
  if (canon.driveFileId && canon.driveFileId !== id) {
    const where = [canon.sourceFolderLabel, ...(canon.folderPath ?? (canon.originalFolder ? [canon.originalFolder] : []))]
      .filter(Boolean)
      .join(' / ');
    return result(
      'duplicate',
      'A duplicate — the library uses another copy with the same content.',
      'Identical files are stored once; the copy in a real song folder (then the higher-priority source) wins.',
      {
        canonical: { id: canon.driveFileId, name: canon.originalName ?? null, location: where || null },
        placements: placementsFor(catalog, canon.driveFileId),
      },
    );
  }

  const placements = placementsFor(catalog, id);
  if (placements.length) {
    const visible = placements.some((p) => p.bucket !== 'masked' && p.bucket !== 'hiddenParts');
    return result(
      visible ? 'in-library' : 'kept-out',
      visible ? 'In the library.' : 'Synced, but kept out of the player views.',
      null,
      { placements },
    );
  }
  if ((catalog?.extras ?? []).some((x) => x.sha256 && x.sha256 === e.sha256)) {
    return result(
      'extra',
      'An Extra File — synced, but not matched to any song.',
      'It is not in a song folder and its name does not start with a known song title. Assign it to a song with a correction.',
      { extra: true },
    );
  }
  return result('unplaced', 'Synced, but not placed in the library.', null);
}
