// Shared charts describe a musical role and written notation, not one instrument.
// These are candidate buckets: players choose the appropriate role/register and
// admins can remove unsuitable associations without changing the imported asset.
import { detectKey, detectPartNumbers } from './instruments.js';

export function sharedPartMetadata(name, songTitle = '') {
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  let text = fold(name);
  const song = fold(songTitle);
  if (song && text.startsWith(song)) text = text.slice(song.length);
  const role = text.match(/\b(melody|harmony|backbeat|solo|bass line|bass(?!\s+(?:clef|drum|clarinet))|tenor(?!\s+(?:sax|drum))|parts?)\b/);
  if (!role) return null;
  const key = detectKey(name) || (/\bc\b/.test(text) ? 'c' : /\bf\b/.test(text) ? 'f' : null);
  const clef = /\bbass clef\b/.test(text) ? 'bass' : /\btreble clef\b/.test(text) ? 'treble' : null;
  const roleName = role[1].startsWith('part') ? 'Part' : role[1].replace(/\b\w/g, (c) => c.toUpperCase());
  const cleaned = String(name).replace(/[ _-]*(letter|lyre)(?=(\.[^.]*)?$)/i, '');
  const nums = key ? detectPartNumbers(cleaned) : [];
  return { role: roleName, clef, key, partNumber: nums[0] ?? null, ...(nums.length > 1 ? { partNumbers: nums } : {}) };
}

export function compatibleInstruments(meta) {
  if (!meta) return [];
  // Non-C bass-clef notation is not safely inferable from transposition alone.
  if (meta.clef === 'bass' && meta.key !== 'c') return [];
  if (meta.key === 'bflat') return ['trumpet', 'clarinet', 'tenor-sax', 'soprano-sax', 'euphonium'];
  if (meta.key === 'eflat') return ['alto-sax', 'bari-sax'];
  if (meta.key === 'f') return ['french-horn', 'mellophone'];
  if (meta.key === 'c') {
    if (meta.clef === 'bass') return ['trombone', 'euphonium', 'tuba'];
    if (meta.clef === 'treble') return ['flute', 'melodica'];
    return ['flute', 'melodica', 'trombone', 'euphonium', 'tuba'];
  }
  return [];
}
