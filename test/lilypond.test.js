import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { matchClose, topLevelBlocks, musicVariables, staves, parseConverted, midiTempo } from '../src/lilypond/lyparse.js';
import { keyNone, layoutBreaks, drumify, drumStaff, nameMarkup, setInstrumentName, drumFamily, drumNamer, GM_DRUM_NAMES } from '../src/lilypond/fixups.js';
import { readParts, readTitle } from '../src/lilypond/musicxml.js';
import { planSong, partSlug, fullScoreLy, partLy, midiLy, scoreStaffSize } from '../src/lilypond/generate.js';
import { parseMidi, compareMidi } from '../src/lilypond/midi.js';
import { lilypondEntries, outputType, LILYPOND_SOURCE } from '../src/lilypond/catalog-entries.js';
import { buildCatalog } from '../src/sync/catalog.js';
import { majorVersion } from '../src/scores/musescore.js';

// A synthetic musicxml2ly-shaped conversion: one trumpet and one snare drum on
// a one-line (Rhythmic) staff, with the quirks the fixups exist for.
const CONVERTED = String.raw`\version "2.24.3"
\include "articulate.ly"
otherdynamics = #(make-dynamic-script "other-dynamics")
\header {
    title =  "Untitled score"
    composer =  "A. Arranger"
    }
#(set-global-staff-size 10.5)
\paper { paper-width = 21.59\cm }
PartPOneVoiceOne =  {
    \clef "treble" \time 4/4 \key d \major | % 1
    d''4 ^"Peppy!" e''4 fis''2 \pageBreak | % 2
    R1*3 | % 5
    }

PartPTwoVoiceOne =  {
    \clef "percussion" \time 4/4 \key c \none | % 1
    c''8 c''8 r4 f'4 c''4 | % 2
    R1*3 | % 5
    }


% The score definition
\score {
    <<
        \new Staff
        <<
            \set Staff.instrumentName = "Trumpet in B"
            \set Staff.midiInstrument = "trumpet"
            \context Staff <<
                \context Voice = "PartPOneVoiceOne" {  \PartPOneVoiceOne }
                >>
            >>
        \new RhythmicStaff
        <<
            \set RhythmicStaff.instrumentName = "Snare Drum"
            \context RhythmicStaff <<
                \context Voice = "PartPTwoVoiceOne" {  \PartPTwoVoiceOne }
                >>
            >>
        >>
    \layout {}
    }
\score {
    \unfoldRepeats \articulate {
    << \new Staff << \context Voice = "PartPOneVoiceOne" { \PartPOneVoiceOne } >> >>
    }
    \midi {\tempo 4 = 120 }
    }
`;

const PARTS = [
  { id: 'P1', name: 'Trumpet in Bb', unpitched: false, drumMap: {}, staffLines: null },
  { id: 'P2', name: 'Snare Drum', unpitched: true, drumMap: { c5: 38, f4: 37 }, staffLines: 1 },
];

test('matchClose skips strings and comments', () => {
  const t = '{ "}" % }\n { a } }';
  assert.equal(matchClose(t, 0, '{', '}'), t.length);
  assert.equal(matchClose('<< a << b >> >>', 0, '<<', '>>'), 15);
  assert.equal(matchClose('{ unbalanced', 0, '{', '}'), -1);
});

test('parseConverted finds variables, the layout score, staves and tempo', () => {
  const p = parseConverted(CONVERTED);
  assert.deepEqual([...p.variables.keys()], ['PartPOneVoiceOne', 'PartPTwoVoiceOne']);
  assert.equal(topLevelBlocks(CONVERTED, 'score').length, 2);
  assert.equal(p.staves.length, 2);
  assert.deepEqual(p.staves.map((s) => s.kind), ['Staff', 'RhythmicStaff']);
  assert.deepEqual(p.staves[1].voices, ['PartPTwoVoiceOne']);
  assert.equal(p.staves[0].name, 'Trumpet in B');
  assert.equal(p.tempo, '\\tempo 4 = 120');
  assert.equal(midiTempo('\\midi { }'), null);
  assert.equal(musicVariables('X = \\relative c\' { a b }').size, 1);
  assert.equal(staves('<< \\new Staff \\with { a = 1 } << x >> >>').length, 1);
});

