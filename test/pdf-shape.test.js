import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatFromShape, formatOf } from '../src/sync/catalog.js';

const inToPt = (i) => i * 72;

test('formatFromShape classifies nominal page sizes', () => {
  assert.equal(formatFromShape(inToPt(8.5), inToPt(11)), 'letter'); // US Letter
  assert.equal(formatFromShape(inToPt(5), inToPt(7)), 'lyre'); // lyre/flip-folio
  assert.equal(formatFromShape(inToPt(8.27), inToPt(11.69)), 'letter'); // A4 → letter
  assert.equal(formatFromShape(inToPt(5.5), inToPt(8.5)), 'lyre'); // half-letter → lyre
});

test('landscape counts as lyre only when landscapeIsLyre is set (parts)', () => {
  // A small landscape page is lyre by size regardless.
  assert.equal(formatFromShape(inToPt(7), inToPt(5)), 'lyre');
  // A landscape LETTER page: lyre for a part, but plain letter for a score.
  assert.equal(formatFromShape(inToPt(11), inToPt(8.5), true), 'lyre'); // part
  assert.equal(formatFromShape(inToPt(11), inToPt(8.5), false), 'letter'); // score
  // A landscape A3 full score stays letter (size-classified), not lyre.
  assert.equal(formatFromShape(inToPt(16.5), inToPt(11.7), false), 'letter');
});

test('formatFromShape returns null for missing/degenerate dimensions', () => {
  assert.equal(formatFromShape(0, 100), null);
  assert.equal(formatFromShape(undefined, undefined), null);
});

test('formatOf prefers the physical page shape over the filename', () => {
  // Filename says nothing, but the page is lyre-sized → lyre.
  assert.equal(
    formatOf({ originalName: 'Song - Trumpet.pdf', pageWidthPt: inToPt(5), pageHeightPt: inToPt(7) }),
    'lyre',
  );
  // Filename says "Lyre" but the page is physically Letter → letter (shape wins).
  assert.equal(
    formatOf({ originalName: 'Song - Trumpet-Lyre.pdf', pageWidthPt: inToPt(8.5), pageHeightPt: inToPt(11) }),
    'letter',
  );
});

test('formatOf applies the landscape→lyre rule to parts, not whole-band scores', () => {
  const land = { pageWidthPt: inToPt(11), pageHeightPt: inToPt(8.5) };
  // A landscape instrument part → lyre (flip-folio).
  assert.equal(formatOf({ ...land, instrumentSlug: 'trumpet', originalName: 'Song-Trumpet.pdf' }), 'lyre');
  // A landscape full-band score (no instrument) stays letter.
  assert.equal(formatOf({ ...land, instrumentSlug: null, originalName: 'Song Full Score.pdf' }), 'letter');
});

test('formatOf falls back to the filename when shape is unknown', () => {
  assert.equal(formatOf({ originalName: 'Song - Trumpet-Lyre.pdf' }), 'lyre');
  assert.equal(formatOf({ originalName: 'Song - Trumpet.pdf' }), 'letter');
  // Bare-string form (filename-only callers/tests) still works.
  assert.equal(formatOf('Song-Lyre.pdf'), 'lyre');
  assert.equal(formatOf('Song.pdf'), 'letter');
  assert.equal(formatOf(null), 'letter');
});
