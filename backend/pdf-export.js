function simplePDF(title, lines, { language = "en", pageLabel = "page" } = {}) {
  const clean = (value) => String(value).replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7E]/g, "?");
  const utf16be = (value) => {
    const little = Buffer.from(String(value), "utf16le");
    for (let index = 0; index < little.length; index += 2) [little[index], little[index + 1]] = [little[index + 1], little[index]];
    return little.toString("hex").toUpperCase();
  };
  const pdfText = (value) => language === "ja" ? `<${utf16be(value)}>` : `(${clean(value)})`;
  const pages = [];
  for (let index = 0; index < Math.max(lines.length, 1); index += 48) pages.push(lines.slice(index, index + 48));
  const fontObjects = language === "ja"
    ? ["<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UTF16-H /DescendantFonts [4 0 R] >>", "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> >>"]
    : ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageStart = 3 + fontObjects.length;
  const pageObjectIds = pages.map((_, index) => pageStart + (index * 2));
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pageObjectIds.map((objectId) => `${objectId} 0 R`).join(" ")}] /Count ${pages.length} >>`, ...fontObjects];

  pages.forEach((page, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = pageObjectId + 1;
    const pageTitle = `${title}${pages.length > 1 ? ` — ${pageLabel} ${index + 1}` : ""}`;
    const text = [
      `BT /F1 16 Tf 50 760 Td ${pdfText(pageTitle)} Tj /F1 8 Tf`,
      ...page.map((line) => `0 -14 Td ${pdfText(String(line).slice(0, 180))} Tj`),
      "ET",
    ].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

module.exports = { simplePDF };
