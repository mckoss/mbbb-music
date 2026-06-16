import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  ensureSchema,
  editFieldDb,
  deleteEditDb,
  restoreEditDb,
  effectiveOverlayDb,
  recentEditsDb,
  revisionDb,
} from '../src/lib/server/corrections.ts';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  return db;
}

const file = (over = {}) => ({ scope: 'file', targetId: 'drive1', field: 'instrumentSlug', value: 'tenor-sax', by: 'a@x', ...over });

test('an edit becomes the effective value immediately', () => {
  const db = freshDb();
  editFieldDb(db, file({ at: '2026-06-15T00:00:00.000Z' }));
  assert.deepEqual(effectiveOverlayDb(db).file, { drive1: { instrumentSlug: 'tenor-sax' } });
});

test('latest edit wins; deleting it reverts to the previous value', () => {
  const db = freshDb();
  editFieldDb(db, file({ by: 'a@x', value: 'tenor-sax', at: '2026-06-15T00:00:00.000Z' }));
  const second = editFieldDb(db, file({ by: 'b@x', value: 'bari-sax', at: '2026-06-15T01:00:00.000Z' }));
  assert.equal(effectiveOverlayDb(db).file.drive1.instrumentSlug, 'bari-sax'); // latest wins

  deleteEditDb(db, second.id, 'admin@x', '2026-06-15T02:00:00.000Z');
  assert.equal(effectiveOverlayDb(db).file.drive1.instrumentSlug, 'tenor-sax'); // reverts to prior
});

test('deleting a superseded (non-head) edit is a no-op on the effective value', () => {
  const db = freshDb();
  const first = editFieldDb(db, file({ by: 'a@x', value: 'tenor-sax', at: '2026-06-15T00:00:00.000Z' }));
  editFieldDb(db, file({ by: 'b@x', value: 'bari-sax', at: '2026-06-15T01:00:00.000Z' }));
  deleteEditDb(db, first.id, 'admin@x'); // first was already superseded
  assert.equal(effectiveOverlayDb(db).file.drive1.instrumentSlug, 'bari-sax'); // unchanged
});

test('same user + same field collapses: prior edit is soft-deleted, history kept', () => {
  const db = freshDb();
  editFieldDb(db, file({ by: 'a@x', value: 'tenor-sax', at: '2026-06-15T00:00:00.000Z' }));
  editFieldDb(db, file({ by: 'a@x', value: 'alto-sax', at: '2026-06-15T00:05:00.000Z' }));

  // Only the latest is active...
  assert.equal(effectiveOverlayDb(db).file.drive1.instrumentSlug, 'alto-sax');
  // ...but both rows survive in history (one soft-deleted as a self-supersede).
  const rows = recentEditsDb(db);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.deleted_at == null).length, 1);
});

test('a different user does NOT collapse — competing edits coexist, latest shows', () => {
  const db = freshDb();
  editFieldDb(db, file({ by: 'a@x', value: 'tenor-sax', at: '2026-06-15T00:00:00.000Z' }));
  editFieldDb(db, file({ by: 'b@x', value: 'bari-sax', at: '2026-06-15T00:05:00.000Z' }));
  assert.equal(recentEditsDb(db).filter((r) => r.deleted_at == null).length, 2);
  assert.equal(effectiveOverlayDb(db).file.drive1.instrumentSlug, 'bari-sax');
});

test('restore un-deletes an edit, bringing its value back', () => {
  const db = freshDb();
  const e = editFieldDb(db, file({ by: 'a@x', value: 'tenor-sax', at: '2026-06-15T00:00:00.000Z' }));
  deleteEditDb(db, e.id, 'admin@x', '2026-06-15T01:00:00.000Z');
  assert.equal(effectiveOverlayDb(db).file.drive1, undefined); // gone after delete

  assert.equal(restoreEditDb(db, e.id), true);
  assert.equal(effectiveOverlayDb(db).file.drive1.instrumentSlug, 'tenor-sax'); // back
  // Restoring something that isn't deleted is a no-op.
  assert.equal(restoreEditDb(db, e.id), false);
});

