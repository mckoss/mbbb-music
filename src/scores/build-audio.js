// Render a full-band practice MP3 from a MuseScore file, using the locally
// installed MuseScore 4 CLI.
//
// Flow for one input .mscz:
//   mscore <in> -o <out>.mp3 -b <bitrate> -f
// renders the WHOLE score (every staff) to a single mix. No part extraction —
// "full band" is just the score played as written.
//
// SOUND: the headless CLI cannot use MuseScore's MuseSounds / VST instruments
// (those need the GUI audio engine), so playback comes from the bundled "MS
// Basic" SoundFont. MuseScore 4 also ignores user-installed SoundFonts for
// default CLI playback (verified: a .sf3 in the user SoundFonts folder produces
// byte-identical output), so CLI audio quality is effectively fixed at MS Basic.
// A premium mix needs a manual GUI export; revisit if that changes.
//
// Percussion-only stems are intentionally out of scope: MuseScore 4's CLI has no
// reliable "solo the drums" mechanism (channel mutes saved in the score are
// ignored on the Fluid path, and structural staff removal is fragile), so a
// drums-only track would need either a single combined percussion part or an
// ffmpeg mixdown. Revisit when those constraints are settled.

import { mkdir, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';

import { runMscore } from './musescore.js';
import { slugifyStem } from '../sync/slugify.js';

/** Default MP3 bitrate (kbps) passed to MuseScore's `-b`. */
export const AUDIO_BITRATE = 192;

/**
 * The full-band mix carries no instrument/format suffix on purpose: the catalog
 * treats an audio file ending in an instrument token as an isolated stem and
 * sorts it after the full mix (see src/sync/catalog.js `isIsolatedAudio`). The
 * neutral `-band` marker is neither a voice nor a format token, so the file is
 * always classified as the full-band recording — even when the song title itself
 * ends in an instrument word (e.g. "Tubular Bells").
 */
const BAND_SUFFIX = 'band';

/**
 * Render the full-band MP3 for one input file.
 *
 * @param {string} bin              MuseScore binary path.
 * @param {string} input            Path to a source .mscz file.
 * @param {object} [opts]
 * @param {string}  [opts.outDir]   Output dir (default: `<input>.parts/`, the
 *   same folder buildParts writes to, so audio + PDFs sync together).
 * @param {number}  [opts.bitrate]  MP3 bitrate in kbps (default: AUDIO_BITRATE).
 * @param {(msg: string) => void} [opts.log]  Progress sink (default: console.log).
 * @returns {Promise<{ outDir: string, mp3s: string[] }>}
 */
export async function buildAudio(bin, input, opts = {}) {
  const log = opts.log ?? ((m) => console.log(m));
  const bitrate = opts.bitrate ?? AUDIO_BITRATE;

  const title = slugifyStem(basename(input)) || 'score';
  const outDir = opts.outDir ?? join(dirname(input), `${basename(input, '.mscz')}.parts`);
  await mkdir(outDir, { recursive: true });

  const out = join(outDir, `${title}-${BAND_SUFFIX}.mp3`);
  log(`${basename(input)}: full-band MP3 @ ${bitrate} kbps`);

  // -f: don't abort on version/corruption warnings from older sources (matches
  // buildParts). runMscore retries the intermittent Qt-startup abort on macOS.
  await runMscore(bin, [input, '-o', out, '-b', String(bitrate), '-f']);

  try {
    await access(out);
  } catch {
    log(`  ✗ missing ${basename(out)} (MuseScore produced no audio)`);
    return { outDir, mp3s: [] };
  }
  log(`  ✓ ${basename(out)}`);
  return { outDir, mp3s: [out] };
}
