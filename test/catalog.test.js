import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCatalog, partDownloadName, descriptorOf, matchIdentifiers, matchKnownSong, songPrefixOf } from '../src/sync/catalog.js';

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

test('index/container files match a known song by filename, else go to Extra Files (never a "Misc" title)', () => {
  const manifest = {
    files: {
      // A real song folder establishes "Bad Guy" as a known song.
      real: {
        status: 'synced', sha256: 'b1', assetType: 'pdf',
        songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
        sourceFolderLabel: 'primary', originalFolder: 'Bad Guy', originalName: 'Bad Guy - Trumpet.pdf',
        instrument: 'Trumpet', instrumentSlug: 'trumpet',
      },
      // Audio in an index folder, named for a known song -> merges into Bad Guy.
      indexed: {
        status: 'synced', sha256: 'u1', assetType: 'mp3',
        songTitle: '20 Audio Files (INCOMPLETE)', songTitleSlug: '20-audio-files-incomplete',
        sourceFolderLabel: 'primary', originalFolder: '20 Audio Files (INCOMPLETE)',
        originalName: 'Bad Guy - Practice.mp3',
      },
      // An index file for an unknown song -> Extra Files.
      orphan: {
        status: 'synced', sha256: 'u2', assetType: 'pdf',
        songTitle: '50 Indexed By Instrument', songTitleSlug: '50-indexed-by-instrument',
        sourceFolderLabel: 'primary', originalFolder: '50 Indexed By Instrument',
        originalName: 'Funkytown - Trumpet.pdf',
      },
    },
  };
  const { tunes, extras } = buildCatalog(manifest, ['primary']);
  assert.ok(!tunes.some((t) => /20-audio|50-indexed/.test(t.slug)), 'index folders are not titles');
  assert.ok(!tunes.some((t) => t.slug === 'misc'), 'there is no "Misc" song');
  const bad = tunes.find((t) => t.slug === 'bad-guy');
  assert.equal(bad.audio.length, 1, 'the indexed audio merged into Bad Guy by filename');
  assert.equal(extras.length, 1, 'the unknown-song file went to Extra Files');
  assert.equal(extras[0].originalName, 'Funkytown - Trumpet.pdf');
});

test('files from a loose (unfoldered) source are matched by filename or sent to Extra Files', () => {
  const manifest = {
    files: {
      real: {
        status: 'synced', sha256: 'b1', assetType: 'pdf',
        songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
        sourceFolderLabel: 'foldered', originalFolder: 'Bad Guy', originalName: 'Bad Guy - Trumpet.pdf',
        instrument: 'Trumpet', instrumentSlug: 'trumpet',
      },
      looseMatch: {
        status: 'synced', sha256: 'l1', assetType: 'mp3',
        sourceFolderLabel: 'loose', // no originalFolder
        originalName: 'Bad_Guy_Sound_Machine-Drumset.mp3',
      },
      looseExtra: {
        status: 'synced', sha256: 'l2', assetType: 'image',
        sourceFolderLabel: 'loose',
        originalName: 'mutiny-bay-logo.jpg',
      },
    },
  };
  const { tunes, extras } = buildCatalog(manifest, ['foldered', 'loose'], ['loose']);
  const bad = tunes.find((t) => t.slug === 'bad-guy');
  assert.equal(bad.audio.length, 1, 'the loose mp3 matched "Bad Guy" via its filename');
  assert.equal(extras.length, 1, 'the unmatched logo went to Extra Files');
  assert.equal(extras[0].originalName, 'mutiny-bay-logo.jpg');
});

