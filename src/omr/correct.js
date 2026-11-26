// AI correction pass for OMR drafts (PLAN.md "PDF -> Notation", the one AI
// step). For each page of a part PDF, Claude sees the page image beside what OMR
// read (compact notation, one bar per line) and returns the page's bars as
// printed. Every returned bar is checked against the time signature before it
// replaces anything; a bar that doesn't add up keeps the OMR reading and is
// reported. Admin-only, and every call's tokens and cost are recorded.

import { pdfPageText } from './pdf-text.js';
import { renderPdfPages } from './pdf-image.js';
import { normalizeDivisions, measureToCompact, compactToMeasure, parseCompact, barLength, barTicks } from './compact.js';

export const AI_MODEL = 'claude-opus-5-5';
/** USD per million tokens for AI_MODEL (cache writes at 1.25× input, reads $0.20). */
export const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
const EFFORT = 'high';

export const SYSTEM_PROMPT = `You correct optical music recognition (OMR) of one instrumental part from a brass band library, one page at a time.

You get an image of one printed page and the bars OMR read from that page, in order, in the compact notation below. OMR is usually right about pitches but makes structural and rhythm mistakes: multi-bar rests read as one bar, missed or extra bars, a whole line missed, wrong note lengths, spurious or missing ties, missing notes (especially x-noteheads for shouts), a misread time signature, missed repeat signs. Your job is to return the bars exactly as printed on the page.

Notation, one bar per string, tokens separated by spaces:
- Note: pitch then duration. Pitch is the written pitch as printed (this is a part; never transpose), with the key signature and any accidentals applied, accidentals lasting to the end of the bar: C5, F#4, Bb3 (C4 is middle C). Duration: w whole, h half, q quarter, e eighth, s 16th, t 32nd; add . or .. for dots. Example: F#5e. is a dotted eighth.
- Append ~ to a note tied to the next note. Append x for an x notehead (spoken shout): F5qx.
- Chord: pitches joined with +, one duration: C5+E5q.
- Rest: r plus duration (rq, re.). A bar that is entirely rest is R.
- Grace note: g prefix, duration usually s: gD5s.
- Tuplet: 3(C5e D5e E5e) is three eighths in the time of two; 5( and 6( mean five or six in the time of four.
- At the start of a bar: T3/4 for a time signature change, K-2 for a key signature change (number of flats negative, sharps positive). |: for a repeat start; [1 or [2 where a first or second ending starts.
- At the end of a bar: :| for a repeat end; 1] or 2] where an ending stops.

Rules:
- Return every bar on the page, in order, one string per bar. A multi-bar rest marked N becomes N separate "R" bars.
- Every bar must add up to its time signature exactly; only a pickup bar at the very start of the piece may be shorter.
- Leave out dynamics, articulations, slurs, text and rehearsal marks; keep ties, grace notes, x noteheads, tuplets, time and key changes, repeats and endings.
- When you are told how many bars the page holds, return exactly that many. The printed bar numbers decide what a bar is: when a double barline splits one numbered bar in two (common at an optional cut), join both halves into one bar.
- A bar printed shorter or longer than the time signature with no new time signature shown (an irregular bar, such as a one-beat bar at the start) gets its real meter with T, e.g. T1/4, and the next bar switches back, e.g. T4/4.
- Keep a bar's OMR reading when it is already right. In "notes", say briefly what you changed.`;

/** Output schema (structured outputs): the page's bars and a short change note. */
export const RESPONSE_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      bars: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
    },
    required: ['bars', 'notes'],
    additionalProperties: false,
  },
};

