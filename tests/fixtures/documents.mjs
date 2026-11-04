// Genuine document fixtures for the common document reader QA.
//
// Every buffer here is generated locally with real syntax: a hand-built
// 2-page PDF with a correct xref table, OOXML/ODF zip packages built with
// fflate (0.8.3, already a dependency), and plain text formats. No Word,
// no Python, no network. Markers (KNOWN) are unique per fixture so QA can
// assert actual content, never a bare non-empty render.
//
// One DOCX comes from the existing agent/staging.mjs draftToDocx writer
// (round-trip path); a second DOCX carries a real 2x2 table (structure path).
//
// Parent native isolated smoke can import these buffers directly:
//   import { PDF_BYTES, KNOWN } from './tests/fixtures/documents.mjs';
import { zipSync, strToU8 } from 'fflate';
import { draftToDocx } from '../../agent/staging.mjs';

export const KNOWN = {
  pdfPage1: 'QA PDF page one ALPHA-719',
  pdfPage2: 'QA PDF page two BETA-342',
  docxRoundtripTitle: 'QA Docx Roundtrip GAMMA-518',
  docxRoundtripBody: 'roundtrip body DELTA-904',
  docxTableTitle: 'QA DOCX Table EPSILON-227',
  docxCells: ['CELL-R1C1-11', 'CELL-R1C2-22', 'CELL-R2C1-33', 'CELL-R2C2-44'],
  odtPara: 'QA ODT paragraph ZETA-661',
  odtPara2: 'QA ODT second line ZETA-662',
  odtCells: ['ODT-CELL-A1-78', 'ODT-CELL-B1-79', 'ODT-CELL-A2-80', 'ODT-CELL-B2-81'],
  xlsxCellA1: 'QA XLSX cell THETA-813',
  xlsxHeader: 'XLSX-HEADER-910',
  xlsxCellA2: 'XLSX-A2-592',
  xlsxCellB2: 'XLSX-B2-593',
  pptxSlide1: 'QA PPTX slide one IOTA-476',
  pptxSlide2: 'QA PPTX slide two SIGMA-208',
  htmlBody: 'QA HTML body KAPPA-309',
  txtBody: 'QA TXT plain LAMBDA-402',
  mdHeading: 'QA MD heading MU-931',
  mdBody: 'QA MD body NU-712',
  csvRow1: 'CSV-ROW-155',
  csvRow2: 'CSV-ROW-256',
  jsonTitle: 'QA JSON OMEGA-671',
  csvBigFirst: 'CSV-BIG-FIRST-441',
  csvBigEvil: 'CSV-BIG-EVIL-443',
  csvBigLast: 'CSV-BIG-LAST-449',
  mdBigHeading: 'MD-BIG-HEADING-553',
  mdBigFirst: 'MD-BIG-ITEM-554',
  mdBigBold: 'MD-BIG-BOLD-555',
  htmlBigFirst: 'HTML-BIG-FIRST-665',
  htmlBigCell: 'HTML-BIG-CELL-666',
  docxBigTitle: 'DOCX-BIG-TITLE-771',
  docxBigList: 'DOCX-BIG-LIST-772',
  docxBigCell: 'DOCX-BIG-CELL-773',
  xlsxBigFirst: 'XLSX-BIG-FIRST-881',
  xlsxBigLast: 'XLSX-BIG-LAST-882',
};

export const FILENAMES = {
  pdf: 'qa-two-page.pdf',
  docxRoundtrip: 'qa-roundtrip.docx',
  docxTable: 'qa-table.docx',
  odt: 'qa-para-table.odt',
  xlsx: 'qa-cells.xlsx',
  pptx: 'qa-deck.pptx',
  html: 'qa-malice.html',
  txt: 'qa-note.txt',
  md: 'qa-note.md',
  csv: 'qa-grid.csv',
  json: 'qa-data.json',
  csvBound: 'qa-big.csv',
  mdBound: 'qa-big.md',
  htmlBound: 'qa-big.html',
  docxBound: 'qa-big.docx',
  xlsxBound: 'qa-big.xlsx',
  malformed: 'truncated.pdf',
  unsupported: 'mystery.wxyz',
};

