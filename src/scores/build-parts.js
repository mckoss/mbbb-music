// Build per-instrument part PDFs (one per print format) from a MuseScore file.
//
// Flow for one input .mscz:
//   1. `mscore <in> --score-parts` → JSON { parts: [names], partsBin: [b64 mscz] }
//      (MuseScore returns each linked part as a base64-encoded .mscz on stdout).
//   2. Decode each part to a temp .mscz. If the score defines no parts, fall back
//      to treating the whole file as a single part, so there's always output.
//   3. For each format, render ALL parts in a single MuseScore run via a batch
//      job file (`-j`) with that format's style (`-S`), writing each PDF into
//      <input>.parts/ named <title>-<instrument>[-<key>][-part<n>]-<format>.pdf.
//
// Why one job per format instead of one `mscore` call per (part, format):
// MuseScore 4 on macOS intermittently aborts during Qt GUI startup, so every
// launch is a coin-flip. Batching collapses dozens of launches into one per
// format (3 total for letter+lyre), and runMscore retries the startup abort —
// together that's what makes a multi-part build reliable.

import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

import { runMscore } from './musescore.js';
import { FORMATS, FORMAT_KEYS, styleFileFor } from './formats.js';
import { stampCorners } from './stamp.js';
import { stripTitleFrame } from './strip-title.js';
import { slugify, slugifyStem } from '../sync/slugify.js';
import { detectInstrument, detectKey, detectPartNumber } from '../sync/instruments.js';

/** Local render timestamp as `YYYY-MM-DD HH:MM` (24-hour), unique per minute. */
function renderStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A descriptive slug for one part, derived from its MuseScore part name. Mirrors
 * the catalog's part naming (src/lib/asset-urls.ts): instrument[-key][-partN].
 * Falls back to a slug of the raw name when the instrument isn't recognized.
 *
 * @param {string} partName
 * @param {number} index  Position, for disambiguating unnamed parts.
 * @returns {string}
 */
function partSlug(partName, index) {
  const inst = detectInstrument(partName);
  const key = detectKey(partName);
  const num = detectPartNumber(partName);
  const bits = [];
  bits.push(inst ? inst.slug : slugify(partName) || `part${index + 1}`);
  if (key) bits.push(key);
  if (num != null) bits.push(`part${num}`);
  return bits.join('-');
}

/**
 * Extract the linked parts of a score as temp .mscz files. Returns a list of
 * { name, path }. When the score has no parts, returns a single entry pointing
 * at the original input (rendered whole).
 *
 * @param {string} bin       MuseScore binary.
 * @param {string} input     Path to the source .mscz.
 * @param {string} workDir   Temp dir for extracted part files.
 * @returns {Promise<Array<{ name: string, path: string }>>}
 */
async function extractParts(bin, input, workDir) {
  let data;
  try {
    data = JSON.parse(await runMscore(bin, [input, '--score-parts']));
  } catch {
    data = null;
  }
  const names = Array.isArray(data?.parts) ? data.parts : [];
  const bins = Array.isArray(data?.partsBin) ? data.partsBin : [];

  if (!names.length || names.length !== bins.length) {
    // No well-defined parts (or unexpected shape): render the whole score as one
    // "part". The score's own instrument name isn't known here, so use the file.
    return [{ name: slugifyStem(basename(input)), path: input }];
  }

  const parts = [];
  for (let i = 0; i < names.length; i++) {
    const path = join(workDir, `part-${i}.mscz`);
    await writeFile(path, Buffer.from(bins[i], 'base64'));
    parts.push({ name: names[i], path });
  }
  return parts;
}

/**
 * Build all part × format PDFs for one input file.
 *
 * @param {string} bin              MuseScore binary path.
 * @param {string} input            Path to a source .mscz file.
 * @param {object} [opts]
 * @param {string[]} [opts.formats] Format keys to build (default: all).
 * @param {string}   [opts.outDir]  Output dir (default: `<input>.parts/`).
 * @param {(msg: string) => void} [opts.log]  Progress sink (default: console.log).
 * @returns {Promise<{ outDir: string, pdfs: string[] }>}
 */