/** USD cost of one response's usage at AI_MODEL prices. */
export function usageCost(u) {
  return (
    ((u.input_tokens ?? 0) * PRICE.input +
      (u.output_tokens ?? 0) * PRICE.output +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
    1e6
  );
}

/** Split a part's measures into pages at `new-page` print marks. */
export function pagesOf(measures) {
  const pages = [];
  measures.forEach((m, i) => {
    if (i === 0 || /<print\b[^>]*new-page="yes"/.test(m)) pages.push([]);
    pages.at(-1).push(i);
  });
  return pages;
}

/**
 * The first bar number printed on each page (page 1 starts at bar 1), from
 * the measure numbers at the left margin; null where a page shows none.
 *
 * @param {import('./score.js').PageText[]} pageText
 * @returns {(number|null)[]}
 */
export function pageFirstBars(pageText) {
  let last = 1;
  return pageText.map((page, i) => {
    if (i === 0) return 1;
    const margin = page.width * 0.12;
    const nums = page.items
      .filter((it) => it.x < margin && /^\d{1,3}$/.test(it.text.trim()))
      .sort((a, b) => a.y - b.y)
      .map((it) => Number(it.text.trim()))
      .filter((n) => n > last);
    // A page number ("2") printed at the left margin isn't a bar number.
    if (nums[0] === i + 1 && nums.length > 1) nums.shift();
    if (!nums.length) return null;
    last = nums[0];
    return nums[0];
  });
}

/** The user message for one page. */
export function pageMessage({ partName, pageIndex, pageCount, firstBar, expectedCount, time, fifths, bars, png }) {
  const lines = [
    `Part: ${partName}. Page ${pageIndex + 1} of ${pageCount}.`,
    `At the start of this page the time signature is ${time[0]}/${time[1]} and the key signature is ${fifths} (fifths).`,
    expectedCount != null
      ? `This page holds bars ${firstBar}–${firstBar + expectedCount - 1} (${expectedCount} bars).`
      : `This page starts at bar ${firstBar ?? '?'}; read how many bars it holds from the image.`,
    '',
    'OMR reading of this page:',
    ...bars.map((b, i) => `${i + 1}. ${b}`),
  ];
  return [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
    { type: 'text', text: lines.join('\n') },
  ];
}

/** One model call; returns { result, usage, stop }. */
async function askModel(client, content) {
  const params = {
    model: AI_MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: RESPONSE_FORMAT },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  };
  const msg = await client.beta.messages.stream(params).finalMessage();
  if (msg.stop_reason === 'refusal') return { result: null, usage: msg.usage, stop: 'refusal' };
  if (msg.stop_reason === 'max_tokens') return { result: null, usage: msg.usage, stop: 'max_tokens' };
  const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
  try {
    return { result: JSON.parse(text), usage: msg.usage, stop: msg.stop_reason };
  } catch {
    return { result: null, usage: msg.usage, stop: 'unparseable' };
  }
}

/**
 * Check a page of returned bars. Returns the parsed bars, or the reason the
 * page can't be applied as a whole.
 */
export function validatePage(bars, { time, isFirstPage }) {
  const problems = [];
  let t = time;
  const parsed = bars.map((text, i) => {
    try {
      const bar = parseCompact(text);
      if (bar.time) t = bar.time;
      const full = barTicks(t[0], t[1]);
      const len = barLength(bar, full);
      const pickup = isFirstPage && i === 0;
      if (len !== full && !(pickup && len < full && len > 0)) problems.push(`bar ${i + 1} adds up to ${len / 48} beats, not ${full / 48}`);
      return { text, bar, full };
    } catch (err) {
      problems.push(`bar ${i + 1}: ${err.message}`);
      return null;
    }
  });
  return { parsed, problems, timeAfter: t };
}

/**
 * Correct one part's OMR MusicXML against its PDF.
 *
 * @param {object} opts
 * @param {string} opts.xml          Repaired OMR MusicXML (one part).
 * @param {string} opts.pdfPath
 * @param {string} opts.partName
 * @param {{ beta: { messages: { stream: Function } } }} opts.client  An Anthropic client.
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ xml: string, notes: string[], usage: { calls: number, inputTokens: number, outputTokens: number, cost: number } }>}
 */