export const MIMES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

/* ---- minimal valid 2-page PDF (Helvetica, correct xref offsets) ---- */
function pdfEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildTwoPagePdf(text1, text2) {
  const stream1 = `BT /F1 20 Tf 72 720 Td (${pdfEscape(text1)}) Tj ET`;
  const stream2 = `BT /F1 20 Tf 72 720 Td (${pdfEscape(text2)}) Tj ET`;
  const objs = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n';
  objs[3] = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n';
  objs[4] = `4 0 obj\n<< /Length ${Buffer.byteLength(stream1, 'utf8')} >>\nstream\n${stream1}\nendstream\nendobj\n`;
  objs[5] = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  objs[6] = '6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj\n';
  objs[7] = `7 0 obj\n<< /Length ${Buffer.byteLength(stream2, 'utf8')} >>\nstream\n${stream2}\nendstream\nendobj\n`;
  const header = '%PDF-1.4\n';
  const offsets = [0];
  let body = header;
  for (let i = 1; i <= 7; i++) {
    offsets[i] = Buffer.byteLength(body, 'utf8');
    body += objs[i];
  }
  const xrefAt = Buffer.byteLength(body, 'utf8');
  let xref = 'xref\n0 8\n0000000000 65535 f \n';
  for (let i = 1; i <= 7; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  const trailer = `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body + xref + trailer, 'utf8');
}

export const PDF_BYTES = buildTwoPagePdf(KNOWN.pdfPage1, KNOWN.pdfPage2);

/* ---- zip helper (fflate) ---- */
function zipFiles(entries, opts) {
  const data = {};
  for (const [name, content] of entries) {
    data[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return Buffer.from(zipSync(data, opts));
}

/* ---- DOCX round-trip via the existing staging writer ---- */
const ROUNDTRIP_DRAFT = {
  title: KNOWN.docxRoundtripTitle,
  sections: [
    { heading: KNOWN.docxRoundtripTitle, body: KNOWN.docxRoundtripBody },
    { heading: 'Second point', body: 'Roundtrip second body stays on the DELTA side.' },
  ],
};
export const DOCX_ROUNDTRIP_BYTES = draftToDocx(ROUNDTRIP_DRAFT);

/* ---- DOCX with a real 2x2 table (structure path) ---- */
const DOCX_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const DOCX_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const DOCX_TABLE_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
  + `<w:p><w:r><w:t>${KNOWN.docxTableTitle}</w:t></w:r></w:p>`
  + `<w:p><w:r><w:t>Second paragraph before the grid.</w:t></w:r></w:p>`
  + `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>`
  + `<w:tr><w:tc><w:p><w:r><w:t>${KNOWN.docxCells[0]}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${KNOWN.docxCells[1]}</w:t></w:r></w:p></w:tc></w:tr>`
  + `<w:tr><w:tc><w:p><w:r><w:t>${KNOWN.docxCells[2]}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${KNOWN.docxCells[3]}</w:t></w:r></w:p></w:tc></w:tr>`
  + `</w:tbl><w:p><w:r><w:t>Closing line after the grid.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;

export const DOCX_TABLE_BYTES = zipFiles([
  ['[Content_Types].xml', DOCX_TYPES],
  ['_rels/.rels', DOCX_RELS],
  ['word/document.xml', DOCX_TABLE_DOCUMENT],
]);

/* ---- ODT: paragraphs + 2x2 table (mimetype first, stored) ---- */
const ODT_MANIFEST = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>';
const ODT_CONTENT = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2"><office:body><office:text>`
  + `<text:p>${KNOWN.odtPara}</text:p>`
  + `<text:p>${KNOWN.odtPara2}</text:p>`
  + `<table:table table:name="QATable">`
  + `<table:table-row><table:table-cell><text:p>${KNOWN.odtCells[0]}</text:p></table:table-cell><table:table-cell><text:p>${KNOWN.odtCells[1]}</text:p></table:table-cell></table:table-row>`
  + `<table:table-row><table:table-cell><text:p>${KNOWN.odtCells[2]}</text:p></table:table-cell><table:table-cell><text:p>${KNOWN.odtCells[3]}</text:p></table:table-cell></table:table-row>`
  + `</table:table></office:text></office:body></office:document-content>`;
const ODT_STYLES = '<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"></office:document-styles>';
const ODT_META = '<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:meta></office:meta></office:document-meta>';

export const ODT_BYTES = zipFiles([
  ['mimetype', 'application/vnd.oasis.opendocument.text'],
  ['META-INF/manifest.xml', ODT_MANIFEST],
  ['content.xml', ODT_CONTENT],
  ['styles.xml', ODT_STYLES],
  ['meta.xml', ODT_META],
], { level: 0 });

/* ---- XLSX: inline strings, no sharedStrings indirection ---- */
const XLSX_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
const XLSX_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const XLSX_WORKBOOK = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="QASheet" sheetId="1" r:id="rId1"/></sheets></workbook>';
const XLSX_WORKBOOK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
const XLSX_SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
  + `<row r="1"><c r="A1" t="inlineStr"><is><t>${KNOWN.xlsxCellA1}</t></is></c><c r="B1" t="inlineStr"><is><t>${KNOWN.xlsxHeader}</t></is></c></row>`
  + `<row r="2"><c r="A2" t="inlineStr"><is><t>${KNOWN.xlsxCellA2}</t></is></c><c r="B2" t="inlineStr"><is><t>${KNOWN.xlsxCellB2}</t></is></c></row>`
  + `</sheetData></worksheet>`;

export const XLSX_BYTES = zipFiles([
  ['[Content_Types].xml', XLSX_TYPES],
  ['_rels/.rels', XLSX_RELS],
  ['xl/workbook.xml', XLSX_WORKBOOK],
  ['xl/_rels/workbook.xml.rels', XLSX_WORKBOOK_RELS],
  ['xl/worksheets/sheet1.xml', XLSX_SHEET],
]);

/* ---- PPTX: two slides with real text runs ---- */
const PPTX_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>';
const PPTX_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>';
const PPTX_PRESENTATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>';
const PPTX_PRES_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>';
const pptxSlide = (id, text) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Title ${id}"/></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

export const PPTX_BYTES = zipFiles([
  ['[Content_Types].xml', PPTX_TYPES],
  ['_rels/.rels', PPTX_RELS],
  ['ppt/presentation.xml', PPTX_PRESENTATION],
  ['ppt/_rels/presentation.xml.rels', PPTX_PRES_RELS],
  ['ppt/slides/slide1.xml', pptxSlide(2, KNOWN.pptxSlide1)],
  ['ppt/slides/slide2.xml', pptxSlide(3, KNOWN.pptxSlide2)],
]);

/* ---- plain formats ---- */
export const HTML_BYTES = Buffer.from(
  '<!doctype html><html><head><meta charset="utf-8"><title>QA HTML MALICE-001</title></head>'
  + `<body><h1>QA HTML doc</h1><p>${KNOWN.htmlBody}</p>`
  + `<script>window.__docQaXssFired=1;document.body.setAttribute('data-xss','pwned');</script>`
  + '<img src="x" onerror="window.__docQaXssImg=1">'
  + '</body></html>', 'utf8');
export const TXT_BYTES = Buffer.from(`${KNOWN.txtBody}\nSecond line of the plain note.\n`, 'utf8');
export const MD_BYTES = Buffer.from(`# ${KNOWN.mdHeading}\n\n${KNOWN.mdBody} with **bold**.\n\n- list item one\n- list item two\n`, 'utf8');
export const CSV_BYTES = Buffer.from(`name,code\nqa-csv-row1,${KNOWN.csvRow1}\nqa-csv-row2,${KNOWN.csvRow2}\n`, 'utf8');
export const JSON_BYTES = Buffer.from(JSON.stringify({ title: KNOWN.jsonTitle, rows: [1, 2], note: 'qa json body' }, null, 2), 'utf8');

/* ---- bounded malicious fixtures: over-limit rows/blocks stay bounded,
   early real markers stay readable, the reader names the truncation ---- */
// CSV: header + 350 data rows = 351 rows total; reader shows the first 300
// and notes "300 of 351 rows". Row 2 carries a formula payload, row 3 a
// script tag; both must render as inert text, never run.
function buildBoundCsv() {
  const lines = ['name,code'];
  lines.push(`qa-big-row1,${KNOWN.csvBigFirst}`);
  lines.push(`qa-big-evil,"=HYPERLINK(""http://evil.example"",""${KNOWN.csvBigEvil}"")"`);
  lines.push(`qa-big-xss,<script>window.__docQaCsvXss=1</script>`);
  for (let n = 4; n <= 349; n++) lines.push(`qa-big-filler-${n},FILLER-${n}`);
  lines.push(`qa-big-last,${KNOWN.csvBigLast}`);
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}
export const CSV_BOUND_BYTES = buildBoundCsv();

// Markdown: heading + bold + 400 list items + script/link/img traps. The
// markdown renderer keeps everything as text nodes (strong/em/code only),
// so traps stay literal text and the full list stays readable.
function buildBoundMarkdown() {
  const lines = [`# ${KNOWN.mdBigHeading}`, '', `Intro line with **${KNOWN.mdBigBold}**.`, ''];
  lines.push(`- ${KNOWN.mdBigFirst}`);
  for (let n = 2; n <= 400; n++) lines.push(`- bulk-item-${n}`);
  lines.push('', '<script>window.__docQaMdXss=1</script>', '', '[evil](javascript:alert(1))', '', '<img src="x" onerror="window.__docQaMdImg=1">', '');
  lines.push('```', 'fenced trap <script>window.__docQaMdFence=1</script>', '```');
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}
export const MD_BOUND_BYTES = buildBoundMarkdown();

// HTML: 200-item list + 2x2 table up front, executable/network traps after.
// Sanitizer drops script/img/iframe/link/style/form while keeping the
// allowlisted list/table text, and names the simplification.
function buildBoundHtml() {
  let items = `<li>${KNOWN.htmlBigFirst}</li>`;
  for (let n = 2; n <= 200; n++) items += `<li>bulk-html-item-${n}</li>`;
  return Buffer.from(
    '<!doctype html><html><head><meta charset="utf-8"><title>QA big HTML</title>'
    + '<style>p { color: red; }</style></head>'
    + `<body><h1>QA big HTML doc</h1><ul>${items}</ul>`
    + `<table><tr><td>${KNOWN.htmlBigCell}</td><td>bulk-html-b1</td></tr>`
    + `<tr><td>bulk-html-a2</td><td>bulk-html-b2</td></tr></table>`
    + `<script>window.__docQaHtmlBigFired=1;document.body.setAttribute('data-xss','pwned');</script>`
    + '<img src="x" onerror="window.__docQaHtmlBigImg=1">'
    + '<iframe src="https://evil.example/"></iframe>'
    + '<a href="javascript:alert(1)">evil-link</a>'
    + '<p data-xss="pwned">attribute trap</p>'
    + '</body></html>', 'utf8');
}
export const HTML_BOUND_BYTES = buildBoundHtml();

// DOCX bound: heading + 5-item numbered list + 2x2 table, then 1600 filler
// paragraphs. Heading/list/table are 3 blocks; filler pushes the total past
// the 1500-block guard so the reader keeps the early content and notes
// "the first 1500 blocks".
function buildBoundDocx() {
  let body = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${KNOWN.docxBigTitle}</w:t></w:r></w:p>`;
  body += `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${KNOWN.docxBigList}</w:t></w:r></w:p>`;
  for (let n = 2; n <= 5; n++) body += `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>bulk-list-item-${n}</w:t></w:r></w:p>`;
  body += `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>`
    + `<w:tr><w:tc><w:p><w:r><w:t>${KNOWN.docxBigCell}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>bulk-docx-b1</w:t></w:r></w:p></w:tc></w:tr>`
    + `<w:tr><w:tc><w:p><w:r><w:t>bulk-docx-a2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>bulk-docx-b2</w:t></w:r></w:p></w:tc></w:tr>`
    + `</w:tbl>`;
  for (let n = 1; n <= 1600; n++) body += `<w:p><w:r><w:t>filler-paragraph-${n}</w:t></w:r></w:p>`;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return zipFiles([
    ['[Content_Types].xml', DOCX_TYPES],
    ['_rels/.rels', DOCX_RELS],
    ['word/document.xml', xml],
  ]);
}
export const DOCX_BOUND_BYTES = buildBoundDocx();

// XLSX bound: header + 350 data rows = 351 rows; reader shows the first 300
// rows and notes "first sheets/rows/cells only". First data row stays
// readable, last data row is cut away.
function buildBoundXlsx() {
  let sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
    + `<row r="1"><c r="A1" t="inlineStr"><is><t>big-name</t></is></c><c r="B1" t="inlineStr"><is><t>big-code</t></is></c></row>`
    + `<row r="2"><c r="A2" t="inlineStr"><is><t>${KNOWN.xlsxBigFirst}</t></is></c><c r="B2" t="inlineStr"><is><t>BIG-CODE-2</t></is></c></row>`;
  for (let r = 3; r <= 350; r++) sheet += `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>filler-${r}</t></is></c><c r="B${r}" t="inlineStr"><is><t>FILLER-${r}</t></is></c></row>`;
  sheet += `<row r="351"><c r="A351" t="inlineStr"><is><t>${KNOWN.xlsxBigLast}</t></is></c><c r="B351" t="inlineStr"><is><t>LAST-CODE</t></is></c></row></sheetData></worksheet>`;
  return zipFiles([
    ['[Content_Types].xml', XLSX_TYPES],
    ['_rels/.rels', XLSX_RELS],
    ['xl/workbook.xml', XLSX_WORKBOOK],
    ['xl/_rels/workbook.xml.rels', XLSX_WORKBOOK_RELS],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}
export const XLSX_BOUND_BYTES = buildBoundXlsx();
/* ---- error probes ---- */
export const MALFORMED_BYTES = Buffer.from('%PDF-1.4\n%QA-truncated-no-xref\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\n', 'utf8');
export const UNSUPPORTED_BYTES = Buffer.from('QA-UNSUPPORTED-BLOB-999 not a document at all', 'utf8');

/* ---- one list for the parent native isolated smoke ---- */
export function localFixtures() {
  return [
    { name: FILENAMES.pdf, mime: MIMES.pdf, bytes: PDF_BYTES },
    { name: FILENAMES.docxRoundtrip, mime: MIMES.docx, bytes: DOCX_ROUNDTRIP_BYTES },
    { name: FILENAMES.docxTable, mime: MIMES.docx, bytes: DOCX_TABLE_BYTES },
    { name: FILENAMES.odt, mime: MIMES.odt, bytes: ODT_BYTES },
    { name: FILENAMES.xlsx, mime: MIMES.xlsx, bytes: XLSX_BYTES },
    { name: FILENAMES.pptx, mime: MIMES.pptx, bytes: PPTX_BYTES },
    { name: FILENAMES.html, mime: MIMES.html, bytes: HTML_BYTES },
    { name: FILENAMES.txt, mime: MIMES.txt, bytes: TXT_BYTES },
    { name: FILENAMES.md, mime: MIMES.md, bytes: MD_BYTES },
    { name: FILENAMES.csv, mime: MIMES.csv, bytes: CSV_BYTES },
    { name: FILENAMES.json, mime: MIMES.json, bytes: JSON_BYTES },
  ];
}
