// Where each instrument's part starts inside a whole-band chart.
//
// The band's arrangements arrive as one PDF holding every player's part back to
// back, so "find your instrument" means paging through a 17-page document on a
// music stand. The engraver already printed the answer — the part name sits in
// each opening page's left margin — so read it once per score and hand the viewer
// a page to jump to.
//
// Derived purely from the PDF bytes, so the index is immutable per content hash
// and caches exactly like the page count: memory, then an on-disk sidecar beside
// data/render/meta, then a cold open. Admin overrides are NOT folded in here —
// they live in the corrections overlay and ride on the catalog, so this stays a
// pure function of the content and the /render/<sha>/info response stays
// immutable and offline-cacheable.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { buildPartPages } from '../../sync/part-labels.js';
import { openScorePdf } from './render.js';

/** One part's opening page within a whole-band chart. */
export interface PartPage {
  page: number;
  label: string;
  instruments: string[];
}

const indexes = new Map<string, PartPage[]>();
const inflight = new Map<string, Promise<PartPage[]>>();

function sidecarPath(sha: string): string {
  return resolve(loadConfig().dataDir, 'render', 'parts', `${sha}.json`);
}

async function readSidecar(sha: string): Promise<PartPage[] | null> {
  try {
    const { pages } = JSON.parse(await readFile(sidecarPath(sha), 'utf8'));
    return Array.isArray(pages) ? pages : null;
  } catch {
    return null;
  }
}

let tmpSeq = 0;
/** Write the sidecar atomically (temp + rename) so a torn read can't happen. */
async function writeSidecar(sha: string, pages: PartPage[]): Promise<void> {
  const path = sidecarPath(sha);
  await mkdir(resolve(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.${tmpSeq++}.tmp`;
  await writeFile(tmp, JSON.stringify({ pages }));
  await rename(tmp, path);
}

/**
 * The part-page index for a score, or `[]` when the PDF isn't a parts compilation
 * (a single part, a conductor score, an image-only scan). Never throws: a PDF that
 * won't parse simply has no index, and the viewer falls back to page 1.
 */
export async function getPartPages(sha: string): Promise<PartPage[]> {
  const mem = indexes.get(sha);
  if (mem) return mem;

  const disk = await readSidecar(sha);
  if (disk) {
    indexes.set(sha, disk);
    return disk;
  }

  const existing = inflight.get(sha);
  if (existing) return existing;
  const job = computeIndex(sha).finally(() => inflight.delete(sha));
  inflight.set(sha, job);
  return job;
}

/** Cold path: read every page's text once, then record the index. */
async function computeIndex(sha: string): Promise<PartPage[]> {
  let pages: PartPage[] = [];
  try {
    const opened = await openScorePdf(sha);
    if (!opened) return [];
    const { doc, task } = opened;
    try {
      const texts = [];
      const sizes = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        sizes.push({ width: viewport.width, height: viewport.height });
        texts.push(
          content.items
            // `transform` is [a,b,c,d,e,f]; e/f are the run's x/y in PDF space,
            // which measures up from the bottom — flip it so `y` reads down the
            // page like the layout rules in part-labels.
            .filter((it: { str?: string }) => (it.str ?? '').trim())
            .map((it: { str: string; transform: number[] }) => ({
              text: it.str.trim(),
              x: it.transform[4],
              y: viewport.height - it.transform[5],
            }))
        );
      }
      pages = buildPartPages(texts, sizes);
    } finally {
      await task.destroy();
    }
  } catch {
    // An unparseable or text-free PDF has no index; that is not an error.
    pages = [];
  }
  indexes.set(sha, pages);
  await writeSidecar(sha, pages).catch(() => {
    /* the in-memory index still serves this process */
  });
  return pages;
}