test('restoring an old edit still yields to a newer active one (latest wins)', () => {
  const db = freshDb();
  const first = editFieldDb(db, file({ by: 'a@x', value: 'tenor-sax', at: '2026-06-15T00:00:00.000Z' }));
  deleteEditDb(db, first.id, 'admin@x', '2026-06-15T00:30:00.000Z');
  editFieldDb(db, file({ by: 'b@x', value: 'bari-sax', at: '2026-06-15T01:00:00.000Z' }));
  restoreEditDb(db, first.id); // older edit comes back...
  assert.equal(effectiveOverlayDb(db).file.drive1.instrumentSlug, 'bari-sax'); // ...but newer still wins
});

test('song-scope edits (display name + display slug) land in the song bucket', () => {
  const db = freshDb();
  editFieldDb(db, { scope: 'song', targetId: 'beyonce-freedom', field: 'displayName', value: 'Freedom', by: 'a@x', at: '2026-06-15T00:00:00.000Z' });
  editFieldDb(db, { scope: 'song', targetId: 'beyonce-freedom', field: 'displaySlug', value: 'freedom', by: 'a@x', at: '2026-06-15T00:01:00.000Z' });
  // Keyed by the STABLE identity slug; the override is presentation only.
  assert.deepEqual(effectiveOverlayDb(db).song, {
    'beyonce-freedom': { displayName: 'Freedom', displaySlug: 'freedom' },
  });
});

test('folder-scope assignment lands in the folder bucket', () => {
  const db = freshDb();
  editFieldDb(db, { scope: 'folder', targetId: 'F1', field: 'songSlug', value: 'target-song', by: 'a@x', at: '2026-06-15T00:00:00.000Z' });
  assert.deepEqual(effectiveOverlayDb(db).folder, { F1: { songSlug: 'target-song' } });
});

test('an unknown field for a scope is rejected', () => {
  const db = freshDb();
  assert.throws(() => editFieldDb(db, file({ field: 'tempo' })), /not correctable/);
  assert.throws(() => editFieldDb(db, { scope: 'song', targetId: 's', field: 'instrument', value: 'x', by: 'a@x' }), /not correctable/);
});

test('revision changes on insert and on delete', () => {
  const db = freshDb();
  const r0 = revisionDb(db);
  const e = editFieldDb(db, file({ at: '2026-06-15T00:00:00.000Z' }));
  const r1 = revisionDb(db);
  assert.notEqual(r0, r1); // insert moved it
  deleteEditDb(db, e.id, 'admin@x', '2026-06-15T03:00:00.000Z');
  assert.notEqual(r1, revisionDb(db)); // delete moved it too
});

// --- overlay application over a manifest -----------------------------------
import { applyCorrections, buildCatalog } from '../src/sync/catalog.js';

test('reassigning a container-folder file actually moves it (assignment beats the filename heuristic)', () => {
  const inIndex = (over) => ({
    assetType: 'pdf',
    originalFolder: '50 Indexed By Instrument (INCOMPLETE)', // a container folder
    songTitleSlug: 'tracksuit-updated6',
    songTitle: 'Tracksuit Updated6',
    sourceFolderLabel: 'src',
    ...over,
  });
  const manifest = {
    files: {
      real: { driveFileId: 'dr', sha256: 'r', assetType: 'pdf', instrumentSlug: 'trumpet', originalName: 'Tracksuit-Trumpet.pdf', originalFolder: 'Tracksuit', songTitleSlug: 'tracksuit', songTitle: 'Tracksuit', sourceFolderLabel: 'src' },
      s1: inIndex({ driveFileId: 'ds1', sha256: 's1', instrumentSlug: 'alto-sax', originalName: 'Copy of Alto Sax TrackSuit_(updated6.3.2016).pdf' }),
      s2: inIndex({ driveFileId: 'ds2', sha256: 's2', instrumentSlug: 'tenor-sax', originalName: 'Copy of Tenor Sax TrackSuit_(updated6.3.2016).pdf' }),
    },
  };
  // Baseline: the two index-folder files cluster into their own bogus song.
  assert.ok(buildCatalog(manifest, ['src']).tunes.some((t) => t.slug === 'tracksuit-updated6'));

  // Reassign one of them to the real "tracksuit" — it must actually land there.
  const corrected = applyCorrections(manifest, { file: { ds1: { songSlug: 'tracksuit' } }, song: {}, folder: {} });
  const tr = buildCatalog(corrected, ['src']).tunes.find((t) => t.slug === 'tracksuit');
  assert.ok(tr.parts.some((p) => p.driveFileId === 'ds1'), 'the reassigned file is now in tracksuit');
});

