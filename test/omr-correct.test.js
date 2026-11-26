import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import { measureToCompact, compactToMeasure, parseCompact, barLength, normalizeDivisions, ticksOf } from '../src/omr/compact.js';
import { correctPart, validatePage, pageFirstBars, pagesOf, usageCost, AI_MODEL, SYSTEM_PROMPT, RESPONSE_FORMAT } from '../src/omr/correct.js';

const roundTrip = (text, fullBar = 192) => measureToCompact(compactToMeasure('', text, { number: 1, fullBar, tiedFrom: new Set() }));

test('compact notation round-trips through MusicXML', () => {
  for (const text of [
    'T3/4 K-2 C5q Bb4e. Ab4s F4q',
    '|: [1 C5+E5+G5h rq re F#5e 1] :|',
    '3(C5e D5e E5e) 3(F5e G5e A5e) R5h'.replace('R5h', 'B5h'),
    'gD5s C5w',
    'F5qx F5qx rh',
    'C5h~ C5h',
    'R',
  ]) {
    assert.equal(roundTrip(text), text);
  }
});

test('ticks and bar lengths follow durations, dots and tuplets', () => {
  assert.equal(ticksOf('q'), 48);
  assert.equal(ticksOf('e', 1), 36);
  assert.equal(ticksOf('e', 0, { actual: 3, normal: 2 }), 16);
  assert.equal(barLength(parseCompact('3(C5e D5e E5e) rq rh'), 192), 192);
  assert.equal(barLength(parseCompact('gD5s C5w'), 192), 192, 'grace notes take no time');
  assert.equal(barLength(parseCompact('R'), 144), 144);
  assert.throws(() => parseCompact('C5z'), /Unreadable token/);
});

test('ties carry from one rebuilt bar into the next', () => {
  const tied = new Set();
  const a = compactToMeasure('', 'C5h~ C5h~', { number: 1, fullBar: 192, tiedFrom: tied });
  const b = compactToMeasure('', 'C5w', { number: 2, fullBar: 192, tiedFrom: tied });
  assert.equal((a.match(/<tie type="start"\/>/g) ?? []).length, 2);
  assert.match(b, /<tie type="stop"\/>/);
});

test('rebuilt bars keep attributes and directions, apply time changes', () => {
  const original = '<measure number="9"><attributes><divisions>48</divisions><key><fifths>3</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="90"/></direction><note><rest measure="yes"/><duration>192</duration></note></measure>';
  const m = compactToMeasure(original, 'T1/4 R', { number: 1, fullBar: 48, tiedFrom: new Set() });
  assert.match(m, /<beats>1<\/beats><beat-type>4<\/beat-type>/);
  assert.match(m, /<clef>/);
  assert.match(m, /<sound tempo="90"\/>/);
  assert.match(m, /<duration>48<\/duration>/);
});

test('normalizeDivisions rescales durations to 48 per quarter', () => {
  const [m1, m2] = normalizeDivisions([
    '<measure><attributes><divisions>8</divisions></attributes><note><duration>8</duration></note></measure>',
    '<measure><note><duration>4</duration></note></measure>',
  ]);
  assert.match(m1, /<divisions>48<\/divisions>.*<duration>48<\/duration>/);
  assert.match(m2, /<duration>24<\/duration>/);
});

test('validatePage flags bars that do not add up, allowing pickups', () => {
  const ok = validatePage(['C5q', 'C5w'], { time: [4, 4], isFirstPage: true });
  assert.deepEqual(ok.problems, [], 'a short first bar is a pickup');
  const bad = validatePage(['C5w', 'C5h', 'C5w'], { time: [4, 4], isFirstPage: false });
  assert.match(bad.problems[0], /^bar 2 adds up to 2 beats, not 4/);
  const meter = validatePage(['T3/4 C5h.', 'C5h.'], { time: [4, 4], isFirstPage: false });
  assert.deepEqual(meter.problems, []);
  assert.deepEqual(meter.timeAfter, [3, 4]);
});

