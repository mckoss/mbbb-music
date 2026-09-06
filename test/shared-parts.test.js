import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, applyCorrections } from '../src/sync/catalog.js';
import { sharedPartMetadata, compatibleInstruments } from '../src/sync/shared-parts.js';
import { detectInstrument, detectPartNumbers } from '../src/sync/instruments.js';
import { partsForFormat, activePdfs, activeScoreForRun } from '../src/lib/resolve.ts';
import { partShortLabel } from '../src/lib/format.ts';
import { buildAssetIndex } from '../src/lib/asset-urls.ts';
import { readPartPreferences, preferenceKey } from '../src/lib/part-preferences.ts';

const entry = (id, name, extra = {}) => ({ driveFileId: id, sha256: id, status: 'synced', assetType: 'pdf', originalName: name,
  originalFolder: 'Example', songTitle: 'Example', songTitleSlug: 'example', sourceFolderLabel: 'source', ...extra });
const manifest = { files: {
  melody: entry('melody', 'Example-Melody_in_Bb_(Treble_Clef).pdf'),
  harmony: entry('harmony', 'Example-Harmony_in_Bb_(Treble_Clef).pdf'),
  full: entry('full', 'Example-score.pdf'),
} };
const tune = (m = manifest) => buildCatalog(m).tunes[0];

test('shared roles stay distinct and appear once in each candidate instrument', () => {
  const t = tune();
  for (const instrument of ['trumpet', 'clarinet', 'tenor-sax']) {
    const parts = partsForFormat(t, instrument, 'letter');
    assert.equal(parts.length, 2);
    assert.deepEqual(new Set(parts.map((p) => p.role)), new Set(['Melody', 'Harmony']));
    assert.match(partShortLabel(parts[0], parts), /treble clef/);
  }
  assert.equal(t.scores.length, 1);
  assert.equal(partsForFormat(t, 'tuba', 'letter').length, 0);
});

test('notation limits candidate buckets; unspecified and unusual clefs are not silently asserted', () => {
  const bass = sharedPartMetadata('Example-Bass-C-bass_clef.pdf');
  assert.deepEqual(compatibleInstruments(bass), ['trombone', 'euphonium', 'tuba']);
  assert.deepEqual(compatibleInstruments(sharedPartMetadata('Example-Melody-C-treble_clef.pdf')), ['flute', 'melodica']);
  assert.equal(sharedPartMetadata('Example-solo-c.pdf').clef, null);
  assert.deepEqual(compatibleInstruments(sharedPartMetadata('Example-Bass-Eb-bass_clef.pdf')), []);
  assert.equal(sharedPartMetadata('Bass in C.pdf', 'Bass in C'), null);
});

test('hiding is scoped to instrument, excludes packet choices, and leaves raw manifest untouched', () => {
  const corrected = applyCorrections(manifest, { file: { melody: { hiddenInstruments: '["trumpet"]' } } });
  const t = tune(corrected);
  assert.deepEqual(activePdfs(t, 'trumpet', 'letter').map((p) => p.sha), ['harmony']);
  assert.equal(partsForFormat(t, 'clarinet', 'letter').length, 2);
  assert.equal(t.hiddenParts.length, 1);
  assert.equal(manifest.files.melody.hiddenInstruments, undefined);
  assert.equal(activeScoreForRun(t, 'trumpet', 'letter', 'melody', null).sha, 'harmony');
});

test('global hide and restore retain earlier instrument exclusions across rebuilt manifests', () => {
  const overlay = { file: { melody: { hidden: 'true', hiddenInstruments: '["trumpet"]' } } };
  const hidden = tune(applyCorrections(structuredClone(manifest), overlay));
  assert.equal(hidden.parts.filter((p) => p.sha256 === 'melody').length, 0);
  assert.ok(hidden.hiddenParts.every((p) => p.hiddenGlobally));
  overlay.file.melody.hidden = 'false';
  const restored = tune(applyCorrections(structuredClone(manifest), overlay));
  assert.equal(restored.hiddenParts.length, 1);
  assert.ok(restored.parts.some((p) => p.sha256 === 'melody' && p.instrumentSlug === 'clarinet'));
});

test('shared download filenames preserve role and notation without claiming a single instrument', () => {
  const idx = buildAssetIndex({ tunes: [tune()] });
  assert.match(idx.nameBySha.get('melody'), /shared-melody-treble-clef-bflat/);
  assert.equal([...idx.byPath.values()].filter((sha) => sha === 'melody').length, 1);
});

test('new aliases work on existing manifests while explicit corrections win', () => {
  const raw = { files: { x: entry('x', 'Example-Bone_2.pdf') } };
  assert.equal(tune(raw).parts[0].instrumentSlug, 'trombone');
  const corrected = applyCorrections(raw, { file: { x: { instrumentSlug: 'euphonium' } } });
  assert.equal(tune(corrected).parts[0].instrumentSlug, 'euphonium');
  const cleared = tune(applyCorrections(manifest, { file: { melody: { instrumentSlug: '' } } }));
  assert.ok(!cleared.parts.some((p) => p.sha256 === 'melody'));
  assert.equal(cleared.unclassified[0].sha256, 'melody');
  assert.equal(detectInstrument('Example-Net_1').slug, 'clarinet');
  assert.equal(detectInstrument('Example-Tenor_Drums').slug, 'drums');
  assert.deepEqual(detectPartNumbers('Example-Trumpet_2_3.pdf'), [2, 3]);
  assert.deepEqual(detectPartNumbers('Example-Eb_Part_2_(Alto_Sax).pdf'), [2]);
});

test('remembered choices separate account, tune, instrument and format and tolerate unavailable storage', () => {
  const key = preferenceKey('member', 'example', 'trumpet', 'letter');
  assert.notEqual(key, preferenceKey('member', 'example', 'clarinet', 'letter'));
  assert.notEqual(key, preferenceKey('another-member', 'example', 'trumpet', 'letter'));
  assert.deepEqual(readPartPreferences({ getItem: () => JSON.stringify({ [key]: 'melody', invalid: 2 }) }), { [key]: 'melody' });
  assert.deepEqual(readPartPreferences({ getItem() { throw Error('blocked'); } }), {});
});