export async function buildParts(bin, input, opts = {}) {
  const log = opts.log ?? ((m) => console.log(m));
  const formatKeys = (opts.formats ?? FORMAT_KEYS).filter((k) => {
    if (FORMATS[k]) return true;
    throw new Error(`Unknown format "${k}" (known: ${FORMAT_KEYS.join(', ')}).`);
  });

  const title = slugifyStem(basename(input)) || 'score';
  const outDir = opts.outDir ?? join(dirname(input), `${basename(input, '.mscz')}.parts`);
  await mkdir(outDir, { recursive: true });

  // `YYYY-MM-DD HH:MM` (local 24-hour) overlaid as a render stamp — bottom-right
  // on letter, top-right on lyre (lyre frees its bottom entirely for music).
  const renderDate = opts.renderDate ?? renderStamp();

  const workDir = await mkdtemp(join(tmpdir(), 'mbbb-build-'));
  const pdfs = [];
  try {
    const parts = await extractParts(bin, input, workDir);

    // Resolve each part's output slug once, disambiguating any collisions (two
    // unnumbered "trumpet" parts would otherwise write to the same file). Keep
    // the MuseScore part name for the lyre header fallback.
    const seen = new Map();
    const named = parts.map((p, i) => {
      let slug = partSlug(p.name, i);
      const n = (seen.get(slug) ?? 0) + 1;
      seen.set(slug, n);
      if (n > 1) slug = `${slug}-${n}`;
      return { path: p.path, slug, name: p.name };
    });
    log(`${basename(input)}: ${named.length} part(s) × ${formatKeys.length} format(s)`);

    // Lyre strips the title frame (reclaiming ~a system of height) and overlays a
    // compact "Title - Instrument" header instead. Precompute the stripped .mscx
    // + header per part, once, only when lyre is requested.
    if (formatKeys.includes('lyre')) {
      for (let i = 0; i < named.length; i++) {
        const p = named[i];
        let stripped = null;
        try {
          stripped = await stripTitleFrame(p.path, workDir, i, p.name);
        } catch {
          stripped = null; // unzip/edit failed — fall back to the framed source
        }
        p.lyreInput = stripped?.mscxPath ?? p.path;
        p.header = stripped?.header ?? p.name;
      }
    }

    for (const key of formatKeys) {
      const stylePath = join(workDir, `${key}.mss`);
      await writeFile(stylePath, styleFileFor(FORMATS[key]));

      // One job: every part → its PDF for this format, in a single MuseScore run.
      // Lyre renders the title-stripped .mscx; other formats the original .mscz.
      const job = named.map((p) => ({
        part: p,
        in: key === 'lyre' ? p.lyreInput : p.path,
        out: join(outDir, `${title}-${p.slug}-${key}.pdf`),
      }));
      const jobPath = join(workDir, `job-${key}.json`);
      await writeFile(jobPath, JSON.stringify(job.map(({ in: input_, out }) => ({ in: input_, out }))));

      // -f: don't abort on version/corruption warnings from older sources.
      await runMscore(bin, ['-j', jobPath, '-S', stylePath, '-f']);

      for (const { out, part } of job) {
        try {
          await access(out);
        } catch {
          log(`  ✗ missing ${basename(out)} (MuseScore produced no output)`);
          continue;
        }
        // Lyre: header top-left, date top-right (bottom stays free for music).
        // Letter: keep its title frame; date bottom-right.
        await stampCorners(
          out,
          key === 'lyre'
            ? { header: part.header, date: renderDate, datePosition: 'topRight' }
            : { date: renderDate, datePosition: 'bottomRight' },
        );
        pdfs.push(out);
        log(`  ✓ ${basename(out)}`);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  return { outDir, pdfs };
}
