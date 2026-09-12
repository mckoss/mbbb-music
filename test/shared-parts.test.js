import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, applyCorrections } from '../src/sync/catalog.js';
import { sharedPartMetadata, compatibleInstruments } from '../src/sync/shared-parts.js';
import { detectInstrument, detectPartNumbers } from '../src/sync/instruments.js';
import { partsForFormat, activePdf, activePdfs, activeScoreForRun, viewableDocs } from '../src/lib/resolve.ts';
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

test('a whole-band chart the importer cannot place stays readable by players', () => {
  // "<song>-parts.pdf" trips the shared-chart role word "parts" but names no
  // transposition, so it lands in `unclassified`. That bucket is a review flag for
  // admins — it must never be the reason a song shows the band nothing.
  const m = { files: { band: entry('band', 'Example-parts.pdf') } };
  const t = tune(m);
  assert.equal(t.parts.length, 0);
  assert.equal(t.scores.length, 0);
  assert.deepEqual(t.unclassified.map((a) => a.sha256), ['band']);

  const docs = viewableDocs(t, 'trumpet', 'letter');
  assert.deepEqual(docs.map((d) => d.sha), ['band']);
  // It's the only music the song has, so it's also what a packet and a gig run get.
  assert.equal(activePdf(t, 'trumpet', 'letter')?.sha, 'band');
  // And it keeps a real, named download URL rather than a bare /blob/<sha>.
  assert.equal(buildAssetIndex({ tunes: [t] }).bySha.get('band'), 'score/example/example-parts.pdf');
});

test('a band chart outranks a full score for a player with no part', () => {
  const m = { files: {
    full: entry('full', 'Example-score.pdf'),
    band: entry('band', 'Example-parts.pdf'),
  } };
  const t = tune(m);
  const docs = viewableDocs(t, 'trumpet', 'letter');
  // A score is a conductor's document; the compilation holds a part this player can
  // actually read, so it opens first. The score stays one pick away.
  assert.deepEqual(docs.map((d) => d.sha), ['band', 'full']);
  assert.equal(activePdf(t, 'trumpet', 'letter')?.sha, 'band');
});

test('a player with a part of their own still gets it first', () => {
  const m = { files: {
    band: entry('band', 'Example-parts.pdf'),
    full: entry('full', 'Example-score.pdf'),
    tpt: entry('tpt', 'Example-Trumpet.pdf'),
  } };
  const t = tune(m);
  const docs = viewableDocs(t, 'trumpet', 'letter');
  assert.equal(docs[0].sha, 'tpt');
  assert.equal(docs[0].kind, 'part');
  assert.equal(activePdf(t, 'trumpet', 'letter')?.sha, 'tpt');
});

test('admin start-page corrections ride along with the chart', () => {
  const m = { files: { band: entry('band', 'Example-parts.pdf') } };
  const overlay = { file: { band: { partPages: '{"trumpet":2,"tuba":0,"flute":"x"}' } }, song: {}, folder: {} };
  const t = buildCatalog(applyCorrections(m, overlay)).tunes[0];
  // Only whole page numbers survive; a zero or a non-number would strand a reader.
  assert.deepEqual(t.unclassified[0].partPages, { trumpet: 2 });
  assert.deepEqual(viewableDocs(t, 'trumpet', 'letter')[0].asset?.partPages, { trumpet: 2 });
  assert.deepEqual(activePdf(t, 'trumpet', 'letter')?.partPages, { trumpet: 2 });
});

test('a malformed start-page correction is dropped, not thrown', () => {
  const m = { files: { band: entry('band', 'Example-parts.pdf') } };
  for (const value of ['not json', '[1,2]', 'null', '']) {
    const overlay = { file: { band: { partPages: value } }, song: {}, folder: {} };
    const t = buildCatalog(applyCorrections(m, overlay)).tunes[0];
    assert.equal(t.unclassified[0].partPages, undefined);
  }
});