test('applyCorrections patches instrument (slug + label), key, part by drive id', () => {
  const manifest = {
    files: {
      f1: { driveFileId: 'd1', sha256: 'a', assetType: 'pdf', instrumentSlug: 'alto-sax', instrument: 'Alto saxophone', songTitleSlug: 'bad-guy', songTitle: 'Bad Guy' },
    },
  };
  const overlay = { file: { d1: { instrumentSlug: 'tenor-sax', partNumber: '2' } }, song: {} };
  const out = applyCorrections(manifest, overlay);
  assert.equal(out.files.f1.instrumentSlug, 'tenor-sax');
  assert.equal(out.files.f1.instrument, 'Tenor saxophone'); // label follows the slug
  assert.equal(out.files.f1.partNumber, 2);
  assert.equal(manifest.files.f1.instrumentSlug, 'alto-sax'); // original NOT mutated
});

test('applyCorrections does NOT touch song identity — song overlay is presentation-only', () => {
  const manifest = {
    files: {
      f1: { driveFileId: 'd1', sha256: 'a', assetType: 'pdf', songTitleSlug: 'beyonce-freedom', songTitle: 'beyonce freedom' },
    },
  };
  // A song overlay is ignored by applyCorrections (the slug is a stable identity);
  // display name / display slug are applied later, at the tune level, in library.ts.
  const overlay = { file: {}, song: { 'beyonce-freedom': { displaySlug: 'freedom', displayName: 'Freedom' } } };
  const out = applyCorrections(manifest, overlay);
  assert.equal(out, manifest); // nothing to change at the manifest level
  assert.equal(out.files.f1.songTitleSlug, 'beyonce-freedom'); // identity untouched
});

test('applyCorrections returns the same manifest when the overlay is empty', () => {
  const manifest = { files: { f1: { driveFileId: 'd1' } } };
  assert.equal(applyCorrections(manifest, { file: {}, song: {}, folder: {} }), manifest);
});

test('applyCorrections (re)assigns a single file to another song, adopting its title', () => {
  const manifest = {
    files: {
      a: { driveFileId: 'da', songFolderId: 'F1', songTitleSlug: 'wrong-song', songTitle: 'Wrong Song', assetType: 'pdf' },
      b: { driveFileId: 'db', songFolderId: 'F2', songTitleSlug: 'right-song', songTitle: 'Right Song', assetType: 'pdf' },
    },
  };
  const out = applyCorrections(manifest, { file: { da: { songSlug: 'right-song' } }, song: {}, folder: {} });
  assert.equal(out.files.a.songTitleSlug, 'right-song');
  assert.equal(out.files.a.songTitle, 'Right Song'); // joins under the target's existing title
});

test('applyCorrections reassigns a whole folder; a file-level assignment overrides it', () => {
  const manifest = {
    files: {
      a: { driveFileId: 'da', songFolderId: 'F1', songTitleSlug: 'mix', songTitle: 'Mix', assetType: 'pdf' },
      b: { driveFileId: 'db', songFolderId: 'F1', songTitleSlug: 'mix', songTitle: 'Mix', assetType: 'pdf' },
      c: { driveFileId: 'dc', songFolderId: 'F1', songTitleSlug: 'mix', songTitle: 'Mix', assetType: 'pdf' },
      t: { driveFileId: 'dt', songFolderId: 'F9', songTitleSlug: 'target', songTitle: 'Target', assetType: 'pdf' },
    },
  };
  const overlay = { file: { dc: { songSlug: 'other' } }, song: {}, folder: { F1: { songSlug: 'target' } } };
  const out = applyCorrections(manifest, overlay);
  assert.equal(out.files.a.songTitleSlug, 'target'); // moved by the folder rule
  assert.equal(out.files.b.songTitleSlug, 'target');
  assert.equal(out.files.c.songTitleSlug, 'other'); // file-level assignment wins over folder
});

test('applyCorrections can assign files to a brand-new song (title-cased label)', () => {
  const manifest = {
    files: { a: { driveFileId: 'da', songFolderId: 'F1', songTitleSlug: 'orphan', songTitle: 'orphan', assetType: 'pdf' } },
  };
  const out = applyCorrections(manifest, { file: { da: { songSlug: 'free-bird' } }, song: {}, folder: {} });
  assert.equal(out.files.a.songTitleSlug, 'free-bird');
  assert.equal(out.files.a.songTitle, 'Free Bird'); // a new song gets a title-cased label
});
