// Doc staging — draft -> clean preview -> export (.md, real .docx).
// Zero-dep: docx is a stored-zip of OOXML parts (minimal writer below).
// Staging never sends anything anywhere; export is a user download.

import { createHash } from 'node:crypto';

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'draft';
}

/** Turn an ask into a staged draft (doc or slides). Deterministic, local. */
export function makeDraft(query, kind = 'stage-doc') {
  let topic = String(query).replace(/^(draft|write|make|create)\s+(a\s+|an\s+|me\s+a\s+)?/i, '').trim();
  const about = topic.match(/\babout\s+(.+)$/i);
  if (about) topic = about[1].trim();
  else topic = topic.replace(/^(letter|document|doc|report|slides?|deck|presentation|ppt)(\s+(for|to|on))?\s*/i, '').trim() || topic;
  const title = topic.charAt(0).toUpperCase() + topic.slice(1);
  const id = `${slug(title)}-${createHash('sha1').update(String(query)).digest('hex').slice(0, 6)}`;
  if (kind === 'stage-slides') {
    const sections = ['Title', 'The problem', 'What we propose', 'How it works', 'Next steps'];
    return { id, kind, title: title + ' — deck', query: String(query),
      sections: sections.map((h, i) => ({ heading: h, body: i === 0 ? title : `• Draft point about ${topic.toLowerCase()} (${h.toLowerCase()}) — edit before presenting.` })),
      created: new Date().toISOString() };
  }
  return { id, kind, title, query: String(query),
    sections: [
      { heading: title, body: `Dear …,\n\nThis is a staged draft about ${topic.toLowerCase()}. It was drafted locally by Profiles and has not been sent anywhere.` },
      { heading: 'Key points', body: `• First point about ${topic.toLowerCase()} — replace with your words.\n• Second point — check names, dates and numbers.` },
      { heading: 'Closing', body: 'Thank you for your time.\n\nKind regards,\n…' },
    ], created: new Date().toISOString() };
}

export function draftToMarkdown(draft) {
  const head = draft.kind === 'stage-slides' ? '# ' : '# ';
  return head + draft.title + '\n\n' + draft.sections.map((s) =>
    (draft.kind === 'stage-slides' ? '## Slide: ' : '## ') + s.heading + '\n\n' + s.body).join('\n\n') + '\n';
}

/* ---- minimal stored-zip writer (docx container) ---- */
const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(entries) {
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name), body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = crc32(body), local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(body.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Real .docx (Word / Google Docs openable) from a staged draft. */
export function draftToDocx(draft) {
  const paras = [];
  paras.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xmlEsc(draft.title)}</w:t></w:r></w:p>`);
  for (const s of draft.sections) {
    paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xmlEsc(s.heading)}</w:t></w:r></w:p>`);
    for (const line of String(s.body).split('\n')) paras.push(`<w:p><w:r><w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r></w:p>`);
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr/></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipStore([
    { name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document }, { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: docRels },
  ]);
}

/** A Playwright/codemode script staged for the user to run — never auto-run. */
export function makeScriptDraft(query) {
  const id = `script-${slug(query)}`;
  const body = `// Staged by Profiles from: "${String(query).replace(/"/g, "'")}"\n// Review before running. Run yourself with: node ${id}.mjs\n// Profiles never auto-executes staged scripts.\nimport { chromium } from 'playwright'; // optional dep\nconst browser = await chromium.launch();\nconst page = await browser.newPage();\n// TODO(you): add the steps, run, then file the result back in Profiles.\nawait page.goto('https://example.org');\nconsole.log(await page.title());\nawait browser.close();\n`;
  return { id, kind: 'write-script', title: String(query), body, created: new Date().toISOString() };
}

/* ---- pasted documents: Read/Write pane -> staged draft (pure, tested) ----
   Paste-through, not integration: text/markdown/HTML renders a sanitized
   inline preview; heavy binaries (.pdf/.docx/.pptx) get an honest
   fallback (staged pointer + .md/.docx export + open-external). */
/** Minimal markdown -> HTML: headings, bold, italic, code, links, lists.
   Escapes first, so pasted HTML never passes through raw. Pure. */
export function markdownToHtml(md) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => {
    let t = esc(s);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return t;
  };
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let html = '', inList = false;
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      if (inList) { html += '</ul>'; inList = false; }
      const lvl = h[1].length;
      html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>';
    } else if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inline(li[1]) + '</li>';
    } else if (!line.trim()) {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<p>' + inline(line) + '</p>';
    }
  }
  if (inList) html += '</ul>';
  return html || '<p></p>';
}

/** A pasted/fetched document becomes a staged draft (preview + .md/.docx
   export through the paths that already work). Pure. */
export function makePastedDoc({ title, markdown, sourceUrl }) {
  const t = String(title || 'Pasted document').slice(0, 120) || 'Pasted document';
  const id = slug(t) + '-' + createHash('sha1').update(String(markdown || t)).digest('hex').slice(0, 6);
  const body = String(markdown || '').slice(0, 60000) + (sourceUrl ? '\n\n(Source: ' + sourceUrl + ')' : '');
  return { id, kind: 'stage-doc', title: t, query: 'paste: ' + t,
    sections: [{ heading: t, body }], sourceUrl: sourceUrl || null, created: new Date().toISOString() };
}

/** Honest fallback preview for heavy binaries: never a white void, never
   a faked render. Pure. */
export function binaryFallbackHtml(filename, sourceUrl) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const name = esc(filename || 'file');
  const link = sourceUrl ? ' <a href="' + esc(sourceUrl) + '" rel="noopener">Open externally</a>.' : '';
  return '<p>I can\u2019t render <b>' + name + '</b> inline \u2014 it needs its own app. '
    + 'I staged a pointer instead: export it as .md or .docx below when handy, or' + link + '</p>';
}
