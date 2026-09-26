const { invalidInput } = require('./input-validation');

const aliases = {
  sourceNumber: ['no', 'number', 'entry number', 'entry no', 'entry no.', '番号', '元番号', '受付番号'],
  teamName: ['team name', 'team', 'crew name', 'crew', 'チーム名', 'チーム'],
  memberNames: ['member', 'members', 'member names', 'member composition', 'members name', 'メンバー', 'メンバー名', 'メンバー構成'],
  entryName: ['entry name', 'battler name', 'name of representative', 'representative name', '代表者名(ソロの場合はエントリー名)', '代表者名', 'エントリー名', 'バトルネーム'],
  genre: ['genre', 'style', 'ジャンル', 'スタイル'],
  region: ['representing/region', 'representing', 'region', '地域', '所属'],
  email: ['email', 'mail address', 'e-mail', 'メールアドレス', 'メール'],
  phone: ['telephone', 'phone', 'phone number', '電話番号', '電話'],
  dob: ['dob', 'date of birth', 'birth date', 'birthday', '生年月日', '誕生日'],
  parentName: ['parent', 'parent name', 'guardian', 'guardian name', '保護者', '保護者名'],
  instagram: ['instagram', 'instagram handle', 'ig', 'インスタグラム', 'インスタ'],
  notes: ['notes', 'memo', 'remarks', 'メモ', '備考'],
};

const fieldLabels = {
  sourceNumber: 'source entry number', teamName: 'team name', memberNames: 'member names', entryName: 'entry name',
  genre: 'genre', region: 'region', email: 'email', phone: 'phone', dob: 'date of birth', parentName: 'parent name', instagram: 'Instagram', notes: 'notes',
};

function normalizeHeader(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\?/g, '').replace(/\s+/g, ' ');
}

function compactHeader(value) {
  return normalizeHeader(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

const aliasIndex = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, names.map((name) => ({ exact: normalizeHeader(name), compact: compactHeader(name) }))]));

// Read logical CSV records, not physical lines: PDF cells can contain line breaks.
// Metadata is retained for preview warnings while csvRows keeps the old strict API.
function csvRowsWithMeta(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false, rowHasContent = false, rowNumber = 1;
  const finishCell = () => { row.push(cell.trim()); cell = ''; closed = false; };
  const finishRow = () => {
    finishCell();
    if (row.some(Boolean)) rows.push({ cells: row, rowNumber, blank: false });
    else if (rowHasContent) rows.push({ cells: row, rowNumber, blank: true });
    row = []; rowHasContent = false; rowNumber += 1;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else { cell += char; rowHasContent = true; }
    } else if (char === ',') { finishCell(); rowHasContent = true; }
    else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i += 1;
    } else if (char === '"' && !closed && !cell.trim()) { cell = ''; quoted = true; rowHasContent = true; }
    else if (char === '"' || (closed && char.trim())) throw invalidInput('Invalid CSV quoting. Check the file before importing.');
    else if (!closed) { cell += char; if (char.trim()) rowHasContent = true; }
  }
  if (quoted) throw invalidInput('CSV contains an unclosed quoted field.');
  if (row.length || cell || rowHasContent) finishRow();
  return rows;
}

function csvRows(input) {
  return csvRowsWithMeta(input).filter((row) => !row.blank).map((row) => row.cells);
}

function mapHeaders(header) {
  const normalized = header.map(normalizeHeader);
  const compact = header.map(compactHeader);
  const mapping = {};
  const warnings = [];
  for (const key of Object.keys(aliases)) {
    const matches = [];
    for (let index = 0; index < header.length; index += 1) {
      if (aliasIndex[key].some((alias) => alias.exact === normalized[index] || (alias.compact && alias.compact === compact[index]))) matches.push(index);
    }
    mapping[key] = matches[0] ?? -1;
    if (matches.length > 1) warnings.push({ code: 'ambiguous_header', row: 1, field: key, message: `Multiple columns look like ${fieldLabels[key]}; using “${header[matches[0]]}”.` });
  }
  return { normalized, mapping, warnings };
}

function previewError(code, row, message, field) {
  return { code, row, ...(field ? { field } : {}), message };
}

