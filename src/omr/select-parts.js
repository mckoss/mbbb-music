// Choose which of a PDF-only song's part PDFs feed the OMR master score: one
// per instrument + part number (Letter preferred over Lyre — larger engraving
// reads better), skipping shared role charts ("Melody in B♭"), which duplicate
// real parts, and anything app-generated. Ordered like a band score.

import { instrumentLabel } from '../sync/instruments.js';

export const SCORE_ORDER = [
  'flute', 'melodica', 'clarinet', 'soprano-sax', 'alto-sax', 'tenor-sax', 'bari-sax',
  'trumpet', 'mellophone', 'french-horn', 'alto-horn', 'trombone', 'euphonium', 'tuba', 'drums',
];

/**
 * @param {{ parts?: Array<any> }} tune  A catalog tune.
 * @returns {Array<{ sha256: string, name: string, instrumentSlug: string, key: string|null }>}
 */
export function selectPdfParts(tune) {
  const best = new Map();
  for (const p of tune.parts ?? []) {
    if (!p?.sha256 || p.shared || p.generated || !p.instrumentSlug) continue;
    const nums = p.partNumbers ?? (p.partNumber != null ? [p.partNumber] : []);
    const key = `${p.instrumentSlug}|${nums.join('-')}`;
    const cur = best.get(key);
    if (!cur || (cur.format !== 'letter' && p.format === 'letter')) best.set(key, { ...p, nums });
  }
  const rank = (slug) => {
    const i = SCORE_ORDER.indexOf(slug);
    return i < 0 ? SCORE_ORDER.length : i;
  };
  return [...best.values()]
    .sort((a, b) => rank(a.instrumentSlug) - rank(b.instrumentSlug) || (a.nums[0] ?? 0) - (b.nums[0] ?? 0))
    .map((p) => ({
      sha256: p.sha256,
      name: `${instrumentLabel(p.instrumentSlug) || p.instrumentSlug}${p.nums.length ? ` ${p.nums.join(' & ')}` : ''}`,
      instrumentSlug: p.instrumentSlug,
      key: p.key ?? null,
    }));
}
