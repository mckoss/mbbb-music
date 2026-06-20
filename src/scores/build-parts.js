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

import { mkdtemp, mkdir, writeFile, copyFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

import { runMscore } from './musescore.js';
import { FORMATS, FORMAT_KEYS, styleFileFor, fitRungOverride } from './formats.js';
import { stampCorners, pageCount } from './stamp.js';
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
 * Build a `fit`-ladder format (lyre or letter): render the whole part batch at
 * each staff-space rung, then keep, per part, the LARGEST rung that doesn't add a
 * page over rung 0 (the floor). Page count is monotonic in staff space (bigger
 * notes ⇒ fewer systems/page ⇒ more pages), so the kept rung is the roomiest fit
 * at the minimum page count:
 *   - Lyre: floor is the legibility minimum, so a short part grows to fill the card.
 *   - Letter: floor is the compression minimum, so a part that can fit on one page
 *     at a reasonable size is compressed to do so; one that must wrap is enlarged.
 *
 * Each rung is one batched MuseScore run (reusing the batch-reliability trick),
 * so the extra cost is `ladder.length` runs total, independent of part count.
 * Both formats render the title-frame-stripped input and overlay an app-owned
 * header; only the header layout (card vs. full-page) differs at stamp time.
 *
 * @param {object} ctx  Shared build state (see call site).
 */
async function buildFitFormat({ bin, fmt, key, named, outDir, workDir, title, renderDate, trim, pdfs, log }) {
  const ladder = fmt.fit.ladder;

  // rungs[partIndex][rungIndex] = { path, pages } | null (no output for that rung).
  const rungs = named.map(() => []);
  for (let r = 0; r < ladder.length; r++) {
    const stylePath = join(workDir, `${key}-r${r}.mss`);
    await writeFile(stylePath, styleFileFor(fmt, fitRungOverride(fmt, r)));
    const rungDir = join(workDir, `${key}-r${r}`);
    await mkdir(rungDir, { recursive: true });

    const job = named.map((p) => ({ in: p.strippedInput ?? p.path, out: join(rungDir, `${p.slug}.pdf`) }));
    const jobPath = join(workDir, `job-${key}-r${r}.json`);
    await writeFile(jobPath, JSON.stringify(job));
    // -f: don't abort on version/corruption warnings from older sources.
    await runMscore(bin, ['-j', jobPath, '-S', stylePath, '-f']);

    for (let i = 0; i < named.length; i++) {
      const out = job[i].out;
      try {
        await access(out);
        rungs[i][r] = { path: out, pages: await pageCount(out) };
      } catch {
        rungs[i][r] = null; // MuseScore produced no output at this rung
      }
    }
  }

  for (let i = 0; i < named.length; i++) {
    const p = named[i];
    const finalOut = join(outDir, `${title}-${p.slug}-${key}.pdf`);
    const avail = rungs[i].map((rg, idx) => rg && { idx, ...rg }).filter(Boolean);
    if (!avail.length) {
      log(`  ✗ missing ${basename(finalOut)} (MuseScore produced no output)`);
      continue;
    }
    // Floor page count (rung 0) is the budget; if rung 0 failed, fall back to the
    // fewest pages any rung achieved. Keep the largest rung that stays within it.
    const budget = rungs[i][0]?.pages ?? Math.min(...avail.map((rg) => rg.pages));
    const chosen = avail.filter((rg) => rg.pages <= budget).pop() ?? avail[0];

    await copyFile(chosen.path, finalOut);
    // Card (lyre, has trim): compact one-line header top-left, date top-right so
    // the bottom stays free for music. Full-page (letter): large centered title,
    // instrument/part on the left, page number top-right, date bottom-right.
    const stampOpts = trim
      ? { header: p.header ?? p.name, date: renderDate, datePosition: 'topRight', trim }
      : {
          title: p.title ?? title,
          header: p.instrument ?? p.name,
          headerSize: 10,
          titleSize: 17,
          date: renderDate,
          datePosition: 'bottomRight',
        };
    await stampCorners(finalOut, stampOpts);
    pdfs.push(finalOut);
    // Report the fit outcome to stdout: the staff space chosen for this part and
    // the page floor it achieved (the fewest pages possible — the chosen spatium
    // is the largest that still hits it). toFixed(2) keeps the column aligned.
    const pg = `${chosen.pages} pg`;
    log(`  ✓ ${basename(finalOut)} — spatium ${ladder[chosen.idx].toFixed(2)} mm, floor ${pg}`);
  }
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

    // The fit formats (lyre, letter) strip the inconsistent title frame and
    // overlay an app-owned header instead. Precompute the stripped .mscx + header
    // fields per part, once, when any fit format is requested. `header` is the
    // lyre one-liner; `title`/`instrument` are the letter header's zones.
    const stripFor = formatKeys.filter((k) => FORMATS[k].fit);
    if (stripFor.length) {
      for (let i = 0; i < named.length; i++) {
        const p = named[i];
        let stripped = null;
        try {
          stripped = await stripTitleFrame(p.path, workDir, i, p.name);
        } catch {
          stripped = null; // unzip/edit failed — fall back to the framed source
        }
        p.strippedInput = stripped?.mscxPath ?? p.path;
        p.header = stripped?.header ?? p.name;
        p.title = stripped?.title ?? p.name;
        p.instrument = stripped?.instrument ?? p.name;
      }
    }

    for (const key of formatKeys) {
      const fmt = FORMATS[key];

      // When the format trims a card out of a larger carrier sheet (lyre on
      // Letter), pass the card size (in points) so corner stamps + cut guides
      // align to the card, not the sheet.
      const trim =
        fmt.trimWidth && fmt.trimHeight ? { width: fmt.trimWidth * 72, height: fmt.trimHeight * 72 } : undefined;

      if (fmt.fit) {
        await buildFitFormat({ bin, fmt, key, named, outDir, workDir, title, renderDate, trim, pdfs, log });
        continue;
      }

      const stylePath = join(workDir, `${key}.mss`);
      await writeFile(stylePath, styleFileFor(fmt));

      // One job: every part → its PDF for this format, in a single MuseScore run.
      const job = named.map((p) => ({ in: p.path, out: join(outDir, `${title}-${p.slug}-${key}.pdf`) }));
      const jobPath = join(workDir, `job-${key}.json`);
      await writeFile(jobPath, JSON.stringify(job));

      // -f: don't abort on version/corruption warnings from older sources.
      await runMscore(bin, ['-j', jobPath, '-S', stylePath, '-f']);

      for (const { out } of job) {
        try {
          await access(out);
        } catch {
          log(`  ✗ missing ${basename(out)} (MuseScore produced no output)`);
          continue;
        }
        // Non-card format (letter): keep its title frame; date bottom-right.
        await stampCorners(out, { date: renderDate, datePosition: 'bottomRight', trim });
        pdfs.push(out);
        log(`  ✓ ${basename(out)}`);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  return { outDir, pdfs };
}