function parseCSVPreview(csv, division, options = {}) {
  const teamSize = options.teamSize ?? (division === '2v2' ? 2 : division === 'under15' ? 1 : null);
  let parsed;
  try { parsed = csvRowsWithMeta(csv); }
  catch (error) { return { canImport: false, headers: [], mapping: {}, records: [], warnings: [], errors: [previewError('invalid_csv', null, error.message)], skippedRows: 0, recordCount: 0 }; }
  const [headerRow, ...dataRows] = parsed;
  if (!headerRow || headerRow.blank || !headerRow.cells.length) return { canImport: false, headers: [], mapping: {}, records: [], warnings: [], errors: [previewError('missing_header', 1, 'The CSV needs a header row.')], skippedRows: 0, recordCount: 0 };
  const headers = headerRow.cells;
  const { normalized, mapping, warnings } = mapHeaders(headers);
  const errors = [];
  if (mapping.teamName < 0 && mapping.entryName < 0) errors.push(previewError('missing_name_column', 1, 'CSV needs a Team Name / チーム名 or Entry Name / エントリー名 column.'));
  const records = [];
  let skippedRows = 0;
  const hasFutureData = dataRows.map((row, index) => dataRows.slice(index + 1).some((candidate) => !candidate.blank));
  dataRows.forEach((row, index) => {
    const rowNumber = row.rowNumber || index + 2;
    if (row.blank) { skippedRows += 1; if (hasFutureData[index]) warnings.push(previewError('blank_row', rowNumber, `Blank row ${rowNumber} will be skipped.`)); return; }
    if (row.cells.length !== headers.length) { errors.push(previewError('column_count', rowNumber, `Row ${rowNumber} has ${row.cells.length} columns; expected ${headers.length}.`)); return; }
    const record = Object.fromEntries(Object.entries(mapping).map(([key, column]) => [key, column < 0 ? '' : row.cells[column]]));
    const soloHeader = normalized.some((value) => value === normalizeHeader('代表者名(ソロの場合はエントリー名)'));
    if (teamSize === 1 && soloHeader) {
      if (!record.entryName) { errors.push(previewError('missing_entry_name', rowNumber, `Row ${rowNumber} is missing the solo entry name.`, 'entryName')); return; }
      if (record.teamName) record.notes = [record.notes, `チーム名: ${record.teamName}`].filter(Boolean).join('\n');
      record.teamName = '';
    }
    if (!record.teamName && !record.entryName) { errors.push(previewError('missing_name', rowNumber, `Row ${rowNumber} is missing a team or entry name. Nothing from this row will be imported.`)); return; }
    const reviewReasons = [];
    if (teamSize !== null && teamSize > 1 && !record.memberNames) reviewReasons.push('member_names_missing');
    if (reviewReasons.length) warnings.push(previewError('missing_members', rowNumber, `Row ${rowNumber} has no member names and will need review.`, 'memberNames'));
    records.push({ ...record, sourceRow: rowNumber, needsReview: reviewReasons.length > 0, reviewReasons });
  });
  const sourceNumbers = new Map();
  records.forEach((record) => {
    if (!record.sourceNumber) return;
    const rows = sourceNumbers.get(record.sourceNumber) || [];
    rows.push(record.sourceRow); sourceNumbers.set(record.sourceNumber, rows);
  });
  for (const [sourceNumber, rows] of sourceNumbers) if (rows.length > 1) warnings.push(previewError('duplicate_source_number', rows[0], `Source entry number ${sourceNumber} appears more than once (rows ${rows.join(', ')}).`, 'sourceNumber'));
  return { canImport: errors.length === 0 && records.length > 0, headers, mapping: Object.fromEntries(Object.entries(mapping).map(([key, value]) => [key, value < 0 ? null : headers[value]])), records, warnings, errors, skippedRows, recordCount: records.length };
}

function parseCSV(csv, division, options) {
  const preview = parseCSVPreview(csv, division, options);
  if (preview.errors.length) throw invalidInput(preview.errors[0].message);
  if (!preview.records.length) return [];
  return preview.records.map(({ sourceRow, ...record }) => record);
}

module.exports = { parseCSV, parseCSVPreview };
