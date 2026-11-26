// The LilyPond production pipeline for one song (PLAN.md "Pipeline Shape"):
//
//   .mscz ──MuseScore──▶ MusicXML ──musicxml2ly + fixups──▶ LilyPond source
//   LilyPond ──▶ full score PDF, per-part letter + lyre PDFs, MIDI
//   MIDI ──fluidsynth + lame──▶ full-band MP3
//   MuseScore MIDI vs LilyPond MIDI ──▶ per-part fidelity report
//
// MuseScore is only the importer here; every player-facing output is rendered
// by LilyPond (and fluidsynth for audio). The function works in a scratch
// directory and returns the output files for the caller to store.

import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveMscore, runMscore } from '../scores/musescore.js';
import { readParts, readTitle } from './musicxml.js';
import { planSong, fullScoreLy, partLy, midiLy, LY_FORMATS } from './generate.js';
import { parseMidi, compareMidi } from './midi.js';

const execFileP = promisify(execFile);

/** Tool locations, overridable by environment (see Dockerfile). */
export function toolPaths(env = process.env) {
  return {
    lilypond: env.LILYPOND_BIN || 'lilypond',
    musicxml2ly: env.MUSICXML2LY_BIN || 'musicxml2ly',
    fluidsynth: env.FLUIDSYNTH_BIN || 'fluidsynth',
    lame: env.LAME_BIN || 'lame',
    soundfont: env.SOUNDFONT_PATH || '/usr/share/sounds/sf2/FluidR3_GM.sf2',
  };
}

/** A part at or above this match rate passes the fidelity check. */
export const PASS_THRESHOLD = 0.95;

async function run(bin, args, opts = {}) {
  return execFileP(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 10 * 60 * 1000, cwd: opts.cwd });
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Run async jobs with at most `n` in flight. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * Compile one LilyPond source; resolves to the produced file path (PDF, or MIDI
 * for a \midi-only score) or throws with LilyPond's error lines.
 */
async function compile(tools, dir, base, source, ext = 'pdf') {
  const lyPath = join(dir, `${base}.ly`);
  await writeFile(lyPath, source);
  try {
    await run(tools.lilypond, ['-dno-point-and-click', '-o', base, `${base}.ly`], { cwd: dir });
  } catch (err) {
    const lines = String(err.stderr || err.message)
      .split('\n')
      .filter((l) => /error/i.test(l))
      .slice(0, 5)
      .join('\n');
    throw new Error(`LilyPond failed on ${base}: ${lines || err.message}`);
  }
  const out = join(dir, `${base}.${ext}`);
  if (!(await exists(out))) throw new Error(`LilyPond produced no ${ext} for ${base}`);
  return out;
}

/**
 * @typedef {Object} PipelineOutput
 * @property {string} path
 * @property {string} name     Standardized, app-generated filename.
 * @property {'score'|'part'|'audio'|'source'} kind
 * @property {string} [format] letter | lyre
 * @property {string} [part]   Part display name.
 */

/**
 * @typedef {Object} PipelineReport
 * @property {string} title
 * @property {Array<{ name: string, slug: string, drums: boolean }>} parts
 * @property {import('./midi.js').PartCheck[]|null} checks
 * @property {boolean} passed      Every pitched part at or above PASS_THRESHOLD.
 * @property {string[]} warnings
 * @property {Record<string, string>} versions
 */

/**
 * Convert one MuseScore master into LilyPond-rendered outputs.
 *
 * @param {object} opts
 * @param {string} opts.input      Path to the .mscz master.
 * @param {string} opts.songSlug   Stable song slug (prefix for output names).
 * @param {string} opts.title      Display title for headers.
 * @param {string} opts.workDir    Empty scratch directory.
 * @param {string[]} [opts.formats]  Part formats (default letter + lyre).
 * @param {boolean} [opts.audio]   Render the MP3 (default true).
 * @param {(msg: string) => void} [opts.log]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {Promise<{ outputs: PipelineOutput[], report: PipelineReport }>}
 */
export async function convertMscz(opts) {
  const { input, workDir } = opts;
  const log = opts.log ?? (() => {});
  const warnings = [];
  await mkdir(workDir, { recursive: true });

  // MuseScore: MusicXML for conversion, MIDI as the fidelity reference.
  const { bin: mscore, version: mscoreVersion } = await resolveMscore(opts.env);
  // MuseScore picks the input format from the extension; content-store blobs
  // have none, so work from a named copy.
  const master = join(workDir, 'master.mscz');
  await copyFile(input, master);
  const xmlPath = join(workDir, 'source.musicxml');
  const refMidi = join(workDir, 'reference.mid');
  log('Exporting MusicXML from MuseScore');
  try {
    await runMscore(mscore, ['-f', '-o', xmlPath, master]);
  } catch (err) {
    const why = String(err.stderr || '').split('\n').filter((l) => /error|fail|cannot|unable/i.test(l)).slice(-3).join(' ');
    throw new Error(`MuseScore could not open the master${why ? `: ${why}` : ''}`);
  }
  let haveRef = true;
  try {
    await runMscore(mscore, ['-f', '-o', refMidi, master]);
  } catch {
    haveRef = false;
    warnings.push('MuseScore could not export reference MIDI; fidelity check skipped.');
  }
  return renderMusicXml({
    ...opts,
    xmlPath,
    referenceMidi: haveRef ? refMidi : null,
    warnings,
    versions: { musescore: mscoreVersion },
    log,
  });
}

