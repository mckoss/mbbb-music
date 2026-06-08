import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCatalog, partDownloadName, descriptorOf, matchIdentifiers } from '../src/sync/catalog.js';

// A small synthetic manifest exercising dedup, source priority, and bucketing.
const MANIFEST = {
  files: {
    // Bad Guy trumpet part in the higher-priority source.
    a: {
      status: 'synced', sha256: 'h1', assetType: 'pdf',
      songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
      instrument: 'Trumpet', instrumentSlug: 'trumpet', key: null, partNumber: null,
      sourceFolderLabel: 'primary', originalFolder: 'Bad Guy',
      modifiedTime: '2026-01-02T00:00:00.000Z', originalName: 'Bad Guy - Trumpet.pdf',
    },
    // Same bytes (h1), but filed under the index folder in the lower-priority
    // source — must collapse into `a`, not appear as its own "song".
    b: {
      status: 'synced', sha256: 'h1', assetType: 'pdf',
      songTitle: '50 Indexed By Instrument', songTitleSlug: '50-indexed-by-instrument',
      instrument: 'Trumpet', instrumentSlug: 'trumpet',
      sourceFolderLabel: 'secondary', originalFolder: '50 Indexed By Instrument',
      modifiedTime: '2026-01-01T00:00:00.000Z', originalName: 'Copy of Trumpet.pdf',
    },
    c: {
      status: 'synced', sha256: 'h2', assetType: 'mp3',
      songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
      sourceFolderLabel: 'primary', originalFolder: 'Bad Guy',
      modifiedTime: '2026-01-03T00:00:00.000Z', originalName: 'Bad Guy.mp3',
    },
    d: {
      status: 'synced', sha256: 'h3', assetType: 'musescore',
      songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
      sourceFolderLabel: 'primary', originalFolder: 'Bad Guy', originalName: 'Bad Guy.mscz',
    },
    e: {
      status: 'synced', sha256: 'h4', assetType: 'pdf',
      songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
      sourceFolderLabel: 'primary', originalFolder: 'Bad Guy', originalName: 'Bad Guy - Full Score.pdf',
    },
    f: { status: 'ignored|google-drive-shortcut', sha256: 'hx', songTitle: 'Bad Guy', sourceFolderLabel: 'primary' },
    g: {
      status: 'synced', sha256: 'h5', assetType: 'pdf',
      songTitle: 'Iron Man', songTitleSlug: 'iron-man',
      instrument: 'Alto saxophone', instrumentSlug: 'alto-sax', key: 'eflat', partNumber: 2,
      sourceFolderLabel: 'primary', originalFolder: 'Iron Man', originalName: 'Iron Man - Alto Sax 2.pdf',
    },
  },
};

test('buildCatalog groups by song, dedups content, and buckets assets', () => {
  const { tunes, instruments, uniqueCount, liveCount } = buildCatalog(MANIFEST, ['primary', 'secondary']);

  assert.equal(liveCount, 6); // a,b,c,d,e,g (f is ignored)
  assert.equal(uniqueCount, 5); // h1,h2,h3,h4,h5 (h1 shared by a+b)

  assert.deepEqual(tunes.map((t) => t.slug), ['bad-guy', 'iron-man']);

  const bad = tunes.find((t) => t.slug === 'bad-guy');
  assert.equal(bad.parts.length, 1, 'duplicate trumpet content collapses to one part');
  assert.equal(bad.parts[0].key, 'bflat', "trumpet's default key is folded in");
  assert.equal(bad.audio.length, 1);
  assert.equal(bad.musescore.length, 1);
  assert.equal(bad.scores.length, 1); // instrument-less PDF
  assert.equal(bad.lastModified, '2026-01-03T00:00:00.000Z'); // max across the song
});

test('the index-folder copy is attributed to the real song, not its own entry', () => {
  const { tunes } = buildCatalog(MANIFEST, ['primary', 'secondary']);
  assert.ok(!tunes.some((t) => t.slug === '50-indexed-by-instrument'));
});

