const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { parsePDFPreview } = require("./pdf-import");

test("PDF preview rejects non-PDF input without throwing", async () => {
  const preview = await parsePDFPreview(Buffer.from("not a pdf"), "2v2");
  assert.equal(preview.canImport, false);
  assert.equal(preview.sourceType, "pdf");
  assert.equal(preview.errors[0].code, "invalid_pdf");
});

const fixtures = [
  [process.env.MENYU_PDF_FIXTURE_2V2, "2v2", 46],
  [process.env.MENYU_PDF_FIXTURE_UNDER15, "under15", 16],
].filter(([file]) => file);
for (const [file, division, expectedCount] of fixtures) {
  if (!fs.existsSync(file)) continue;
  test(`provided Enter The Stage PDF maps ${division} entries`, async () => {
    const preview = await parsePDFPreview(fs.readFileSync(file), division);
    assert.equal(preview.canImport, true);
    assert.equal(preview.recordCount, expectedCount);
    assert.equal(preview.records[0].sourceNumber, "1");
    assert.equal(preview.records.at(-1).sourceNumber, String(expectedCount));
  });
}
