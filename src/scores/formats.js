// Print-format definitions and MuseScore style-file (.mss) generation.
//
// THIS IS THE PLACE TO ADJUST PAGE SETUP. Each format is page geometry + a
// `staffSpace` (the master scaling lever) + an optional `style` bag of extra
// MuseScore engraving tags. `styleFileFor()` turns it into a MuseScore `.mss`
// document applied at export via `-S`. Tweak, re-run, inspect the PDFs.
//
// Units: page width/height and `margin` are in INCHES; `staffSpace`
// (MuseScore's "Spatium") is in MILLIMETRES. Values inside `style` are in
// MuseScore's own units for that tag (spacing distances are in staff-spaces
// "sp", font sizes in points, booleans as true/false → 1/0).
//
// The `style` keys ARE MuseScore style tag names, so they map 1:1 into the
// `.mss` and the emitter stays trivial. Unknown/misspelled tags are ignored by
// MuseScore (a warning, not a failure), so this degrades safely.
//
// Format keys ('letter', 'lyre') match the app's PrintFormat taxonomy
// (src/lib/stores.ts) so generated filenames line up with the catalog.
//
// NOTE: `-S` loads a style over MuseScore's defaults, so only what's set here is
// controlled; unlisted engraving falls back to defaults.

/**
 * @typedef {Object} Format
 * @property {string} label        Human label.
 * @property {number} pageWidth    Page width, inches.
 * @property {number} pageHeight   Page height, inches.
 * @property {number} margin       Uniform page margin, inches (all four sides).
 * @property {number} [marginTop]  Top margin override, inches. Used to reserve a
 *   header band above the music (defaults to `margin`).
 * @property {number} staffSpace   Staff space ("Spatium"), millimetres.
 * @property {Record<string, number|boolean>} [style]  Extra MuseScore style
 *   tags (keyed by their exact `.mss` tag name).
 */

/** @type {Record<string, Format>} */
export const FORMATS = {
  // Music stand — US Letter, full-size notation. Raster 3: staffSpace 1.75 mm
  // ⇒ 7.0 mm total staff height, the standard for instrumental parts read at a
  // 24–36" stand distance. Generous spacing; multi-measure rests on (standard
  // for any printed part).
  letter: {
    label: 'Music stand — Letter (8.5×11)',
    pageWidth: 8.5,
    pageHeight: 11,
    margin: 0.5,
    staffSpace: 1.75,
    style: {
      createMultiMeasureRests: true,
      enableIndentationOnFirstSystem: false, // parts don't need the score indent
      // Readability first — page count doesn't matter here. Roomy systems, no
      // horizontal compression (default note spacing), let the page justify.
      minSystemDistance: 12.0, // sp; generous gap between systems
      maxSystemDistance: 20.0, // sp; allow justification to spread comfortably
    },
  },

  // Lyre flip-folder card: 7" wide × 5" tall (landscape). Everything here is
  // tuned to compress a part onto the small page while staying legible at the
  // shorter lyre reading distance. staffSpace 1.40 mm ⇒ ~6.0 mm staff height
  // (1.35–1.45 mm range; below ~1.30 mm ledger lines/accidentals degrade).
  lyre: {
    label: 'Lyre (7×5)',
    pageWidth: 7.0,
    pageHeight: 5.0,
    margin: 0.197, // ≈5 mm — tight but clears the typical laser cutoff (~4.2 mm)
    // No extra header band: the title frame is stripped (see strip-title.js) and
    // the compact "Title - Instrument" header (overlaid by stamp.js) tucks into
    // the standard top margin, above the first system — so it costs no music room.
    marginTop: 0.197,
    staffSpace: 1.35, // min of the recommended 1.35–1.45 mm lyre range (~5.4 mm staff)
    style: {
      // Consolidate extended rests — essential for individual parts.
      createMultiMeasureRests: true,
      enableIndentationOnFirstSystem: false, // reclaim the first-system indent
      // Horizontal compression (Style ▸ Measure) — pack more bars per system.
      measureSpacing: 1.3, // note-spacing ratio, default ~1.5
      minMeasureWidth: 2.0, // sp; squeeze full-rest / sparse bars hard
      minNoteDistance: 0.4, // sp; tighten the gap between notes (default ~0.6)
      // Vertical compression (Style ▸ Page) — pack more systems per page.
      // Vertical justification is ON, so system gaps follow the SPREAD range,
      // not min/maxSystemDistance (which apply only when justification is off).
      // MuseScore's default maxSystemSpread is 32 sp — capping it is what keeps
      // systems tight enough to fit more per page.
      minSystemSpread: 3.0, // sp
      maxSystemSpread: 5.0, // sp; cap justification spread (default 32)
      minSystemDistance: 5.0, // sp; floor of the 5.0–6.0 range (justify-off path)
      maxSystemDistance: 6.0, // sp
      staffUpperBorder: 0.0, // sp; drop padding above the top staff
      staffLowerBorder: 0.0, // sp; drop padding below the bottom staff
      // Trim large text so it doesn't inflate system bounding boxes.
      chordSymbolAFontSize: 10,
      rehearsalMarkFontSize: 12,
      staffTextFontSize: 9,
    },
  },
};

/** Ordered list of the known format keys. */
export const FORMAT_KEYS = Object.keys(FORMATS);

/** Serialize one style tag. Booleans become 1/0; string text is XML-escaped. */
function tag(name, value) {
  let v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  if (typeof v === 'string') {
    v = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return `    <${name}>${v}</${name}>`;
}

/**
 * Build a MuseScore `.mss` style document for a format: page geometry + Spatium,
 * then any extra `style` tags. Unlisted engraving stays at MuseScore defaults.
 *
 * @param {Format} fmt
 * @returns {string} XML text suitable for `mscore -S <file>.mss`.
 */
export function styleFileFor(fmt) {
  const printableWidth = (fmt.pageWidth - 2 * fmt.margin).toFixed(4);
  const m = fmt.margin.toFixed(4);
  const mTop = (fmt.marginTop ?? fmt.margin).toFixed(4);
  const lines = [
    tag('pageWidth', fmt.pageWidth),
    tag('pageHeight', fmt.pageHeight),
    tag('pagePrintableWidth', printableWidth),
    tag('pageEvenLeftMargin', m),
    tag('pageOddLeftMargin', m),
    tag('pageEvenTopMargin', mTop),
    tag('pageEvenBottomMargin', m),
    tag('pageOddTopMargin', mTop),
    tag('pageOddBottomMargin', m),
    tag('pageTwosided', 0),
    tag('Spatium', fmt.staffSpace),
    ...Object.entries(fmt.style ?? {}).map(([k, v]) => tag(k, v)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.60">
  <Style>
${lines.join('\n')}
  </Style>
</museScore>
`;
}
