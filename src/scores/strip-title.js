// Strip the title frame from a part's MuseScore file and derive a compact header.
//
// MuseScore's title block is a leading <VBox> holding aligned <Text> elements —
// `title` (centered), `composer`/arranger (right), `instrument_excerpt` (left).
// On a lyre card that frame wastes ~half an inch of height. We remove it and
// return a one-line "Title - Instrument" string for the caller to overlay in a
// thin header band instead (see stamp.js), reclaiming room for another system.
//
// A part .mscz is a zip; we read the part's .mscx out of it with the `unzip`
// CLI (present on macOS/Linux — this is a local-only tool) and render that bare
// .mscx directly (MuseScore reads .mscx; our -S style replaces the embedded one).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFileP = promisify(execFile);

/** Decode the handful of XML entities that appear in title/instrument text. */
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" wouldn't double-decode
}

/** First <text> whose <style> matches `styleName`, searched across the file. */
function textForStyle(mscx, styleName) {
  const re = new RegExp(`<style>${styleName}</style>\\s*<text>([\\s\\S]*?)</text>`);
  const m = mscx.match(re);
  // Drop any inline rich-text tags (e.g. <b>, <font/>) the text may carry.
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim() : '';
}

/**
 * Read a part .mscz, build its header, and write a title-frame-stripped .mscx.
 *
 * @param {string} partMscz   Path to the extracted part .mscz.
 * @param {string} outDir     Where to write the stripped .mscx.
 * @param {number} idx        Part index (for a unique filename).
 * @param {string} fallback   Header to use if no title frame is found.
 * @returns {Promise<{ mscxPath: string, header: string } | null>}
 *          null if the .mscx can't be located (caller should fall back).
 */
export async function stripTitleFrame(partMscz, outDir, idx, fallback) {
  const { stdout: listing } = await execFileP('unzip', ['-Z1', partMscz]);
  const entry = listing
    .split('\n')
    .map((s) => s.trim())
    .find((n) => /\.mscx$/i.test(n) && !/Excerpts\//i.test(n));
  if (!entry) return null;

  const { stdout: mscx } = await execFileP('unzip', ['-p', partMscz, entry], {
    maxBuffer: 128 * 1024 * 1024,
  });

  const title = textForStyle(mscx, 'title');
  const instrument = textForStyle(mscx, 'instrument_excerpt') || textForStyle(mscx, 'instrument');
  const header = [title, instrument].filter(Boolean).join(' - ') || fallback;

  // Remove the leading title frame (the first VBox). composer/arranger lives in
  // the same frame, so this drops it too — exactly what we want.
  const stripped = mscx.replace(/<VBox>[\s\S]*?<\/VBox>/, '');

  const mscxPath = join(outDir, `lyre-${idx}.mscx`);
  await writeFile(mscxPath, stripped);
  return { mscxPath, header };
}