export async function correctPart(opts) {
  const log = opts.log ?? (() => {});
  const notes = [];
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
  const partM = opts.xml.match(/(<part\b[^>]*>)([\s\S]*?)(<\/part>)/);
  if (!partM) return { xml: opts.xml, notes: ['AI: no part to correct.'], usage };
  const measures = normalizeDivisions([...partM[2].matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map((m) => m[0]));
  const pages = pagesOf(measures);
  const images = await renderPdfPages(opts.pdfPath);
  if (images.length !== pages.length) {
    notes.push(`AI skipped: OMR found ${pages.length} page(s) but the PDF has ${images.length}.`);
    return { xml: opts.xml, notes, usage };
  }
  const firsts = pageFirstBars(await pdfPageText(opts.pdfPath));

  // Running time signature and key through the part.
  let time = [4, 4];
  let fifths = 0;
  const out = [];
  for (const [p, idx] of pages.entries()) {
    const origBars = idx.map((i) => measures[i]);
    const expectedCount = firsts[p] != null && firsts[p + 1] != null ? firsts[p + 1] - firsts[p] : null;
    const startTime = time;
    const startFifths = fifths;
    for (const m of origBars) {
      const tm = m.match(/<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
      if (tm) time = [Number(tm[1]), Number(tm[2])];
      const k = m.match(/<fifths>(-?\d+)<\/fifths>/);
      if (k) fifths = Number(k[1]);
    }
    log(`AI: ${opts.partName}, page ${p + 1} of ${pages.length}`);
    let call;
    try {
      call = await askModel(opts.client, pageMessage({
        partName: opts.partName,
        pageIndex: p,
        pageCount: pages.length,
        firstBar: firsts[p],
        expectedCount,
        time: startTime,
        fifths: startFifths,
        bars: origBars.map(measureToCompact),
        png: images[p],
      }));
    } catch (err) {
      notes.push(`AI page ${p + 1}: request failed (${err instanceof Error ? err.message : err}); kept the OMR reading.`);
      out.push(...origBars);
      continue;
    }
    usage.calls += 1;
    usage.inputTokens += (call.usage?.input_tokens ?? 0) + (call.usage?.cache_read_input_tokens ?? 0) + (call.usage?.cache_creation_input_tokens ?? 0);
    usage.outputTokens += call.usage?.output_tokens ?? 0;
    usage.cost += usageCost(call.usage ?? {});
    if (!call.result || !Array.isArray(call.result.bars)) {
      notes.push(`AI page ${p + 1}: no usable answer (${call.stop}); kept the OMR reading.`);
      out.push(...origBars);
      continue;
    }
    const v = validatePage(call.result.bars, { time: startTime, isFirstPage: p === 0 });
    // The printed numbering can disagree with barlines by a bar or two (split or
    // uncounted bars), so a small difference is accepted when every bar checks out.
    const countOk = expectedCount == null || Math.abs(v.parsed.length - expectedCount) <= 2;
    if (expectedCount != null && countOk && v.parsed.length !== expectedCount && !v.problems.length) {
      notes.push(`AI page ${p + 1}: ${v.parsed.length} bars where the numbering suggests ${expectedCount}.`);
    }
    if (!v.problems.length && countOk) {
      // Whole page accepted (it may add or remove bars). Pair each new bar with
      // an original by position to keep its layout marks and directions.
      v.parsed.forEach((pb, i) => out.push({ original: origBars[i] ?? '', text: pb.text }));
      if (v.parsed.length !== origBars.length) notes.push(`AI page ${p + 1}: ${origBars.length} → ${v.parsed.length} bars.`);
      if (call.result.notes) notes.push(`AI page ${p + 1}: ${call.result.notes}`);
      time = v.timeAfter;
      continue;
    }
    // Otherwise apply bar by bar where the counts line up and the bar is valid.
    if (v.parsed.length === origBars.length) {
      let applied = 0;
      v.parsed.forEach((pb, i) => {
        const bad = !pb || v.problems.some((pr) => pr.startsWith(`bar ${i + 1} `) || pr.startsWith(`bar ${i + 1}:`));
        if (bad) out.push(origBars[i]);
        else {
          out.push({ original: origBars[i], text: pb.text });
          applied++;
        }
      });
      notes.push(`AI page ${p + 1}: applied ${applied} of ${origBars.length} bars; kept OMR where the answer didn't add up (${v.problems.slice(0, 3).join('; ')}).`);
    } else {
      notes.push(`AI page ${p + 1}: answer not applied (${!countOk ? `${v.parsed.length} bars, expected ${expectedCount}` : v.problems.slice(0, 3).join('; ')}).`);
      out.push(...origBars);
    }
  }

  // Rebuild: corrected bars from notation, untouched bars as they were.
  const tiedFrom = new Set();
  let t = [4, 4];
  const rebuilt = out.map((item, i) => {
    if (typeof item === 'string') {
      tiedFrom.clear();
      const tm = item.match(/<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
      if (tm) t = [Number(tm[1]), Number(tm[2])];
      return item.replace(/<measure\b[^>]*>/, `<measure number="${i + 1}">`);
    }
    const bar = parseCompact(item.text);
    if (bar.time) t = bar.time;
    else {
      const tm = item.original.match(/<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
      if (tm) t = [Number(tm[1]), Number(tm[2])];
    }
    return compactToMeasure(item.original, item.text, { number: i + 1, fullBar: barTicks(t[0], t[1]), tiedFrom });
  });
  notes.push(`AI: ${usage.calls} call${usage.calls === 1 ? '' : 's'}, $${usage.cost.toFixed(2)}.`);
  const body = `\n${rebuilt.join('\n')}\n`;
  return { xml: opts.xml.replace(partM[0], `${partM[1]}${body}${partM[3]}`), notes, usage };
}
