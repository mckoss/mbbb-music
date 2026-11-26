// Build a master score for a PDF-only song (PLAN.md "PDF -> Notation"):
//
//   each part PDF ──Audiveris OMR──▶ MusicXML (written pitch, one part)
//     ──repairMeasures (printed system numbers)──▶ correct bar counts
//     ──prepPart──▶ named, transposing, with a MIDI sound
//   all parts ──mergeParts──▶ one score ──renderMusicXml──▶ full score, .ly, band MP3
//
// No AI here: the result is a draft, reported with every repair and gap, and it
// does not replace the band's own part PDFs. Drum parts are skipped — OMR can't
// read one-line percussion staves.

import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { pdfPageText } from './pdf-text.js';
import { systemStartNumbers, repairMeasures, prepPart, mergeParts } from './score.js';
import { correctPart } from './correct.js';
import { renderMusicXml } from '../lilypond/pipeline.js';

const execFileP = promisify(execFile);

export function omrTools(env = process.env) {
  return { audiveris: env.AUDIVERIS_BIN || '/opt/audiveris/bin/Audiveris', unzip: env.UNZIP_BIN || 'unzip' };
}

/** Read the MusicXML document out of a compressed .mxl. */
async function readMxl(tools, mxlPath) {
  const { stdout: list } = await execFileP(tools.unzip, ['-Z1', mxlPath]);
  const entry = list.split('\n').map((l) => l.trim()).find((l) => /\.(xml|musicxml)$/i.test(l) && !l.startsWith('META-INF/'));
  if (!entry) throw new Error('No MusicXML inside the OMR output');
  const { stdout } = await execFileP(tools.unzip, ['-p', mxlPath, entry], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * Run Audiveris on one PDF; resolves to its MusicXML text.
 *
 * @returns {Promise<{ xml: string, movements: number }>}
 */
async function omrPdf(tools, pdfPath, outDir) {
  await mkdir(outDir, { recursive: true });
  try {
    await execFileP(tools.audiveris, ['-batch', '-export', '-output', outDir, '--', pdfPath], {
      timeout: 15 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // Audiveris exits non-zero when some pages fail but may still export; the
    // .mxl check below decides.
  }
  const mxls = (await readdir(outDir)).filter((f) => f.endsWith('.mxl')).sort();
  if (!mxls.length) throw new Error('OMR could not read this PDF');
  return { xml: await readMxl(tools, join(outDir, mxls[0])), movements: mxls.length };
}

/**
 * @typedef {Object} PdfPart
 * @property {string} pdfPath
 * @property {string} name             Display name, e.g. "Trumpet 1"
 * @property {string|null} [instrumentSlug]
 * @property {string|null} [key]       Written key (bflat, eflat, f, c)
 */

/**
 * @param {object} opts
 * @param {PdfPart[]} opts.parts
 * @param {string} opts.songSlug
 * @param {string} opts.title
 * @param {number|null} [opts.tempo]   Quarter-note BPM when the PDFs carry none.
 * @param {string} opts.workDir
 * @param {{ client: object }|null} [opts.ai]  Run the AI correction pass with this Anthropic client.
 * @param {(msg: string) => void} [opts.log]
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
export async function buildFromPdfs(opts) {
  const log = opts.log ?? (() => {});
  const tools = omrTools(opts.env);
  await mkdir(opts.workDir, { recursive: true });
  const warnings = [];
  const omr = [];
  const prepped = [];
  const ai = opts.ai ? { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 } : null;

  for (const [i, part] of opts.parts.entries()) {
    if (part.instrumentSlug === 'drums') {
      omr.push({ part: part.name, skipped: 'drums', bars: 0, notes: ['Skipped: OMR cannot read drum parts yet.'] });
      continue;
    }
    log(`Reading ${part.name} (${i + 1} of ${opts.parts.length})`);
    const dir = join(opts.workDir, `part${i + 1}`);
    await mkdir(dir, { recursive: true });
    const pdf = join(dir, 'part.pdf'); // Audiveris needs the .pdf extension
    await copyFile(part.pdfPath, pdf);
    try {
      const { xml, movements } = await omrPdf(tools, pdf, join(dir, 'omr'));
      const printed = systemStartNumbers(await pdfPageText(pdf));
      const fixed = repairMeasures(xml, printed);
      const notes = [...fixed.notes];
      if (movements > 1) notes.unshift(`OMR split the PDF into ${movements} pieces; only the first was used.`);
      let partXml = fixed.xml;
      if (opts.ai && ai) {
        const c = await correctPart({ xml: partXml, pdfPath: pdf, partName: part.name, client: opts.ai.client, log });
        partXml = c.xml;
        notes.push(...c.notes);
        for (const k of Object.keys(ai)) ai[k] += c.usage[k];
      }
      const p = prepPart(partXml, { id: `P${prepped.length + 1}`, name: part.name, instrumentSlug: part.instrumentSlug, key: part.key });
      prepped.push(p);
      omr.push({ part: part.name, bars: p.measures.length, notes });
    } catch (err) {
      omr.push({ part: part.name, failed: true, bars: 0, notes: [String(err instanceof Error ? err.message : err)] });
    }
  }
  if (!prepped.length) throw new Error('OMR could not read any part of this song.');

  const merged = mergeParts(prepped, { title: opts.title, tempo: opts.tempo ?? null });
  for (const n of merged.notes) warnings.push(n);
  const bars = prepped.map((p) => p.measures.length);
  if (new Set(bars).size > 1) warnings.push(`Parts read with different lengths (${Math.min(...bars)}–${Math.max(...bars)} bars); audio may drift where they differ.`);
  if (!opts.tempo && !merged.xml.includes('<sound tempo=')) warnings.push('No tempo found; LilyPond plays at its default speed.');
  const xmlPath = join(opts.workDir, 'merged.musicxml');
  await writeFile(xmlPath, merged.xml);

  const { outputs, report } = await renderMusicXml({
    xmlPath,
    songSlug: opts.songSlug,
    title: opts.title,
    workDir: join(opts.workDir, 'render'),
    parts: false, // a draft: never replaces the band's own part PDFs
    warnings,
    log,
    env: opts.env,
  });
  return { outputs, report: { ...report, origin: 'omr', omr, ...(ai ? { ai: { model: 'claude-opus-5-5', ...ai } } : {}) } };
}
