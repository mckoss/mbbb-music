import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCatalog, partDownloadName, descriptorOf, matchIdentifiers, matchKnownSong, songPrefixOf, sourcePriority, canonicalByContent } from '../src/sync/catalog.js';

test('canonical pick: a real song folder beats an index folder even from a higher-priority source', () => {
  const manifest = {
    files: {
      idx: { driveFileId: 'i', sha256: 'x', status: 'synced', assetType: 'pdf', sourceFolderLabel: 'high', originalFolder: '50 Indexed By Instrument (INCOMPLETE)', originalName: 'Copy of Trumpet Song.pdf' },
      real: { driveFileId: 'r', sha256: 'x', status: 'synced', assetType: 'pdf', sourceFolderLabel: 'low', originalFolder: 'Song', originalName: 'Trumpet Song.pdf' },
    },
  };
  const pri = sourcePriority(['high', 'low'], manifest); // 'high' outranks 'low'
  const { canonical } = canonicalByContent(manifest, pri);
  assert.equal(canonical.get('x').driveFileId, 'r'); // real-folder copy is primary, not the index copy
});

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

test('unreachable shortcuts surface on the tune (with a Drive link) but are not live parts', () => {
  const manifest = {
    files: {
      // A reachable euphonium part (the principal copy).
      ok: {
        status: 'synced', sha256: 'e1', assetType: 'pdf',
        songTitle: 'Iron Man', songTitleSlug: 'iron-man',
        instrument: 'Euphonium', instrumentSlug: 'euphonium',
        sourceFolderLabel: 'primary', originalFolder: 'Iron Man',
        originalName: 'Iron Man - Euphonium.pdf',
      },
      // An older euphonium copy that exists only as an unreadable shortcut.
      un: {
        status: 'unreachable', assetType: 'pdf',
        songTitle: 'Iron Man', songTitleSlug: 'iron-man',
        instrument: 'Euphonium', instrumentSlug: 'euphonium',
        sourceFolderLabel: 'secondary', originalFolder: 'Iron Man',
        originalName: 'Iron Man-V1.0-Euphonium.pdf', shortcutTarget: 'tgt-123',
      },
    },
  };
  const { tunes, liveCount } = buildCatalog(manifest, ['primary', 'secondary']);
  assert.equal(liveCount, 1, 'the unreachable entry is not counted as live');

  const iron = tunes.find((t) => t.slug === 'iron-man');
  assert.equal(iron.parts.length, 1, 'only the reachable part is a real part');
  assert.equal(iron.unreachable.length, 1);
  const u = iron.unreachable[0];
  assert.equal(u.instrumentSlug, 'euphonium');
  assert.equal(u.source, 'secondary');
  assert.equal(u.unreachable, true);
  assert.equal(u.driveUrl, 'https://drive.google.com/file/d/tgt-123/view');
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
  // Instrument-prefix pattern: a leading instrument/key run is skipped to reach
  // the song that follows.
  assert.equal(songPrefixOf('Trumpet Medicated Chicken Water.pdf'), 'medicated-chicken-water');
  assert.equal(songPrefixOf('F Horn Medicated Chicken Water.pdf'), 'medicated-chicken-water');
  // A format/section word at the start is NOT skipped, so there's no song prefix.
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

test('version copies of one instrument exercise are not a song, but go to Extras (#7)', () => {
  // Two versions of one trumpet exercise share the prefix "blues-scales" but are
  // a single voice — they must not be promoted to a phantom song.
  const file = (sha, name) => ({
    status: 'synced', sha256: sha, assetType: 'pdf', sourceFolderLabel: 'loose',
    originalName: name, instrumentSlug: 'trumpet', instrument: 'Trumpet',
  });
  const manifest = {
    files: {
      a: file('s1', 'Trumpet_Blues_Scales_Full.pdf'),
      b: file('s2', 'Trumpet_Blues_Scales_Full-v3.pdf'),
    },
  };
  const { tunes, extras } = buildCatalog(manifest, ['loose'], ['loose']);
  assert.ok(!tunes.some((t) => t.slug === 'blues-scales'), 'no phantom "Blues Scales" song');
  assert.deepEqual(
    extras.map((e) => e.originalName).sort(),
    ['Trumpet_Blues_Scales_Full-v3.pdf', 'Trumpet_Blues_Scales_Full.pdf'],
    'both version copies fall to Extras',
  );
});

test('full-band mix is the default recording, ahead of isolated parts (#4)', () => {
  const mp3 = (sha, name, instrumentSlug) => ({
    status: 'synced', sha256: sha, assetType: 'mp3', sourceFolderLabel: 'primary',
    originalFolder: 'Bad Guy', songTitle: 'Bad Guy', songTitleSlug: 'bad-guy',
    originalName: name, ...(instrumentSlug ? { instrumentSlug } : {}),
  });
  const manifest = {
    files: {
      // Isolated parts listed first, to prove ordering (not input order) decides.
      d: mp3('d1', 'Bad_Guy-Drumset.mp3', 'drums'),    // detected instrument
      g: mp3('g1', 'Bad_Guy-Glockenspiel.mp3'),        // unclassified -> suffix rule
      f: mp3('f1', 'Bad_Guy.mp3'),                     // the full-band mix
    },
  };
  const { tunes } = buildCatalog(manifest, ['primary']);
  const bad = tunes.find((t) => t.slug === 'bad-guy');
  assert.equal(bad.audio.length, 3);
  assert.equal(bad.audio[0].originalName, 'Bad_Guy.mp3', 'full-band mix is the default');
});

test('audio defaults to the newest version of the full-band mix (#4)', () => {
  const mp3 = (sha, name, mtime, instrumentSlug) => ({
    status: 'synced', sha256: sha, assetType: 'mp3', sourceFolderLabel: 'primary',
    originalFolder: 'Iron Man', songTitle: 'Iron Man', songTitleSlug: 'iron-man',
    originalName: name, modifiedTime: mtime, ...(instrumentSlug ? { instrumentSlug } : {}),
  });
  const manifest = {
    files: {
      a: mp3('a1', 'Iron Man-V1.0.mp3', '2025-08-04T00:00:00Z'),       // older full mix
      b: mp3('b1', 'Iron Man-V1.2.mp3', '2026-04-21T00:00:00Z'),       // newer full mix
      d: mp3('d1', 'Iron Man-Drum_Kit.mp3', '2026-01-01T00:00:00Z', 'drums'),
    },
  };
  const { tunes } = buildCatalog(manifest, ['primary']);
  const t = tunes.find((x) => x.slug === 'iron-man');
  assert.equal(t.audio[0].originalName, 'Iron Man-V1.2.mp3', 'newest full-band version is the default');
  assert.ok(!t.audio.some((a) => a.originalName === 'Iron Man-V1.0.mp3'), 'older version copy is deduped away');
  assert.equal(t.audio.length, 2, 'newest full mix + the distinct drum stem remain');
});

test('parts carry print format, re-derive lyre part numbers, and dedupe version copies', () => {
  const p = (sha, name, mt) => ({
    status: 'synced', sha256: sha, assetType: 'pdf', sourceFolderLabel: 'loose', originalName: name,
    instrument: 'Trumpet', instrumentSlug: 'trumpet', key: 'bflat', modifiedTime: mt,
  });
  const manifest = {
    files: {
      a: p('a', 'Iron Man-V1.0-Trumpet_1.pdf', '2026-01-01T00:00:00Z'), // letter v1.0
      b: p('b', 'Iron Man-V1.2-Trumpet_1.pdf', '2026-02-01T00:00:00Z'), // letter v1.2 (newer)
      c: p('c', 'Iron Man-V1.0-Trumpet_1-Lyre.pdf', '2026-01-01T00:00:00Z'), // lyre, number hidden by suffix
      d: p('d', 'Iron Man-V1.0-Trumpet_2.pdf', '2026-01-01T00:00:00Z'), // letter part 2
    },
  };
  const { tunes } = buildCatalog(manifest, ['loose'], ['loose']);
  const tpt = tunes.find((t) => t.slug === 'iron-man').parts.filter((x) => x.instrumentSlug === 'trumpet');

  const letter1 = tpt.filter((x) => x.partNumber === 1 && x.format === 'letter');
  assert.equal(letter1.length, 1, 'version copies of the same part/format collapse to one');
  assert.equal(letter1[0].originalName, 'Iron Man-V1.2-Trumpet_1.pdf', 'keeps the newest version');
  assert.ok(tpt.some((x) => x.partNumber === 1 && x.format === 'lyre'), 'lyre part 1 keeps its number');
  assert.ok(tpt.some((x) => x.partNumber === 2 && x.format === 'letter'));
  assert.ok(!tpt.some((x) => x.partNumber == null), 'no undifferentiated unnumbered duplicates');
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
