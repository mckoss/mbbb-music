#!/usr/bin/env node
// Build per-instrument part PDFs from MuseScore files, using the locally
// installed MuseScore 4 CLI. Each input .mscz yields one PDF per part per
// print format, written to a `<input>.parts/` folder next to the source.
//
// Page setup / format constants live in src/scores/formats.js — adjust them
// there and re-run to iterate.

import { basename } from 'node:path';
import { statSync } from 'node:fs';

import { resolveMscore } from '../src/scores/musescore.js';
import { buildParts } from '../src/scores/build-parts.js';
import { buildAudio } from '../src/scores/build-audio.js';
import { FORMAT_KEYS } from '../src/scores/formats.js';

const HELP = `mbbb-scores — build per-part PDFs from MuseScore files

Uses the locally installed MuseScore 4 (set MSCORE_BIN to override the path).
For each input, extracts the individual instrument parts and exports each one to
every selected print format, into a "<input>.parts/" folder next to the source.

USAGE
  node bin/build-scores.js <input.mscz> [more.mscz ...] [options]
  npm run build-scores -- path/to/song.mscz

OPTIONS
  --formats <list>   Comma-separated formats to build (default: all).
                     Known: ${FORMAT_KEYS.join(', ')}.
  --audio            Also render a full-band practice MP3 per input, into the
                     same "<input>.parts/" folder. Off by default.
  --audio-only       Render only the MP3(s); skip the part PDFs. Useful for
                     re-rendering audio without the slow PDF pass.
  --out <dir>        Output directory (default: "<input>.parts/" per input).
                     Only valid with a single input.
  -h, --help         Show this help.

OUTPUT NAMES
  <title>-<instrument>[-<key>][-part<n>]-<format>.pdf
  <title>-band.mp3                                       (with --audio)

AUDIO QUALITY
  MP3 is rendered by MuseScore's built-in "MS Basic" SoundFont. The headless CLI
  cannot use MuseSounds/VST (those need the GUI audio engine), and MuseScore 4
  ignores user-installed SoundFonts for default CLI playback, so the sound is
  fixed at "MS Basic" regardless of what's configured in the app. For a premium
  mix, export the MP3 from the MuseScore GUI instead.
`;

function parseArgs(argv) {
  const opts = { inputs: [], formats: undefined, outDir: undefined, audio: false, audioOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--audio') opts.audio = true;
    else if (arg === '--audio-only') opts.audioOnly = true;
    else if (arg === '--formats') opts.formats = splitFormats(argv[++i]);
    else if (arg.startsWith('--formats=')) opts.formats = splitFormats(arg.slice('--formats='.length));
    else if (arg === '--out') opts.outDir = argv[++i];
    else if (arg.startsWith('--out=')) opts.outDir = arg.slice('--out='.length);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg} (try --help)`);
    else opts.inputs.push(arg);
  }
  return opts;
}

function splitFormats(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(2);
  }

  if (opts.help || opts.inputs.length === 0) {
    if (!opts.help) console.error('At least one input .mscz is required.\n');
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : 2);
  }

  if (opts.outDir && opts.inputs.length > 1) {
    console.error('--out can only be used with a single input file.');
    process.exit(2);
  }

  for (const input of opts.inputs) {
    try {
      if (!statSync(input).isFile()) throw new Error('not a file');
    } catch {
      console.error(`Input not found: ${input}`);
      process.exit(1);
    }
    if (!/\.mscz$/i.test(input)) {
      console.error(`Skipping ${basename(input)}: expected a .mscz file.`);
      process.exit(2);
    }
  }

  let mscore;
  try {
    mscore = await resolveMscore();
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
  console.log(`Using ${mscore.version} (${mscore.bin})`);

  const wantAudio = opts.audio || opts.audioOnly;
  let totalPdfs = 0;
  let totalMp3s = 0;
  for (const input of opts.inputs) {
    try {
      let outDir = opts.outDir;
      const built = [];

      if (!opts.audioOnly) {
        const r = await buildParts(mscore.bin, input, { formats: opts.formats, outDir: opts.outDir });
        outDir = r.outDir;
        totalPdfs += r.pdfs.length;
        built.push(`${r.pdfs.length} PDF(s)`);
      }

      if (wantAudio) {
        // Render the full-band MP3 into the same .parts/ folder so it syncs
        // alongside the PDFs (catalog treats it as the song's full-band mix).
        const r = await buildAudio(mscore.bin, input, { outDir });
        outDir = r.outDir;
        totalMp3s += r.mp3s.length;
        built.push(`${r.mp3s.length} MP3(s)`);
      }

      console.log(`→ ${built.join(' + ')} in ${outDir}\n`);
    } catch (err) {
      console.error(`Failed on ${basename(input)}: ${err.message || err}`);
      process.exit(1);
    }
  }
  const summary = [];
  if (!opts.audioOnly) summary.push(`${totalPdfs} PDF(s)`);
  if (wantAudio) summary.push(`${totalMp3s} MP3(s)`);
  console.log(`Done. ${summary.join(' and ')} total.`);
}

main();
