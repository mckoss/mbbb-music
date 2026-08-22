// Score-tempo extraction over the CAS. Reads a tune's .mscz blob and pulls the
// opening tempo / time signature / pickup facts (src/sync/mscz.js). Blobs are
// content-addressed, so a sha's facts never change — cache them for the life of
// the process, including failures (a corrupt blob stays corrupt).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { extractMsczFacts } from '../../sync/mscz.js';

type Facts = ReturnType<typeof extractMsczFacts>;

const cache = new Map<string, Facts>();

/** Extracted score facts for a .mscz blob, or null when unreadable/absent. */
export function msczFacts(sha: string, casDir: string): Facts {
  const hit = cache.get(sha);
  if (hit !== undefined) return hit;
  let facts: Facts = null;
  try {
    facts = extractMsczFacts(readFileSync(resolve(casDir, sha)));
  } catch {
    facts = null;
  }
  cache.set(sha, facts);
  return facts;
}