/**
 * Render a MusicXML score with LilyPond: full score, optionally every part in
 * each print format, the LilyPond master, MIDI, and the band MP3. Shared by the
 * MuseScore path and the OMR (PDF-only) path.
 *
 * @param {object} opts
 * @param {string} opts.xmlPath          MusicXML (score-partwise) to render.
 * @param {string} opts.songSlug
 * @param {string} [opts.title]
 * @param {string} opts.workDir
 * @param {string|null} [opts.referenceMidi]  MIDI to check against (MuseScore's).
 * @param {boolean} [opts.parts]         Engrave per-part PDFs (default true).
 * @param {string[]} [opts.formats]
 * @param {boolean} [opts.audio]
 * @param {string[]} [opts.warnings]     Warnings collected so far.
 * @param {Record<string,string>} [opts.versions]
 * @param {(msg: string) => void} [opts.log]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {Promise<{ outputs: PipelineOutput[], report: PipelineReport }>}
 */
export async function renderMusicXml(opts) {
  const { xmlPath, songSlug, workDir } = opts;
  const log = opts.log ?? (() => {});
  const formats = opts.parts === false ? [] : (opts.formats ?? Object.keys(LY_FORMATS));
  const tools = toolPaths(opts.env);
  const warnings = opts.warnings ?? [];
  await mkdir(workDir, { recursive: true });

  const xml = await readFile(xmlPath, 'utf8');
  const parts = readParts(xml);
  const title = opts.title || readTitle(xml) || songSlug;

  // musicxml2ly (absolute pitches, so drum notes map by staff position).
  log('Converting MusicXML to LilyPond');
  const convertedPath = join(workDir, 'converted.ly');
  await run(tools.musicxml2ly, ['--absolute', '--midi', '-o', convertedPath, xmlPath]);
  const src = planSong(await readFile(convertedPath, 'utf8'), parts);
  log(`Planned ${src.parts.length} parts`);

  // Render with LilyPond.
  const outDir = join(workDir, 'out');
  await mkdir(outDir, { recursive: true });
  const outputs = [];
  const scoreSource = fullScoreLy(src, title);
  const jobs = [
    { base: `${songSlug}-score-letter`, source: scoreSource, kind: 'score', format: 'letter' },
    ...src.parts.flatMap((p) =>
      formats.map((f) => ({ base: `${songSlug}-${p.slug}-${f}`, source: partLy(src, p, title, f), kind: 'part', format: f, part: p.name })),
    ),
  ];
  log(`Engraving ${jobs.length} PDF${jobs.length === 1 ? '' : 's'}`);
  await pool(jobs, 3, async (j) => {
    try {
      const path = await compile(tools, outDir, j.base, j.source);
      outputs.push({ path, name: `${j.base}.pdf`, kind: j.kind, format: j.format, ...(j.part ? { part: j.part } : {}) });
    } catch (err) {
      warnings.push(String(err.message || err));
    }
  });
  if (!outputs.some((o) => o.kind === 'score')) throw new Error(warnings.find((w) => /score-letter/.test(w)) || 'Full score failed');

  // The LilyPond master: the full-score source carries all the music.
  const masterPath = join(outDir, `${songSlug}.ly`);
  await writeFile(masterPath, scoreSource);
  outputs.push({ path: masterPath, name: `${songSlug}.ly`, kind: 'source' });

  // MIDI → fidelity check → MP3.
  let checks = null;
  log('Rendering MIDI');
  const midiPath = await compile(tools, workDir, 'band', midiLy(src), 'midi');
  if (opts.referenceMidi && (await exists(opts.referenceMidi))) {
    checks = compareMidi(parseMidi(await readFile(opts.referenceMidi)), parseMidi(await readFile(midiPath)));
  }
  if (opts.audio !== false) {
    log('Rendering MP3');
    const wav = join(workDir, 'band.wav');
    const mp3 = join(outDir, `${songSlug}-band.mp3`);
    try {
      await run(tools.fluidsynth, ['-ni', '-q', '-g', '0.6', '-r', '44100', '-F', wav, tools.soundfont, midiPath]);
      await run(tools.lame, ['--quiet', '-b', '192', wav, mp3]);
      outputs.push({ path: mp3, name: `${songSlug}-band.mp3`, kind: 'audio' });
    } catch (err) {
      warnings.push(`Audio failed: ${String(err.stderr || err.message).split('\n')[0]}`);
    }
  }

  const passed = Boolean(checks) && checks.filter((c) => !c.drums).every((c) => c.match >= PASS_THRESHOLD);
  let lilypondVersion = '';
  try {
    lilypondVersion = (await run(tools.lilypond, ['--version'])).stdout.split('\n')[0].trim();
  } catch {
    /* reported as empty */
  }
  outputs.sort((a, b) => a.name.localeCompare(b.name));
  return {
    outputs,
    report: {
      title,
      parts: src.parts.map((p) => ({ name: p.name, slug: p.slug, drums: p.drums })),
      checks,
      passed,
      warnings,
      versions: { ...(opts.versions ?? {}), lilypond: lilypondVersion },
    },
  };
}
