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
 * @property {number} pageWidth    Physical sheet width, inches (what you print on).
 * @property {number} pageHeight   Physical sheet height, inches.
 * @property {number} [trimWidth]  Finished card width, inches. When set, the music
 *   is laid out inside a trimWidth×trimHeight box pinned to the sheet's TOP-LEFT
 *   corner; the rest of the sheet is carrier paper to be cut away (right + bottom
 *   edges only). Defaults to pageWidth (no trim — music fills the sheet).
 * @property {number} [trimHeight] Finished card height, inches (see trimWidth).
 * @property {number} margin       Uniform page margin, inches (all four sides).
 * @property {number} [marginTop]  Top margin override, inches. Used to reserve a
 *   header band above the music (defaults to `margin`).
 * @property {number} staffSpace   Staff space ("Spatium"), millimetres. With a
 *   `fit` ladder this is the FLOOR (ladder rung 0); the build may pick a larger
 *   rung when the part has room to grow.
 * @property {Record<string, number|boolean>} [style]  Extra MuseScore style
 *   tags (keyed by their exact `.mss` tag name).
 * @property {Object} [fit]  Dynamic "fit-to-card" search. When present, the build
 *   renders the part at each `ladder` staff space and keeps the LARGEST rung that
 *   doesn't add a page over rung 0, so short parts grow to fill the card instead
 *   of staying at the floor. Only meaningful for a trimmed card (e.g. lyre).
 * @property {number[]} [fit.ladder]  Staff spaces (mm) to try, smallest first.
 *   Rung 0 must equal `staffSpace` (the legibility floor).
 * @property {Record<string, [number, number]>} [fit.relax]  Style tags eased
 *   from their pack value (rung 0) to their comfortable value (top rung),
 *   interpolated linearly by rung index. Each entry is `[packValue, comfyValue]`.
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

  // Lyre flip-folder card: a 7" wide × 5.5" tall card, PRINTED on a full
  // PORTRAIT US Letter (8.5×11) sheet with the card pinned to the TOP-LEFT
  // corner. Players print on plain Letter stock and trim the card out with two
  // cuts — the right edge (7" from the left, lopping off the 1.5" right margin)
  // and the bottom edge (5.5" from the top). Because 5.5" is EXACTLY half of the
  // 11" sheet, that bottom cut is the same half-sheet cut you'd make anyway, so
  // it costs no extra pass. The top and left edges are the paper's own. Cut
  // guides for the two edges are drawn by stamp.js. (5.5" tall matches the
  // flip-folder window; adjust trimHeight if your folder differs.)
  //
  // Everything below is tuned to compress a part onto the small card while
  // staying legible at the shorter lyre reading distance. staffSpace 1.35 mm ⇒
  // ~5.4 mm staff height (1.35–1.45 mm range; below ~1.30 mm ledger lines/
  // accidentals degrade).
  lyre: {
    label: 'Lyre card (7×5.5, printed on portrait Letter)',
    pageWidth: 8.5, // portrait US Letter carrier sheet
    pageHeight: 11.0,
    trimWidth: 7.0, // finished card, pinned to the sheet's top-left corner
    trimHeight: 5.5,
    // 1/4" all around. Because the card is pinned to the sheet's TOP-LEFT
    // corner, its top and left edges ARE the paper's edges — so this inset must
    // clear the printer's non-printable border. Consumer lasers/inkjets swallow
    // up to ~1/4", so 0.25" (not the old 5 mm) is what actually keeps the first
    // system and the left of the header from being clipped. The right/bottom are
    // interior cut lines, but get the same 0.25" for an even card border.
    margin: 0.25,
    // Taller top band than the side margins. Top-down it stacks: 1/4" printer-
    // safe gap → the overlaid "Title - Instrument" header (drawn by stamp.js) →
    // an appropriate gap → the first system. 0.5" leaves a clean ~0.14" between
    // the header and the music. Keep this in sync with INSET/TOP_PAD in stamp.js,
    // which place the header at 1/4" below the top edge inside this band.
    marginTop: 0.5,
    // FLOOR staff space (~5.4 mm staff) — the bottom of the recommended
    // 1.35–1.45 mm lyre range; below ~1.30 mm ledger lines/accidentals degrade.
    // The `fit` ladder below grows this per part when the card has slack.
    staffSpace: 1.35,
    style: {
      // Consolidate extended rests — essential for individual parts.
      createMultiMeasureRests: true,
      enableIndentationOnFirstSystem: false, // reclaim the first-system indent
      // Horizontal compression (Style ▸ Measure) — pack more bars per system.
      // (measureSpacing / minNoteDistance are eased per rung via `fit.relax`.)
      minMeasureWidth: 2.0, // sp; squeeze full-rest / sparse bars hard
      // Vertical compression (Style ▸ Page) — pack more systems per page.
      // Vertical justification is ON, so system gaps follow the SPREAD range,
      // not min/maxSystemDistance (which apply only when justification is off).
      // MuseScore's default maxSystemSpread is 32 sp; at the floor rung we cap it
      // hard (see fit.relax) to pack systems, then relax it as notes grow so the
      // last page fills instead of clustering at the top.
      minSystemSpread: 3.0, // sp
      minSystemDistance: 5.0, // sp; floor of the 5.0–6.0 range (justify-off path)
      maxSystemDistance: 6.0, // sp
      staffUpperBorder: 0.0, // sp; drop padding above the top staff
      staffLowerBorder: 0.0, // sp; drop padding below the bottom staff
      // Trim large text so it doesn't inflate system bounding boxes.
      chordSymbolAFontSize: 10,
      rehearsalMarkFontSize: 12,
      staffTextFontSize: 9,
    },
    // Fit-to-card search. Rendered at each rung; the largest rung that doesn't
    // add a page over the floor (rung 0) is kept per part, so a short part grows
    // to fill the 5.5" card instead of floating at the top in 1.35 mm notes.
    // The ladder is a rounded, near-geometric progression (≈8.9%/step) from the
    // 1.35 mm floor to a 1.9 mm ceiling (~7.6 mm staff; rung 4 ≈ letter's 1.75).
    fit: {
      ladder: [1.35, 1.5, 1.6, 1.75, 1.9],
      // Eased from pack (rung 0) → comfortable (top rung), linear by rung index,
      // so bigger notes also breathe instead of staying crushed.
      relax: {
        maxSystemSpread: [5.0, 20.0], // sp; let systems spread down to fill the card
        measureSpacing: [1.3, 1.5], // note-spacing ratio toward the roomy default
        minNoteDistance: [0.4, 0.6], // sp; ease the gap between notes
      },
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
 * Per-rung override for a format's `fit` ladder: the rung's staff space plus each
 * `relax` tag interpolated from its pack value (rung 0) to its comfortable value
 * (top rung), linearly by rung index. Returns an `{ staffSpace, style }` override
 * for `styleFileFor`. Rung 0 reproduces the format's floor + pack values.
 *
 * @param {Format} fmt   A format with a `fit` block.
 * @param {number} rung  Ladder index (0 = floor).
 * @returns {{ staffSpace: number, style: Record<string, number> }}
 */
export function fitRungOverride(fmt, rung) {
  const ladder = fmt.fit.ladder;
  const t = ladder.length > 1 ? rung / (ladder.length - 1) : 0;
  const style = {};
  for (const [k, [lo, hi]] of Object.entries(fmt.fit.relax ?? {})) {
    style[k] = +(lo + (hi - lo) * t).toFixed(4);
  }
  return { staffSpace: ladder[rung], style };
}

/**
 * Build a MuseScore `.mss` style document for a format: page geometry + Spatium,
 * then any extra `style` tags. Unlisted engraving stays at MuseScore defaults.
 *
 * @param {Format} fmt
 * @param {{ staffSpace?: number, style?: Record<string, number|boolean> }} [overrides]
 *   Optional Spatium override and extra style tags merged ON TOP of `fmt.style`
 *   (used by the `fit` ladder to render the same format at a larger staff space).
 * @returns {string} XML text suitable for `mscore -S <file>.mss`.
 */
export function styleFileFor(fmt, overrides = {}) {
  // The music box is `trim` wide/tall (defaulting to the full sheet) pinned to
  // the top-left: left/top margins are the card's insets; the right and bottom
  // margins absorb the leftover carrier paper. MuseScore has no right-margin tag
  // — it's implied by pagePrintableWidth = trimWidth − left − right inset.
  const trimW = fmt.trimWidth ?? fmt.pageWidth;
  const trimH = fmt.trimHeight ?? fmt.pageHeight;
  const printableWidth = (trimW - 2 * fmt.margin).toFixed(4);
  const m = fmt.margin.toFixed(4);
  const mTop = (fmt.marginTop ?? fmt.margin).toFixed(4);
  const mBottom = (fmt.pageHeight - trimH + fmt.margin).toFixed(4);
  const spatium = overrides.staffSpace ?? fmt.staffSpace;
  const style = { ...(fmt.style ?? {}), ...(overrides.style ?? {}) };
  const lines = [
    tag('pageWidth', fmt.pageWidth),
    tag('pageHeight', fmt.pageHeight),
    tag('pagePrintableWidth', printableWidth),
    tag('pageEvenLeftMargin', m),
    tag('pageOddLeftMargin', m),
    tag('pageEvenTopMargin', mTop),
    tag('pageEvenBottomMargin', mBottom),
    tag('pageOddTopMargin', mTop),
    tag('pageOddBottomMargin', mBottom),
    tag('pageTwosided', 0),
    tag('Spatium', spatium),
    ...Object.entries(style).map(([k, v]) => tag(k, v)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.60">
  <Style>
${lines.join('\n')}
  </Style>
</museScore>
`;
}