test('pageFirstBars skips printed page numbers', () => {
  const pages = [
    { width: 600, height: 800, items: [{ text: '5', x: 40, y: 300 }] },
    { width: 600, height: 800, items: [{ text: '2', x: 40, y: 30 }, { text: '9', x: 40, y: 80 }] },
  ];
  assert.deepEqual(pageFirstBars(pages), [1, 9]);
});

test('usageCost prices Opus 5.5 tokens', () => {
  assert.equal(usageCost({ input_tokens: 1e6 }), 4);
  assert.equal(usageCost({ output_tokens: 1e6 }), 20);
  assert.equal(usageCost({ cache_read_input_tokens: 1e6 }), 0.2);
});

async function twoPagePdf(dir) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Part', { x: 200, y: 740, size: 14, font });
  doc.addPage([612, 792]).drawText('3', { x: 40, y: 700, size: 10, font });
  const path = join(dir, 'part.pdf');
  writeFileSync(path, await doc.save());
  return path;
}

const bar = (n, body, extra = '') => `<measure number="${n}">${extra}${body}</measure>`;
const note = (step, dur, type) => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type></note>`;

test('correctPart applies valid page answers and keeps OMR where an answer fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbbb-omr-correct-'));
  const pdfPath = await twoPagePdf(dir);
  const xml = `<score-partwise><part id="P1">
${bar(1, note('C', 4, 'whole'), '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>')}
${bar(2, note('D', 2, 'half'))}
${bar(3, note('E', 4, 'whole'), '<print new-page="yes"/>')}
${bar(4, note('F', 4, 'whole'))}
</part></score-partwise>`;
  const requests = [];
  const client = {
    beta: {
      messages: {
        stream(params) {
          requests.push(params);
          const text = params.messages[0].content.find((c) => c.type === 'text').text;
          // Page 1: fix bar 2 (OMR lost half its length). Page 2: a bad answer.
          const bars = /Page 1 of/.test(text) ? ['C5w', 'D5h D5h'] : ['E5w', 'F5h'];
          return {
            async finalMessage() {
              return { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify({ bars, notes: 'fixed bar 2' }) }] };
            },
          };
        },
      },
    },
  };
  const r = await correctPart({ xml, pdfPath, partName: 'Trumpet 1', client });
  const measures = [...r.xml.matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map((m) => m[0]);
  assert.deepEqual(measures.map(measureToCompact), ['T4/4 C5w', 'D5h D5h', 'E5w', 'F5w']);
  assert.ok(r.notes.some((n) => /page 1: fixed bar 2/.test(n)));
  assert.ok(r.notes.some((n) => /page 2: applied 1 of 2 bars/.test(n)), 'the bad bar kept its OMR reading');
  assert.equal(r.usage.calls, 2);
  assert.ok(Math.abs(r.usage.cost - 2 * (1000 * 4 + 100 * 20) / 1e6) < 1e-9);

  const p = requests[0];
  assert.equal(p.model, AI_MODEL);
  assert.deepEqual(p.output_config, { effort: 'high', format: RESPONSE_FORMAT });
  assert.equal(p.fallbacks, 'default');
  assert.equal(p.system[0].text, SYSTEM_PROMPT);
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(p.messages[0].content[0].type, 'image');
  assert.match(p.messages[0].content[1].text, /This page holds bars 1–2 \(2 bars\)/);
  assert.equal(pagesOf(measures).length, 2);
});

test('correctPart keeps the OMR reading on a refusal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mbbb-omr-correct-'));
  const pdfPath = await twoPagePdf(dir);
  const xml = `<part id="P1">${bar(1, note('C', 4, 'whole'), '<attributes><divisions>1</divisions></attributes>')}${bar(2, note('D', 4, 'whole'), '<print new-page="yes"/>')}</part>`;
  const client = { beta: { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: 'refusal', usage: {}, content: [] }) }) } } };
  const r = await correctPart({ xml, pdfPath, partName: 'Horn', client });
  assert.ok(r.notes.some((n) => /no usable answer \(refusal\)/.test(n)));
  assert.deepEqual([...r.xml.matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map((m) => measureToCompact(m[0])), ['C5w', 'D5w']);
});
