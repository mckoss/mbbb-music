// Strip the title frame from a part's MuseScore file and derive header text.
//
// MuseScore's title block is a leading <VBox> holding aligned <Text> elements —
// `title` (centered), `composer`/arranger (right), `instrument_excerpt` (left).
// That frame is inconsistent across sources and wastes height. We remove it and
// return the title + instrument so the caller can overlay an app-owned header in
// a thin band instead (see stamp.js): lyre uses a one-line "Title - Instrument";
// letter uses a large centered title with the instrument on the left.
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

/**
 * The <text> of the first <Text> block whose <style> matches `styleName`. We scan
 * whole <Text>…</Text> blocks rather than assuming <text> immediately follows
 * <style>: MuseScore interleaves <offset>, <eid>, <linked> etc. between them when
 * the element has manual positioning, so a tighter regex misses those titles.
 */
function textForStyle(mscx, styleName) {
  const blocks = mscx.match(/<Text>[\s\S]*?<\/Text>/g) || [];
  for (const block of blocks) {
    const style = block.match(/<style>([^<]+)<\/style>/);
    if (style && style[1] === styleName) {
      const text = block.match(/<text>([\s\S]*?)<\/text>/);
      // Drop any inline rich-text tags (e.g. <b>, <font/>) the text may carry.
      return text ? decodeEntities(text[1].replace(/<[^>]+>/g, '')).trim() : '';
    }
  }
  return '';
}

/**
 * Read a part .mscz, extract its title/instrument, and write a title-frame-stripped
 * .mscx. The caller composes the header from the returned zones.
 *
 * @param {string} partMscz   Path to the extracted part .mscz.
 * @param {string} outDir     Where to write the stripped .mscx.
 * @param {number} idx        Part index (for a unique filename).
 * @param {string} fallback   Instrument label if the score names none.
 * @returns {Promise<{ mscxPath: string, title: string, instrument: string } | null>}
 *          `title`/`instrument` are the header zones (`title` may be '' — the
 *          caller supplies the song-title fallback). null if the .mscx can't be
 *          located (caller falls back to the framed source).
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

  // Remove the leading title frame (the first VBox). composer/arranger lives in
  // the same frame, so this drops it too — exactly what we want.
  const stripped = mscx.replace(/<VBox>[\s\S]*?<\/VBox>/, '');

  const mscxPath = join(outDir, `stripped-${idx}.mscx`);
  await writeFile(mscxPath, stripped);
  // `title` is returned raw (empty if the score has none) so the caller can fall
  // back to a song title rather than the part name. `instrument` keeps the name
  // fallback (it's the part's own label).
  return { mscxPath, title, instrument: instrument || fallback };
}
