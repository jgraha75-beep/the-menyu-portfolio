const { PDFParse } = require('pdf-parse');
const { parseCSVPreview } = require('./csv-import');

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, '\n').trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function tableRows(result) {
  return (result.pages || []).flatMap((page) => {
    const tables = Array.isArray(page.tables) ? page.tables : [];
    return tables.reduce((largest, table) => (Array.isArray(table) && table.length > largest.length ? table : largest), []);
  });
}

async function parsePDFPreview(buffer, division, options) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString() !== '%PDF-') {
    return { canImport: false, sourceType: 'pdf', headers: [], mapping: {}, records: [], warnings: [], errors: [{ code: 'invalid_pdf', row: null, message: 'The selected file is not a readable PDF.' }], skippedRows: 0, recordCount: 0 };
  }
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getTable();
    const rows = tableRows(result);
    const headerIndex = rows.findIndex((row) => row.some((cell) => /チーム名|代表者名|team name|entry name/i.test(String(cell || ''))));
    if (headerIndex < 0) return { canImport: false, sourceType: 'pdf', headers: [], mapping: {}, records: [], warnings: [], errors: [{ code: 'missing_pdf_table', row: null, message: 'No entry-list table was found in this PDF.' }], skippedRows: 0, recordCount: 0 };
    const header = rows[headerIndex].map((cell) => String(cell ?? '').replace(/\r?\n/g, ' ').trim());
    const data = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell ?? '').trim()) && !row.some((cell) => /^(確認|No|チーム名|代表者名)/i.test(String(cell ?? '').trim())));
    const csv = [header, ...data].map((row) => row.map(csvCell).join(',')).join('\n');
    const preview = parseCSVPreview(csv, division, options);
    return { ...preview, sourceType: 'pdf', sourceRows: data.length };
  } catch (error) {
    return { canImport: false, sourceType: 'pdf', headers: [], mapping: {}, records: [], warnings: [], errors: [{ code: 'pdf_parse_failed', row: null, message: `The PDF could not be read: ${error.message}` }], skippedRows: 0, recordCount: 0 };
  } finally {
    if (parser) await parser.destroy();
  }
}

module.exports = { parsePDFPreview };