test('content that only lives in an index/container folder is surfaced under Misc, never as a title', () => {
  const manifest = {
    files: {
      orphan: {
        status: 'synced', sha256: 'u1', assetType: 'mp3',
        songTitle: '20 Audio Files (INCOMPLETE)', songTitleSlug: '20-audio-files-incomplete',
        sourceFolderLabel: 'primary', originalFolder: '20 Audio Files (INCOMPLETE)',
        originalName: 'Bumper to Bumper.mp3',
      },
      // A real song with a number-leading name must still be a normal title.
      realSong: {
        status: 'synced', sha256: 'r1', assetType: 'pdf',
        songTitle: '30 seconds to freebird', songTitleSlug: '30-seconds-to-freebird',
        sourceFolderLabel: 'primary', originalFolder: '30 seconds to freebird',
        originalName: '30 seconds to freebird - Score.pdf',
      },
    },
  };
  const { tunes } = buildCatalog(manifest, ['primary']);
  assert.ok(!tunes.some((t) => t.slug.startsWith('20-audio-files')), 'the index folder is not a title');
  assert.ok(tunes.some((t) => t.slug === '30-seconds-to-freebird'), 'a real number-leading song stays a title');
  const misc = tunes.find((t) => t.slug === 'misc');
  assert.ok(misc && misc.audio.length === 1, 'the orphan audio lands in Misc');
});

test('explicit key and part number survive', () => {
  const { tunes } = buildCatalog(MANIFEST, ['primary', 'secondary']);
  const iron = tunes.find((t) => t.slug === 'iron-man');
  assert.equal(iron.parts[0].key, 'eflat');
  assert.equal(iron.parts[0].partNumber, 2);
});

test('instruments are listed once, sorted by label', () => {
  const { instruments } = buildCatalog(MANIFEST, ['primary', 'secondary']);
  assert.deepEqual(instruments, [
    { slug: 'alto-sax', label: 'Alto saxophone', key: 'eflat' },
    { slug: 'trumpet', label: 'Trumpet', key: 'bflat' },
  ]);
});

test('partDownloadName builds a standardized filename', () => {
  assert.equal(
    partDownloadName('iron-man', { instrumentSlug: 'alto-sax', key: 'eflat', partNumber: 2 }),
    'mbbb-iron-man-alto-sax-eflat-part2.pdf',
  );
  assert.equal(descriptorOf(MANIFEST.files.g), 'alto-sax-eflat-2');
});

test('matchIdentifiers lets an asset be opened by its song/type key or by filename', () => {
  // A loose logo image in the Misc bucket — the case `open mutiny-bay-logo.jpg`
  // must work, not only the coarse `misc-image` key.
  const logo = { assetType: 'image', songTitle: 'Misc', songTitleSlug: 'misc', originalName: 'mutiny-bay-logo.jpg' };
  const ids = matchIdentifiers(logo);
  assert.ok(ids.includes('misc-image'), 'song/type key');
  assert.ok(ids.includes('mutiny-bay-logo'), 'filename stem (no extension)');
  assert.ok(ids.includes('mutiny-bay-logo-jpg'), 'full filename slug');
  // The user-typed `mutiny-bay-logo.jpg` slugifies to a value covered above.
  assert.ok(ids.some((id) => id.startsWith('mutiny-bay-logo')));

  // Instrument parts still expose their descriptor key.
  const part = { assetType: 'pdf', songTitleSlug: 'iron-man', instrumentSlug: 'trumpet', key: 'bflat', originalName: 'Iron Man - Trumpet.pdf' };
  assert.ok(matchIdentifiers(part).includes('iron-man-trumpet-bflat'));
});

test('images bucket inline, other files (docx/zip) bucket as downloads, song-less files go to Misc', () => {
  const manifest = {
    files: {
      img: {
        status: 'synced', sha256: 'i1', assetType: 'image',
        songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
        sourceFolderLabel: 'primary', originalFolder: 'Bad Guy', originalName: 'cover.jpg',
      },
      doc: {
        status: 'synced', sha256: 'd1', assetType: 'doc',
        songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
        sourceFolderLabel: 'primary', originalFolder: 'Bad Guy', originalName: 'Notes.docx',
      },
      zip: {
        status: 'synced', sha256: 'z1', assetType: 'archive',
        songTitle: 'Misc', songTitleSlug: 'misc',
        sourceFolderLabel: 'primary', originalName: 'Stage Plot.zip',
      },
    },
  };
  const { tunes } = buildCatalog(manifest, ['primary']);

  const bad = tunes.find((t) => t.slug === 'bad-guy');
  assert.equal(bad.images.length, 1);
  assert.equal(bad.images[0].originalName, 'cover.jpg');
  assert.equal(bad.images[0].assetType, 'image');
  assert.equal(bad.files.length, 1); // the docx
  assert.equal(bad.files[0].assetType, 'doc');

  const misc = tunes.find((t) => t.slug === 'misc');
  assert.ok(misc, 'a Misc tune exists for song-less files');
  assert.equal(misc.files.length, 1);
  assert.equal(misc.files[0].originalName, 'Stage Plot.zip');
  assert.equal(misc.files[0].assetType, 'archive');
});
