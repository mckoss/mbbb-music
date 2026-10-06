// The .xlsx color reader behind the Gig-sheet import's Drive-export fallback.
// Builds a tiny synthetic workbook in memory (no real sheet data) shaped like
// Google's export: shared strings, fills/fonts in styles.xml, two tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';

import { unzip, readXlsxTabs, matchTab } from '../src/lib/server/xlsx.ts';

/** A minimal zip writer (deflate), enough for the reader under test. */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(comp.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

const WORKBOOK = zip({
  'xl/workbook.xml':
    '<workbook xmlns:r="r"><sheets><sheet name="Gigs &amp; Players" sheetId="1" r:id="rId3"/><sheet name="Contacts" sheetId="2" r:id="rId4"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<Relationships><Relationship Id="rId3" Target="worksheets/sheet1.xml"/><Relationship Id="rId4" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml':
    '<sst><si><t>Oct 9 Parade</t></si><si><t>Oct 24 Ball</t></si><si><r><rPr><color rgb="FFFF0000"/></rPr><t>Nov 1 Fair</t></r></si><si><t>Alex</t></si></sst>',
  'xl/styles.xml':
    '<styleSheet><fonts count="2"><font><color theme="1"/></font><font><color rgb="FFCC0000"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></fills>' +
    '<cellXfs count="4"><xf fontId="0" fillId="0"/><xf fontId="0" fillId="2"/><xf fontId="0" fillId="3"/><xf fontId="1" fillId="0"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml':
    '<worksheet><sheetData><row r="1"><c r="A1" s="0"/><c r="C1" s="1" t="s"><v>0</v></c><c r="D1" s="2" t="s"><v>1</v></c>' +
    '<c r="E1" s="0" t="s"><v>2</v></c><c r="F1" s="3" t="inlineStr"><is><t>Dec 5 &amp; more</t></is></c></row>' +
    '<row r="2"><c r="B2" t="s"><v>3</v></c><c r="C2"><v>42</v></c></row><row r="9"><c r="A9"><v>1</v></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>phone</t></is></c></row></sheetData></worksheet>',
});

test('unzip reads deflated entries', () => {
  const z = unzip(WORKBOOK);
  assert.ok(z.get('xl/workbook.xml').toString().includes('Contacts'));
  assert.throws(() => unzip(Buffer.from('not a zip at all, definitely not')), /Not a zip/);
});

test('readXlsxTabs returns top-row text and colors from fill, font or rich-text runs', () => {
  const [gigs, contacts] = readXlsxTabs(WORKBOOK, 5);
  assert.equal(gigs.name, 'Gigs & Players');
  assert.deepEqual(gigs.rows[0], ['', '', 'Oct 9 Parade', 'Oct 24 Ball', 'Nov 1 Fair', 'Dec 5 & more']);
  assert.deepEqual(gigs.colors[0], [null, null, 'red', 'green', 'red', 'red']); // fill, fill, run, font
  assert.deepEqual(gigs.rows[1], ['', 'Alex', '42']);
  assert.equal(gigs.rows.length, 2); // row 9 is past maxRows
  assert.equal(contacts.rows[0][0], 'phone');
});

test('matchTab picks by title, else by matching the CSV grid', () => {
  const tabs = readXlsxTabs(WORKBOOK);
  assert.equal(matchTab(tabs, [], 'contacts').name, 'Contacts');
  const csv = [['', '', 'Oct 9 Parade', 'Oct 24 Ball'], ['', 'Alex']];
  assert.equal(matchTab(tabs, csv).name, 'Gigs & Players');
  assert.equal(matchTab(tabs, [['nothing', 'alike']]), null);
});