test('songPrefixOf strips trailing instrument/key/descriptor tokens', () => {
  assert.equal(songPrefixOf('Anthrax - Trumpet in Bb.pdf'), 'anthrax');
  assert.equal(songPrefixOf('Copy of Pony - Baritone (B.C.).pdf'), 'pony');
  assert.equal(songPrefixOf('Down For My City v2-C_(low)_BC.pdf'), 'down-for-my-city');
  assert.equal(songPrefixOf('You_Move_Ya_Lose-melody-Bb-treble_clef-letter.pdf'), 'you-move-ya-lose');
  // A name that STARTS with a descriptor (instrument/score word) has no usable
  // song prefix — such files fall through to Extra Files.
  assert.equal(songPrefixOf('Trumpet Medicated Chicken Water.pdf'), '');
  assert.equal(songPrefixOf('Score_and_Parts.pdf'), '');
});

test('unfoldered files sharing a song prefix form a new song; a lone file stays Extra', () => {
  const file = (sha, name) => ({
    status: 'synced', sha256: sha, assetType: 'pdf', sourceFolderLabel: 'loose', originalName: name,
  });
  const manifest = {
    files: {
      a: file('a1', 'Anthrax - Trombone.pdf'),
      b: file('b1', 'Anthrax - Trumpet in Bb.pdf'),
      c: file('c1', 'Anthrax - Full Score.pdf'),
      lone: file('l1', 'Funkytown.pdf'), // single file, no sibling -> Extra
    },
  };
  const { tunes, extras } = buildCatalog(manifest, ['loose'], ['loose']);
  const anthrax = tunes.find((t) => t.slug === 'anthrax');
  assert.ok(anthrax, 'a new "Anthrax" song was formed from the shared prefix');
  assert.equal(anthrax.title, 'Anthrax');
  assert.equal(anthrax.parts.length + anthrax.scores.length, 3);
  assert.equal(extras.length, 1);
  assert.equal(extras[0].originalName, 'Funkytown.pdf');
});

test('matchKnownSong matches by embedded title (both prefix directions)', () => {
  const known = [
    { slug: 'baile-inolvidable', title: 'BAILE INOLVIDABLE', tokens: ['baile', 'inolvidable'] },
    { slug: 'bad-guy', title: 'Bad Guy', tokens: ['bad', 'guy'] },
    { slug: 'hot-to-go', title: 'Hot to Go', tokens: ['hot', 'to', 'go'] },
  ].sort((a, b) => b.tokens.length - a.tokens.length);
  assert.equal(matchKnownSong('Bad_Guy_Sound_Machine-Euphonium.mp3', known)?.title, 'Bad Guy'); // song ⊆ file
  assert.equal(matchKnownSong('Hot to Go! - Trumpet 1.pdf', known)?.title, 'Hot to Go');
  assert.equal(matchKnownSong('Baile.mp3', known)?.title, 'BAILE INOLVIDABLE'); // file ⊆ song
  assert.equal(matchKnownSong('Copy of Bad Guy - Tuba.pdf', known)?.title, 'Bad Guy'); // "Copy of" stripped
  assert.equal(matchKnownSong('Funkytown.pdf', known), null); // unknown song
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

test('images bucket inline, docx/zip bucket as downloads; a song-less file goes to Extra Files', () => {
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
        // No song folder and no song embedded in the name -> Extra Files.
        status: 'synced', sha256: 'z1', assetType: 'archive',
        sourceFolderLabel: 'primary', originalName: 'Stage Plot.zip',
      },
    },
  };
  const { tunes, extras } = buildCatalog(manifest, ['primary']);

  const bad = tunes.find((t) => t.slug === 'bad-guy');
  assert.equal(bad.images.length, 1);
  assert.equal(bad.images[0].originalName, 'cover.jpg');
  assert.equal(bad.images[0].assetType, 'image');
  assert.equal(bad.files.length, 1); // the docx
  assert.equal(bad.files[0].assetType, 'doc');

  assert.ok(!tunes.some((t) => t.slug === 'misc'), 'no "Misc" song');
  assert.equal(extras.length, 1);
  assert.equal(extras[0].originalName, 'Stage Plot.zip');
  assert.equal(extras[0].assetType, 'archive');
});