test('fixups: key none and layout breaks are removed', () => {
  assert.equal(keyNone('\\clef "percussion" \\key c \\none | x'), '\\clef "percussion"  | x');
  assert.equal(layoutBreaks('a \\pageBreak b \\break c \\noBreak'), 'a  b  c ');
});

test('drumify maps staff positions to drum names in drummode', () => {
  const out = drumify('V =  {\n  \\clef "percussion" \\key c \\major c\'\'8 <c\'\' f\'>4 r4 ^"Hey" \\markup { e } }', { c5: 38, f4: 36 });
  assert.match(out, /^V = \\drummode \{/);
  assert.match(out, /acousticsnare8 <acousticsnare bassdrum>4 r4/);
  assert.match(out, /\^"Hey" \\markup \{ e \}/, 'strings and markup untouched');
  assert.doesNotMatch(out, /\\key/);
  // An unmapped position falls back to a snare.
  assert.match(drumify('V = { g\'4 }', {}), /acousticsnare4/);
});

test('drum families override non-GM marching-percussion numbers', () => {
  assert.equal(drumFamily('Marching Tenor Drums'), 'tenor');
  assert.equal(drumFamily('Snare Drum'), 'snare');
  assert.equal(drumFamily('Bass Drums'), 'bass');
  assert.equal(drumFamily('Cymbals'), 'cymbal');
  assert.equal(drumFamily('Drum Kit'), 'kit');
  assert.equal(drumNamer({ b4: 96 }, 'snare')('b4'), 'acousticsnare');
  assert.equal(drumNamer({ c5: 1, a4: 2, f4: 3 }, 'tenor')('c5'), 'hightom');
  assert.equal(drumNamer({ c5: 1, a4: 2, f4: 3 }, 'tenor')('f4'), 'lowmidtom');
  assert.equal(drumNamer({ e4: 35 }, 'kit')('e4'), GM_DRUM_NAMES[35]);
});

test('drumStaff turns a rhythmic staff into a one-line drum staff', () => {
  const s = drumStaff('\\new RhythmicStaff << \\set RhythmicStaff.instrumentName = "SD" \\context RhythmicStaff << \\context Voice = "V" { \\V } >> >>', { oneLine: true });
  assert.match(s, /^\\new DrumStaff \\with \{ \\override StaffSymbol\.line-count = #1 drumStyleTable = #percussion-style \}/);
  assert.match(s, /\\context DrumStaff/);
  assert.match(s, /\\context DrumVoice/);
  assert.match(s, /DrumStaff\.instrumentName/);
});

test('names print real accidentals', () => {
  assert.equal(nameMarkup('Alto Sax 1'), '"Alto Sax 1"');
  assert.equal(nameMarkup('Clarinet in Bb 2'), '\\markup { \\concat { "Clarinet in B" \\smaller \\flat " 2" } }');
  assert.match(setInstrumentName('\\set Staff.instrumentName = "Trumpet in B"', 'Trumpet in Bb'), /\\flat/);
});

test('readParts reads names, drum maps and one-line staves from MusicXML', () => {
  const xml = `<score-partwise><work><work-title>Untitled score</work-title></work><part-list>
    <score-part id="P1"><part-name>Trumpet in B&#9837;</part-name></score-part>
    <score-part id="P2"><part-name>Snare</part-name><score-instrument id="P2-I1"/>
      <midi-instrument id="P2-I1"><midi-unpitched>39</midi-unpitched></midi-instrument></score-part>
  </part-list>
  <part id="P1"><measure><note><pitch><step>D</step><octave>5</octave></pitch></note></measure></part>
  <part id="P2"><measure><attributes><staff-details><staff-lines>1</staff-lines></staff-details></attributes>
    <note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><instrument id="P2-I1"/></note>
  </measure></part></score-partwise>`;
  const parts = readParts(xml);
  assert.equal(parts[0].name, 'Trumpet in B♭');
  assert.equal(parts[0].unpitched, false);
  assert.deepEqual(parts[1].drumMap, { c5: 38 });
  assert.equal(parts[1].staffLines, 1);
  assert.equal(readTitle(xml), null, 'MuseScore placeholder title is ignored');
  assert.equal(readTitle('<work-title>Synthetic Song</work-title>'), 'Synthetic Song');
});

test('partSlug matches the catalog part naming', () => {
  assert.equal(partSlug('Trumpet in Bb 2', 0), 'trumpet-bflat-part2');
  assert.equal(partSlug('Snare Drum', 3), 'drums-snare');
  assert.equal(partSlug('Accordion', 4), 'accordion');
});

test('planSong applies the fixups and plans every part', () => {
  const src = planSong(CONVERTED, PARTS);
  assert.deepEqual(src.parts.map((p) => p.slug), ['trumpet-bflat', 'drums-snare']);
  assert.deepEqual(src.parts.map((p) => p.drums), [false, true]);
  assert.match(src.music, /PartPTwoVoiceOne = \\drummode/);
  assert.doesNotMatch(src.music, /\\pageBreak|\\key c \\none/);
  assert.match(src.parts[0].staff, /\\flat/, 'MusicXML name restores the flat');
  assert.equal(src.header.composer, 'A. Arranger');
  assert.equal(src.header.title, undefined, 'title comes from the catalog');

  const score = fullScoreLy(src, 'Song "Title"');
  assert.match(score, /title = "Song \\"Title\\""/);
  assert.match(score, /\\new DrumStaff/);
  const lyre = partLy(src, src.parts[0], 'Song', 'lyre');
  assert.match(lyre, /bottom-margin = 5\.75\\in/);
  assert.match(lyre, /\\compressMMRests/);
  assert.match(midiLy(src), /\\articulate \\unfoldRepeats/);
  assert.match(midiLy(src), /midiChannelMapping = #'instrument/);
  assert.equal(scoreStaffSize(2), 18);
  assert.equal(scoreStaffSize(20), 11);
});

/** A tiny type-1 MIDI file: one track per entry of [channel, [[beat, note], …]]. */
function midiFile(tracks, tpb = 96) {
  const bytes = [];
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const vlq = (n) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  bytes.push(...[0x4d, 0x54, 0x68, 0x64], ...u32(6), 0, 1, 0, tracks.length, (tpb >> 8) & 255, tpb & 255);
  for (const [ch, notes, name] of tracks) {
    const ev = [];
    const nameBytes = [...Buffer.from(name ?? '')];
    // A bogus delta on the name event, as LilyPond writes — must be ignored.
    ev.push(...vlq(5000), 0xff, 0x03, nameBytes.length, ...nameBytes);
    let t = 0;
    for (const [beat, note] of notes) {
      const tick = Math.round(beat * tpb);
      ev.push(...vlq(tick - t), 0x90 | ch, note, 80, 0, 0x80 | ch, note, 0);
      t = tick;
    }
    ev.push(0, 0xff, 0x2f, 0);
    bytes.push(0x4d, 0x54, 0x72, 0x6b, ...u32(ev.length), ...ev);
  }
  return new Uint8Array(bytes);
}

test('parseMidi and compareMidi score parts and drums', () => {
  const ref = parseMidi(midiFile([[0, [[0, 60], [1, 62], [2, 64]], 'Trumpet ♭'], [9, [[0, 38], [1, 38]], 'Snare']]));
  assert.equal(ref.tracks[0].name, 'Trumpet ♭');
  assert.equal(ref.tracks[0].notes[1].beat, 1, 'name-event delta does not shift time');
  const same = parseMidi(midiFile([[3, [[0, 60], [1, 62], [2, 64]]], [9, [[0, 42], [1, 42]]]], 384));
  const checks = compareMidi(ref, same);
  assert.deepEqual(checks.map((c) => c.match), [1, 1], 'drums compare timing only');
  const off = parseMidi(midiFile([[0, [[0, 60], [1, 61], [2, 64]]]]));
  assert.ok(compareMidi(ref, off)[0].match < 0.7);
});

test('lilypondEntries pins outputs to their song as a lilypond source', () => {
  const files = lilypondEntries({
    songs: { 'my-song': { title: 'My Song', builtAt: '2026-11-26T00:00:00Z', outputs: [{ sha256: 'aa', name: 'my-song-trumpet-bflat-letter.pdf' }, { sha256: 'bb', name: 'my-song.ly' }] } },
  });
  const e = files['lilypond:my-song:my-song-trumpet-bflat-letter.pdf'];
  assert.equal(e.sourceFolderLabel, LILYPOND_SOURCE);
  assert.equal(e.songTitleSlug, 'my-song');
  assert.equal(e.songAssigned, true);
  assert.equal(files['lilypond:my-song:my-song.ly'].assetType, 'file');
  assert.equal(outputType('x.mp3').assetType, 'mp3');
});

test('buildCatalog: a LilyPond build supersedes MuseScore-built and manual output', () => {
  const base = { status: 'synced', songTitle: 'Song', songTitleSlug: 'song' };
  const manifest = {
    files: {
      m1: { ...base, driveFileId: 'm1', sha256: 'm1', assetType: 'musescore', originalName: 'song.mscz', sourceFolderLabel: 'scores', originalFolder: 'Song' },
      p1: { ...base, driveFileId: 'p1', sha256: 'p1', assetType: 'pdf', originalName: 'Song-Trumpet.pdf', sourceFolderLabel: 'scores', originalFolder: 'Song' },
      g1: { ...base, driveFileId: 'g1', sha256: 'g1', assetType: 'pdf', originalName: 'song-trumpet-bflat-letter.pdf', sourceFolderLabel: 'generated', originalFolder: 'Song' },
      g2: { ...base, driveFileId: 'g2', sha256: 'g2', assetType: 'mp3', originalName: 'song-band.mp3', sourceFolderLabel: 'generated', originalFolder: 'Song' },
      ...lilypondEntries({ songs: { song: { title: 'Song', outputs: [{ sha256: 'l1', name: 'song-trumpet-bflat-letter.pdf' }, { sha256: 'l2', name: 'song-band.mp3' }] } } }),
    },
  };
  const cat = buildCatalog(manifest, ['scores', 'generated', LILYPOND_SOURCE], [], ['generated'], [LILYPOND_SOURCE]);
  const song = cat.tunes.find((t) => t.slug === 'song');
  assert.deepEqual(song.parts.map((p) => p.sha256), ['l1']);
  assert.deepEqual(song.audio.map((a) => [a.sha256, a.lilypond]), [['l2', true]]);
  assert.deepEqual(song.masked.map((m) => m.sha256).sort(), ['g1', 'g2', 'p1']);
  assert.equal(song.musescore.length, 1, 'the master stays');

  // Without a LilyPond build the MuseScore-built set is still offered.
  const plain = buildCatalog({ files: { m1: manifest.files.m1, p1: manifest.files.p1, g1: manifest.files.g1 } }, ['scores', 'generated'], [], ['generated'], [LILYPOND_SOURCE]);
  assert.deepEqual(plain.tunes[0].parts.map((p) => p.sha256), ['g1']);
});

test('majorVersion ignores AppImage launcher noise', () => {
  assert.equal(majorVersion('/lib/libpipewire-0.3.so.0\nMuseScore4 4.7.7'), 4);
  assert.equal(majorVersion('4.5.2'), 4);
  assert.equal(majorVersion('nothing here'), null);
});

// End-to-end through the real tools, only where LilyPond is installed (the
// Railway image and the cloud dev container; CI skips it).
const hasLilypond = (() => {
  try {
    execFileSync('lilypond', ['--version'], { stdio: 'ignore' });
    execFileSync('musicxml2ly', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('synthetic MusicXML compiles to parts and MIDI with LilyPond', { skip: !hasLilypond && 'LilyPond not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbbb-ly-test-'));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><part-list>
  <score-part id="P1"><part-name>Trumpet in Bb</part-name><score-instrument id="P1-I1"><instrument-name>Trumpet</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>57</midi-program></midi-instrument></score-part>
  <score-part id="P2"><part-name>Snare Drum</part-name><score-instrument id="P2-I1"><instrument-name>Snare</instrument-name></score-instrument><midi-instrument id="P2-I1"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument></score-part>
</part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>
  <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
  <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note></measure>
<measure number="2"><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef><staff-details><staff-lines>1</staff-lines></staff-details></attributes>
  <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><instrument id="P2-I1"/><type>quarter</type></note>
  <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><instrument id="P2-I1"/><type>quarter</type></note>
  <note><rest/><duration>2</duration><type>half</type></note></measure>
<measure number="2"><note><rest measure="yes"/><duration>4</duration></note></measure></part>
</score-partwise>`;
  writeFileSync(join(dir, 's.musicxml'), xml);
  execFileSync('musicxml2ly', ['--absolute', '--midi', '-o', join(dir, 'c.ly'), join(dir, 's.musicxml')], { stdio: 'ignore' });
  const src = planSong(readFileSync(join(dir, 'c.ly'), 'utf8'), readParts(xml));
  assert.equal(src.parts.length, 2);
  writeFileSync(join(dir, 'snare.ly'), partLy(src, src.parts[1], 'Test', 'lyre'));
  writeFileSync(join(dir, 'band.ly'), midiLy(src));
  execFileSync('lilypond', ['-o', 'snare', 'snare.ly'], { cwd: dir, stdio: 'ignore' });
  execFileSync('lilypond', ['-o', 'band', 'band.ly'], { cwd: dir, stdio: 'ignore' });
  assert.ok(existsSync(join(dir, 'snare.pdf')));
  const midi = parseMidi(readFileSync(join(dir, 'band.midi')));
  const drums = midi.tracks.find((t) => t.notes.every((n) => n.channel === 9));
  assert.ok(drums && drums.notes.length === 2, 'the snare plays on the drum channel');
  assert.ok(midi.tracks.some((t) => t.notes.some((n) => n.note === 70)), 'trumpet sounds concert B♭ for written C');
});

test('readSwing and midiLy apply the score swing to audio', async () => {
  const { readSwing } = await import('../src/lilypond/musicxml.js');
  const xml = '<sound><swing><first>5</first><second>3</second><swing-type>eighth</swing-type></swing></sound>';
  assert.deepEqual(readSwing(xml), { first: 5, second: 3, unit: 8 });
  assert.equal(readSwing('<swing><straight/></swing>'), null);
  const src = { ...planSong(CONVERTED, PARTS), swing: readSwing(xml) };
  assert.match(midiLy(src), /\\include "swing\.ly"/);
  assert.match(midiLy(src), /\\articulate \\applySwing 8 #'\(5 3\) \\unfoldRepeats/);
  assert.doesNotMatch(midiLy(planSong(CONVERTED, PARTS)), /applySwing/);
});

test('compareMidi tolerates small onset differences such as swing ratios', () => {
  const ref = parseMidi(midiFile([[0, [[0, 60], [0.604, 62], [1, 64], [1.604, 65]]]]));
  const swung = parseMidi(midiFile([[0, [[0, 60], [0.625, 62], [1, 64], [1.625, 65]]]]));
  const straight = parseMidi(midiFile([[0, [[0, 60], [0.5, 62], [1, 64], [1.5, 65]]]]));
  assert.equal(compareMidi(ref, swung)[0].match, 1);
  assert.equal(compareMidi(ref, straight)[0].match, 0.5);
});

test('mergeRests joins whole-bar rests split at page breaks, but not across marks', async () => {
  const { mergeRests } = await import('../src/lilypond/fixups.js');
  assert.equal(mergeRests('\\time 4/4  R1*2  | % 4\n    R1*3  | % 7\n    R1*4  | % 11\n    r2'), '\\time 4/4  R1*9  | % 11\n    r2');
  assert.equal(mergeRests('R1 | R1 | R1 |'), 'R1*3 |');
  assert.equal(mergeRests('R2. | R2. |'), 'R2.*2 |');
  assert.equal(mergeRests('R1*2 | \\mark \\default R1*3 |'), 'R1*2 | \\mark \\default R1*3 |', 'a rehearsal mark keeps rests apart');
  assert.equal(mergeRests('R1*2 | R2*2 |'), 'R1*2 | R2*2 |', 'different bar lengths stay apart');
  assert.equal(mergeRests('R1*3/4 R1*3/4'), 'R1*3/4 R1*3/4', 'scaled rests are left alone');
  const src = planSong(CONVERTED, PARTS);
  assert.match(partLy(src, src.parts[0], 'S', 'letter'), /MultiMeasureRest\.expand-limit = #1/);
});
