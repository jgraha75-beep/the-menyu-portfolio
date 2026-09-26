const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseCSV, parseCSVPreview } = require('./csv-import');

test('PDF export headers, BOM, wrapped cells and escaped quotes', () => {
  const records = parseCSV('\uFEFF"確認","No","チーム名","代表者名(ソロの場合はエントリー名)","メンバー","ジャンル","メモ"\r\n"","004","Team ""A""","Rep","One /\nTwo","Hip hop\nHouse","Keep, this"\r\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceNumber, '004');
  assert.equal(records[0].teamName, 'Team "A"');
  assert.equal(records[0].entryName, 'Rep');
  assert.equal(records[0].memberNames, 'One /\nTwo');
  assert.equal(records[0].genre, 'Hip hop\nHouse');
  assert.equal(records[0].notes, 'Keep, this');
});

test('Japanese solo header maps the battler independently from their crew', () => {
  const [record] = parseCSV('No,チーム名,代表者名(ソロの場合はエントリー名),地域,ジャンル\n1,001,AOI,東京,HIPHOP');
  assert.equal(record.entryName, 'AOI');
  assert.equal(record.teamName, '001');
  assert.equal(record.region, '東京');
});

test('legacy English imports still work and blank records are ignored', () => {
  const rows = parseCSV('No,Team Name,Member Names\r1,DBC,"Hiro、U-tack"\r,,\r');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].memberNames, 'Hiro、U-tack');
});

test('U15 PDF import shows solo name and retains crew in notes', () => {
  const [record] = parseCSV('No,チーム名,代表者名(ソロの場合はエントリー名)\n1,001,AOI', 'under15');
  assert.equal(record.teamName || record.entryName, 'AOI');
  assert.equal(record.notes, 'チーム名: 001');
});

test('reject unsafe imports instead of creating unnamed registrations', () => {
  for (const csv of ['No,Unknown\n1,Name', 'No,Team Name\n1,', 'No,Team Name\n1,"unfinished', 'No,Team Name\n1,Name,extra']) {
    assert.throws(() => parseCSV(csv), { code: 'INVALID_INPUT' });
  }
});

test('preview maps punctuation variants and keeps source numbers before saving', () => {
  const preview = parseCSVPreview('受付番号,チーム名,メンバー構成,ジャンル\n004,DBC,"Hiro、U-tack",HIPHOP\n, , ,\n005,Stay Funk Localz,"Miuto & Nozomi",Poppin', '2v2');
  assert.equal(preview.canImport, true);
  assert.deepEqual(preview.mapping, { sourceNumber: '受付番号', teamName: 'チーム名', memberNames: 'メンバー構成', entryName: null, genre: 'ジャンル', region: null, email: null, phone: null, dob: null, parentName: null, instagram: null, notes: null });
  assert.deepEqual(preview.records.map((record) => record.sourceNumber), ['004', '005']);
  assert.equal(preview.skippedRows, 1);
  assert.equal(preview.warnings.some((warning) => warning.code === 'blank_row'), true);
});

test('preview makes missing names blocking and missing 2v2 members explicit', () => {
  const preview = parseCSVPreview('No,Team Name,Member Names\n1,DBC,""\n2,,Hiro、U-tack', '2v2');
  assert.equal(preview.canImport, false);
  assert.equal(preview.errors.some((error) => error.code === 'missing_name'), true);
  assert.equal(preview.warnings.some((warning) => warning.code === 'missing_members'), true);
  assert.equal(preview.records[0].needsReview, true);
});
