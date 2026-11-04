/* Profiles document reader — local-only basic document viewing.
   Classic script, loaded before main.js. Owns no integration markup, no
   backend files, no network services. All processing is local; remote URLs
   go through the same-origin bytes endpoint the parent provides
   (apiUrl('/api/doc/source?url=...')); standalone mode may try a direct
   fetch (CORS permitting) but never a cloud conversion service.

   Supported: PDF, DOCX, ODT, XLSX, PPTX, TXT/MD/HTML/CSV/JSON.
   Readable pass-through, not an Office editor: text/tables, never
   pretend pixel-perfect Office formatting. Unknown/legacy binaries fail
   honestly. File and response cap: 10 MiB.

   API: window.ProfilesDocumentReader = { supports, read, close }.
   read({file?, url?, preview, status, apiUrl})
     -> Promise {ok, title, format, text?, error?}; renders into preview,
        writes human messages into status via textContent only.
   Classic-script safe: no top-level import/export. Dynamic import() is
   used for the parent-vendored engines:
     ./vendor/documents/pdf.min.mjs (+ pdf.worker.min.mjs)
     ./vendor/documents/fflate-browser.mjs
   No inline styles are set from JS (all styling lives in
   document-reader.css, keeping the host CSP happy). Untrusted content is
   built with DOMParser + createElement + textContent only — never
   innerHTML, no executable links/images, no external references. */
(function () {
  'use strict';
  /* Captured synchronously: document.currentScript is only valid during initial execution. */
  var SCRIPT_BASE = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (s) return s.slice(0, s.lastIndexOf('/') + 1);
    } catch (e) { /* fall through */ }
    return './';
  })();

  /* ---------------- bounds ---------------- */
  var MAX_BYTES = 10 * 1024 * 1024;      /* file/response cap */
  var MAX_CANVAS_PIXELS = 2000000;       /* ~2M px PDF canvas bound */
  var MAX_ZIP_ENTRIES = 5000;            /* central-directory entry guard */
  var MAX_XML_PER_FILE = 8 * 1024 * 1024;  /* actual decoded bytes, per entry */
  var MAX_XML_TOTAL = 16 * 1024 * 1024;    /* actual decoded bytes, selected */
  var MAX_BLOCKS = 1500;                 /* paragraphs/headings/lists/tables/slides */
  var MAX_CELLS = 5000;                  /* xlsx cells total */
  var MAX_ROWS_PER_SHEET = 300;
  var MAX_COLS_PER_ROW = 50;
  var MAX_TABLE_ROWS = 300;              /* docx/odt rows rendered per table */
  var MAX_TABLE_COLS = 50;               /* docx/odt cells rendered per row */
  var MAX_TABLE_CELLS = 5000;            /* docx/odt cells rendered per document */
  var MAX_SHEETS = 4;                    /* first sheets, numeric file order */
  var MAX_SLIDES = 200;
  var MAX_PARAS_PER_SLIDE = 300;
  var MAX_TEXT_RETURN = 200000;          /* text field bound */
  var MAX_HTML_NODES = 3000;             /* sanitizer element budget */
  var MAX_HTML_DEPTH = 50;               /* sanitizer nesting budget */
  var MAX_INLINE_NODES = 100;            /* inline markdown nodes per block */
  var MAX_CSV_ROWS = 301;                /* parse one past the display cap, then stop */
  var MAX_CSV_COLS = 50;                 /* columns kept per row */
  var MAX_CSV_FIELD = 5000;              /* chars kept per field */
  var RESIZE_DEBOUNCE_MS = 200;

  /* ---------------- generations / active state ---------------- */
  var generation = 0;
  var pdfLibPromise = null;
  var fflatePromise = null;
  var active = null;      /* current read's cancellable resources */
  var lastPreview = null;
  var lastStatus = null;

  /* NOTE: script URL base is captured once in SCRIPT_BASE above; do not add
     lazy document.currentScript reads here (null after initial execution). */
  function teardown(a) {
    if (!a) return;
    try { if (a.abort) a.abort.abort(); } catch (e) {}
    try { clearTimeout(a.timer); } catch (e) {}
    try { if (a.ro) a.ro.disconnect(); } catch (e) {}
    try {
      if (a.renderTask && a.renderTask.cancel) a.renderTask.cancel();
    } catch (e) {}
    a.renderTask = null;
    if (a.pdfDoc) {
      try {
        var d = a.pdfDoc;
        a.pdfDoc = null;
        if (d.destroy) d.destroy();
      } catch (e) {}
    }
  }

  function clearEl(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /* ---------------- format detection ---------------- */
  var TEXT_EXTS = { txt: 1, md: 1, markdown: 1, html: 1, htm: 1, csv: 1, json: 1 };
  var ZIP_EXTS = { docx: 1, odt: 1, xlsx: 1, pptx: 1 };

  function extOf(nameOrUrl) {
    if (!nameOrUrl) return '';
    var s = String(nameOrUrl);
    s = s.split('#')[0].split('?')[0];
    var slash = s.lastIndexOf('/');
    var base = slash >= 0 ? s.slice(slash + 1) : s;
    var dot = base.lastIndexOf('.');
    if (dot < 0) return '';
    return base.slice(dot + 1).toLowerCase();
  }

  function formatOf(nameOrUrl) {
    var ext = extOf(nameOrUrl);
    if (ext === 'pdf') return 'pdf';
    if (ZIP_EXTS[ext]) return ext;
    if (ext === 'txt') return 'text';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'csv') return 'csv';
    if (ext === 'json') return 'json';
    return '';
  }

  function supports(nameOrUrl) {
    return formatOf(nameOrUrl) !== '';
  }

  function titleOf(file, url) {
    if (file && file.name) return file.name;
    if (url) {
      try {
        var s = String(url).split('#')[0].split('?')[0];
        var base = s.slice(s.lastIndexOf('/') + 1) || s;
        return decodeURIComponent(base) || String(url);
      } catch (e) {
        return String(url);
      }
    }
    return 'document';
  }

  function isStandalone() {
    try {
      return window.__PROFILES_STANDALONE__ === true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- vendored engines (parent-provided) ---------------- */
  function loadPdfLib() {
    if (!pdfLibPromise) {
      pdfLibPromise = (function () {
        var url = SCRIPT_BASE + 'vendor/documents/pdf.min.mjs';
        return import(url).then(function (mod) {
          var lib = null;
          if (mod && typeof mod.getDocument === 'function') lib = mod;
          else if (mod && mod.default && typeof mod.default.getDocument === 'function') lib = mod.default;
          else if (typeof window.pdfjsLib !== 'undefined' && window.pdfjsLib.getDocument) lib = window.pdfjsLib;
          if (!lib) throw new Error('PDF engine did not expose getDocument.');
          try {
            if (lib.GlobalWorkerOptions) {
              lib.GlobalWorkerOptions.workerSrc = SCRIPT_BASE + 'vendor/documents/pdf.worker.min.mjs';
            }
          } catch (e) { /* worker config best-effort; render will surface failure */ }
          return lib;
        }).catch(function (err) {
          pdfLibPromise = null; /* allow retry on a later read */
          throw new Error('PDF engine missing (src/vendor/documents/pdf.min.mjs): ' +
            (err && err.message ? err.message : String(err)));
        });
      })();
    }
    return pdfLibPromise;
  }

  function loadFflate() {
    if (!fflatePromise) {
      fflatePromise = (function () {
        var url = SCRIPT_BASE + 'vendor/documents/fflate-browser.mjs';
        return import(url).then(function (mod) {
          var f = (mod && mod.Unzip) ? mod : (mod && mod.default && mod.default.Unzip ? mod.default : null);
          if (!f || !f.Unzip) throw new Error('zip engine did not expose Unzip.');
          if (!f.UnzipInflate) throw new Error('zip engine did not expose UnzipInflate.');
          return f;
        }).catch(function (err) {
          fflatePromise = null;
          throw new Error('Zip engine missing (src/vendor/documents/fflate-browser.mjs): ' +
            (err && err.message ? err.message : String(err)));
        });
      })();
    }
    return fflatePromise;
  }

  /* ---------------- DOM helpers (no innerHTML, ever) ---------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function note(text) {
    return el('div', 'document-reader-note', text);
  }

  function localName(n) {
    if (!n) return '';
    if (n.localName) return n.localName;
    var nn = n.nodeName || '';
    var i = nn.indexOf(':');
    return i >= 0 ? nn.slice(i + 1) : nn;
  }

  function childEls(node) {
    var out = [];
    if (!node || !node.childNodes) return out;
    for (var i = 0; i < node.childNodes.length; i++) {
      if (node.childNodes[i].nodeType === 1) out.push(node.childNodes[i]);
    }
    return out;
  }

  function byLocal(root, name) {
    var out = [];
    if (!root || !root.getElementsByTagName) return out;
    var all = root.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if (localName(all[i]) === name) out.push(all[i]);
    }
    return out;
  }

  function directChildrenByLocal(node, name) {
    var out = [];
    var kids = childEls(node);
    for (var i = 0; i < kids.length; i++) {
      if (localName(kids[i]) === name) out.push(kids[i]);
    }
    return out;
  }

  function firstByLocal(node, name) {
    var kids = childEls(node);
    for (var i = 0; i < kids.length; i++) {
      if (localName(kids[i]) === name) return kids[i];
    }
    return null;
  }

  function attrByLocal(node, name) {
    if (!node || !node.attributes) return '';
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i];
      var ln = a.localName || (a.name || '').split(':').pop();
      if (ln === name) return a.value || '';
    }
    return '';
  }

  function boundText(s) {
    s = String(s == null ? '' : s);
    if (s.length > MAX_TEXT_RETURN) return s.slice(0, MAX_TEXT_RETURN) + '\n…[truncated]';
    return s;
  }

  /* ---------------- XML safety ---------------- */
  function safeXmlParse(text, label) {
    if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
      throw new Error(label + ': document type declarations are not allowed.');
    }
    var doc;
    try {
      doc = new DOMParser().parseFromString(text, 'application/xml');
    } catch (e) {
      throw new Error(label + ': malformed XML (' + (e && e.message ? e.message : e) + ').');
    }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) {
      throw new Error(label + ': malformed XML.');
    }
    return doc;
  }

  /* ---------------- zip handling: bounded selected entries only ---------------- */
  function unzipSelected(fflate, bytes, wanted) {
    return new Promise(function (resolve, reject) {
      var pending = {};
      var order = [];
      var entryCount = 0;
      var totalWanted = 0;
      var failed = null;
      var uz;
      try {
        uz = new fflate.Unzip();
        if (fflate.UnzipInflate) uz.register(fflate.UnzipInflate);
      } catch (e) {
        reject(new Error('malformed archive: cannot open zip (' + (e && e.message ? e.message : e) + ').'));
        return;
      }
      uz.onfile = function (f) {
        entryCount++;
        if (entryCount > MAX_ZIP_ENTRIES) {
          failed = 'too many zip entries.';
          return; /* never inflated: no ondata set, no start() call */
        }
        var name = f.name || '';
        if (!wanted(name)) return; /* never inflate unselected entries */
        if (pending[name]) return; /* duplicate selected name: keep the first */
        var st = { chunks: [], len: 0, bad: null, done: false };
        pending[name] = st;
        order.push(name);
        f.ondata = function (err, dat, fin) {
          if (st.bad) return;
          if (err) {
            st.bad = 'entry decode error.';
            st.chunks = [];
            return;
          }
          if (dat && dat.length) {
            if (st.len + dat.length > MAX_XML_PER_FILE ||
                totalWanted + dat.length > MAX_XML_TOTAL) {
              st.bad = 'entry exceeds decode limit (zip-bomb guard).';
              st.chunks = [];
              return;
            }
            st.chunks.push(dat);
            st.len += dat.length;
            totalWanted += dat.length;
          }
          if (fin) st.done = true;
        };
        try {
          f.start(); /* begin streaming ONLY this selected entry */
        } catch (e) {
          st.bad = 'entry decode error.';
          st.chunks = [];
        }
      };
      try {
        uz.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), true);
      } catch (e) {
        reject(new Error('malformed archive: not a readable zip (' + (e && e.message ? e.message : e) + ').'));
        return;
      }
      if (failed) {
        reject(new Error('archive rejected: ' + failed));
        return;
      }
      var out = {};
      for (var i = 0; i < order.length; i++) {
        var st = pending[order[i]];
        if (st.bad || !st.done) {
          reject(new Error('archive entry rejected: ' + order[i] + ' — ' + (st.bad || 'incomplete data') + '.'));
          return;
        }
        var flat = new Uint8Array(st.len);
        var off = 0;
        for (var j = 0; j < st.chunks.length; j++) {
          flat.set(st.chunks[j], off);
          off += st.chunks[j].length;
        }
        st.chunks = [];
        var text;
        try {
          text = fflate.strFromU8(flat);
        } catch (e) {
          reject(new Error('archive entry rejected: ' + order[i] + ' is not decodable text.'));
          return;
        }
        out[order[i]] = text;
      }
      resolve(out);
    });
  }

  function isSheetFile(name, prefix) {
    if (name.slice(0, prefix.length) !== prefix || name.slice(-4) !== '.xml') return -1;
    var mid = name.slice(prefix.length, -4);
    if (!/^\d+$/.test(mid)) return -1;
    return parseInt(mid, 10);
  }

  /* ---------------- DOCX ---------------- */
  var WORD_NS_HINT = 'word/document.xml';

  function docxStyleOf(pEl) {
    var pPr = firstByLocal(pEl, 'pPr');
    if (!pPr) return '';
    var pStyle = firstByLocal(pPr, 'pStyle');
    if (!pStyle) return '';
    return attrByLocal(pStyle, 'val');
  }

  function docxHasNumPr(pEl) {
    var pPr = firstByLocal(pEl, 'pPr');
    return !!(pPr && firstByLocal(pPr, 'numPr'));
  }

  function docxParaText(pEl) {
    var parts = [];
    var runs = byLocal(pEl, 't');
    for (var i = 0; i < runs.length; i++) {
      /* only text inside this paragraph's runs; byLocal is scoped per pEl */
      parts.push(runs[i].textContent || '');
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
  }

  function renderDocx(xmlText) {
    var doc = safeXmlParse(xmlText, 'DOCX');
    var bodies = byLocal(doc, 'body');
    if (!bodies.length) throw new Error('DOCX: no document body found.');
    var body = bodies[0];
    var wrap = el('div', 'document-reader-doc');
    var texts = [];
    var blocks = 0;
    var cellsTotal = 0;
    var truncated = false;
    var list = null;

    function flushList() { list = null; }

    function pushBlock() {
      blocks++;
      if (blocks > MAX_BLOCKS) { truncated = true; return false; }
      return true;
    }

    var kids = childEls(body);
    for (var i = 0; i < kids.length; i++) {
      if (blocks >= MAX_BLOCKS) { truncated = true; break; }
      var ln = localName(kids[i]);
      if (ln === 'p') {
        var t = docxParaText(kids[i]);
        if (!t) { continue; }
        var style = docxStyleOf(kids[i]);
        var m = /^Heading([1-9])/.exec(style || '');
        if (docxHasNumPr(kids[i]) && !m) {
          if (!pushBlock()) break; /* every list item counts against MAX_BLOCKS */
          if (!list) {
            list = el('ul', 'document-reader-list');
            wrap.appendChild(list);
          }
          var li = el('li', '', t);
          list.appendChild(li);
          texts.push('• ' + t);
        } else {
          flushList();
          if (!pushBlock()) break;
          if (m) {
            var lvl = Math.min(6, parseInt(m[1], 10));
            wrap.appendChild(el('h' + lvl, '', t));
          } else {
            wrap.appendChild(el('p', '', t));
          }
          texts.push(t);
        }
      } else if (ln === 'tbl') {
        flushList();
        if (!pushBlock()) break;
        var table = el('table', 'document-reader-table');
        var rows = byLocal(kids[i], 'tr');
        if (rows.length > MAX_TABLE_ROWS) { rows = rows.slice(0, MAX_TABLE_ROWS); truncated = true; }
        var tableEmpty = true;
        for (var r = 0; r < rows.length; r++) {
          if (cellsTotal >= MAX_TABLE_CELLS) { truncated = true; break; }
          var tr = el('tr', '');
          var cells = directChildrenByLocal(rows[r], 'tc');
          if (cells.length > MAX_TABLE_COLS) { cells = cells.slice(0, MAX_TABLE_COLS); truncated = true; }
          for (var c = 0; c < cells.length; c++) {
            if (cellsTotal >= MAX_TABLE_CELLS) { truncated = true; break; }
            cellsTotal++;
            var paras = directChildrenByLocal(cells[c], 'p');
            var ct = [];
            for (var q = 0; q < paras.length; q++) {
              var pt = docxParaText(paras[q]);
              if (pt) ct.push(pt);
            }
            var cellText = ct.join(' ');
            tr.appendChild(el('td', '', cellText));
          }
          if (tr.childNodes.length) { table.appendChild(tr); tableEmpty = false; }
        }
        if (!tableEmpty) {
          wrap.appendChild(table);
          texts.push('[table]');
        } else {
          blocks--;
        }
      } else if (ln === 'sectPr') {
        continue;
      }
    }
    flushList();
    if (truncated) wrap.appendChild(note('Truncated: showing the first ' + MAX_BLOCKS + ' blocks and up to ' + MAX_TABLE_ROWS + ' rows × ' + MAX_TABLE_COLS + ' columns (' + MAX_TABLE_CELLS + ' cells total), not the whole document.'));
    if (!wrap.childNodes.length) wrap.appendChild(note('No readable text found in this document.'));
    return { node: wrap, text: texts.join('\n\n') };
  }

  /* ---------------- ODT ---------------- */
  function renderOdt(xmlText) {
    var doc = safeXmlParse(xmlText, 'ODT');
    var bodies = byLocal(doc, 'body');
    if (!bodies.length) throw new Error('ODT: no office body found.');
    var texts = byLocal(bodies[0], 'text');
    if (!texts.length) throw new Error('ODT: no readable text section found.');
    var root = texts[0];
    var wrap = el('div', 'document-reader-doc');
    var out = [];
    var blocks = 0;
    var cellsTotal = 0;
    var truncated = false;

    var kids = childEls(root);
    for (var i = 0; i < kids.length; i++) {
      if (blocks >= MAX_BLOCKS) { truncated = true; break; }
      var ln = localName(kids[i]);
      if (ln === 'p') {
        var t = (kids[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        blocks++;
        wrap.appendChild(el('p', '', t));
        out.push(t);
      } else if (ln === 'h') {
        var h = (kids[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (!h) continue;
        var lvl = parseInt(attrByLocal(kids[i], 'outline-level') || '1', 10);
        if (!(lvl >= 1 && lvl <= 6)) lvl = 1;
        blocks++;
        wrap.appendChild(el('h' + lvl, '', h));
        out.push(h);
      } else if (ln === 'list') {
        var items = byLocal(kids[i], 'list-item');
        if (!items.length) continue;
        var listEl = null;
        for (var j = 0; j < items.length; j++) {
          var ps = byLocal(items[j], 'p');
          var it = [];
          for (var k = 0; k < ps.length; k++) {
            var s = (ps[k].textContent || '').replace(/\s+/g, ' ').trim();
            if (s) it.push(s);
          }
          var joined = it.join(' ');
          if (!joined) continue;
          blocks++;
          if (blocks > MAX_BLOCKS) { truncated = true; break; }
          if (!listEl) {
            listEl = el('ul', 'document-reader-list');
            wrap.appendChild(listEl);
          }
          listEl.appendChild(el('li', '', joined));
          out.push('• ' + joined);
        }
        if (blocks > MAX_BLOCKS) { truncated = true; break; }
      } else if (ln === 'table') {
        blocks++;
        if (blocks > MAX_BLOCKS) { truncated = true; break; }
        var table = el('table', 'document-reader-table');
        var rows = byLocal(kids[i], 'table-row');
        if (rows.length > MAX_TABLE_ROWS) { rows = rows.slice(0, MAX_TABLE_ROWS); truncated = true; }
        var tableEmpty = true;
        for (var r = 0; r < rows.length; r++) {
          if (cellsTotal >= MAX_TABLE_CELLS) { truncated = true; break; }
          var tr = el('tr', '');
          var cells = directChildrenByLocal(rows[r], 'table-cell');
          if (cells.length > MAX_TABLE_COLS) { cells = cells.slice(0, MAX_TABLE_COLS); truncated = true; }
          for (var c = 0; c < cells.length; c++) {
            if (cellsTotal >= MAX_TABLE_CELLS) { truncated = true; break; }
            cellsTotal++;
            var ps2 = byLocal(cells[c], 'p');
            var ct = [];
            for (var q = 0; q < ps2.length; q++) {
              var s2 = (ps2[q].textContent || '').replace(/\s+/g, ' ').trim();
              if (s2) ct.push(s2);
            }
            tr.appendChild(el('td', '', ct.join(' ')));
          }
          if (tr.childNodes.length) { table.appendChild(tr); tableEmpty = false; }
        }
        if (!tableEmpty) {
          wrap.appendChild(table);
          out.push('[table]');
        } else {
          blocks--;
        }
      }
    }
    if (truncated) wrap.appendChild(note('Truncated: showing the first ' + MAX_BLOCKS + ' blocks and up to ' + MAX_TABLE_ROWS + ' rows × ' + MAX_TABLE_COLS + ' columns (' + MAX_TABLE_CELLS + ' cells total), not the whole document.'));
    if (!wrap.childNodes.length) wrap.appendChild(note('No readable text found in this document.'));
    return { node: wrap, text: out.join('\n\n') };
  }

  /* ---------------- XLSX ---------------- */
  function colLettersToIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseCellRef(ref) {
    var m = /^([A-Z]{1,4})(\d{1,7})$/.exec(ref || '');
    if (!m) return null;
    return { col: colLettersToIndex(m[1]), row: parseInt(m[2], 10) };
  }

  function xlsxSharedStrings(xmlText) {
    if (!xmlText) return [];
    var doc = safeXmlParse(xmlText, 'XLSX shared strings');
    var sis = byLocal(doc, 'si');
    var out = [];
    for (var i = 0; i < sis.length && i < 100000; i++) {
      var ts = byLocal(sis[i], 't');
      var s = '';
      for (var j = 0; j < ts.length; j++) s += ts[j].textContent || '';
      out.push(s);
    }
    return out;
  }

  function xlsxSheetNames(xmlText) {
    if (!xmlText) return [];
    var doc = safeXmlParse(xmlText, 'XLSX workbook');
    var sheets = byLocal(doc, 'sheet');
    var names = [];
    for (var i = 0; i < sheets.length; i++) {
      names.push(sheets[i].getAttribute('name') || ('Sheet' + (i + 1)));
    }
    return names;
  }

  function xlsxSheetCells(xmlText, shared) {
    var doc = safeXmlParse(xmlText, 'XLSX worksheet');
    var cs = byLocal(doc, 'c');
    var cells = [];
    for (var i = 0; i < cs.length && cells.length < MAX_CELLS; i++) {
      var ref = parseCellRef(cs[i].getAttribute('r'));
      if (!ref) continue;
      var t = cs[i].getAttribute('t');
      var v = '';
      if (t === 's') {
        var vEl = firstByLocal(cs[i], 'v');
        var idx = vEl ? parseInt((vEl.textContent || '').trim(), 10) : NaN;
        v = (idx >= 0 && idx < shared.length) ? shared[idx] : '';
      } else if (t === 'inlineStr') {
        var isEl = firstByLocal(cs[i], 'is');
        if (isEl) {
          var ts = byLocal(isEl, 't');
          for (var j = 0; j < ts.length; j++) v += ts[j].textContent || '';
        }
      } else {
        var vv = firstByLocal(cs[i], 'v');
        v = vv ? (vv.textContent || '') : '';
      }
      cells.push({ row: ref.row, col: ref.col, v: v });
    }
    var hitCap = cs.length > cells.length;
    return { cells: cells, hitCap: hitCap };
  }

  function renderXlsx(entries) {
    var shared = xlsxSharedStrings(entries['xl/sharedStrings.xml']);
    var names = xlsxSheetNames(entries['xl/workbook.xml']);
    var sheetFiles = [];
    for (var k in entries) {
      if (!Object.prototype.hasOwnProperty.call(entries, k)) continue;
      var n = isSheetFile(k, 'xl/worksheets/sheet');
      if (n > 0) sheetFiles.push({ n: n, name: k });
    }
    sheetFiles.sort(function (a, b) { return a.n - b.n; });
    if (!sheetFiles.length) throw new Error('XLSX: no worksheets found.');
    var picked = sheetFiles.slice(0, MAX_SHEETS);
    var wrap = el('div', 'document-reader-doc');
    var out = [];
    var totalCells = 0;
    var truncated = sheetFiles.length > picked.length;
    for (var s = 0; s < picked.length; s++) {
      var label = names[s] || ('Sheet' + picked[s].n);
      var sec = el('section', 'document-reader-sheet');
      sec.appendChild(el('h3', '', label));
      var parsed = xlsxSheetCells(entries[picked[s].name], shared);
      var cells = parsed.cells;
      if (parsed.hitCap) truncated = true;
      cells.sort(function (a, b) { return a.row - b.row || a.col - b.col; });
      var byRow = {};
      var rowNums = [];
      for (var i = 0; i < cells.length; i++) {
        var r = cells[i].row;
        if (!byRow[r]) { byRow[r] = []; rowNums.push(r); }
        byRow[r].push(cells[i]);
      }
      rowNums.sort(function (a, b) { return a - b; });
      var shownRows = rowNums.slice(0, MAX_ROWS_PER_SHEET);
      if (rowNums.length > shownRows.length) truncated = true;
      var table = el('table', 'document-reader-table');
      for (var ri = 0; ri < shownRows.length; ri++) {
        var rowCells = byRow[shownRows[ri]];
        var minC = rowCells[0].col;
        var maxC = rowCells[0].col;
        for (var q = 1; q < rowCells.length; q++) {
          if (rowCells[q].col < minC) minC = rowCells[q].col;
          if (rowCells[q].col > maxC) maxC = rowCells[q].col;
        }
        if (maxC - minC + 1 > MAX_COLS_PER_ROW) { maxC = minC + MAX_COLS_PER_ROW - 1; truncated = true; }
        var map = {};
        for (var w = 0; w < rowCells.length; w++) {
          if (rowCells[w].col <= maxC && map[rowCells[w].col] === undefined) {
            map[rowCells[w].col] = rowCells[w].v;
          }
        }
        var tr = el('tr', '');
        var line = [];
        for (var c = minC; c <= maxC; c++) {
          if (totalCells >= MAX_CELLS) { truncated = true; break; }
          totalCells++;
          var val = map[c] === undefined ? '' : map[c];
          tr.appendChild(el('td', '', val));
          line.push(val);
        }
        table.appendChild(tr);
        out.push(line.join('\t'));
        if (totalCells >= MAX_CELLS) break;
      }
      sec.appendChild(table);
      wrap.appendChild(sec);
      out.push('');
      if (totalCells >= MAX_CELLS) break;
    }
    if (truncated) wrap.appendChild(note('Truncated: showing the first sheets/rows/cells only, not the whole workbook.'));
    return { node: wrap, text: out.join('\n') };
  }

  /* ---------------- PPTX ---------------- */
  function renderPptx(entries) {
    var slides = [];
    for (var k in entries) {
      if (!Object.prototype.hasOwnProperty.call(entries, k)) continue;
      var n = isSheetFile(k, 'ppt/slides/slide');
      if (n > 0) slides.push({ n: n, name: k });
    }
    slides.sort(function (a, b) { return a.n - b.n; });
    if (!slides.length) throw new Error('PPTX: no slides found.');
    var picked = slides.slice(0, MAX_SLIDES);
    var wrap = el('div', 'document-reader-doc');
    var out = [];
    var blocksTotal = 0;
    var deckTruncated = false;
    for (var s = 0; s < picked.length; s++) {
      if (blocksTotal >= MAX_BLOCKS) { deckTruncated = true; break; }
      var doc = safeXmlParse(entries[picked[s].name], 'PPTX slide ' + picked[s].n);
      var sec = el('section', 'document-reader-slide');
      sec.appendChild(el('h3', '', 'Slide ' + picked[s].n));
      out.push('Slide ' + picked[s].n);
      var paras = byLocal(doc, 'p');
      var shown = 0;
      var skippedEmpty = 0;
      for (var i = 0; i < paras.length && shown < MAX_PARAS_PER_SLIDE; i++) {
        var ts = byLocal(paras[i], 't');
        var line = '';
        for (var j = 0; j < ts.length; j++) line += ts[j].textContent || '';
        line = line.replace(/\s+/g, ' ').trim();
        if (!line) { skippedEmpty++; continue; }
        if (blocksTotal >= MAX_BLOCKS) { deckTruncated = true; break; }
        shown++;
        blocksTotal++;
        sec.appendChild(el('p', '', line));
        out.push(line);
      }
      if (paras.length > shown + skippedEmpty) sec.appendChild(note('Slide text truncated.'));
      if (deckTruncated) sec.appendChild(note('Deck truncated at ' + MAX_BLOCKS + ' text blocks.'));
      out.push('');
      wrap.appendChild(sec);
    }
    if (deckTruncated) {
      wrap.appendChild(note('Truncated: showing the first ' + MAX_BLOCKS + ' text blocks of the deck.'));
    } else if (slides.length > picked.length) {
      wrap.appendChild(note('Truncated: showing ' + picked.length + ' of ' + slides.length + ' slides.'));
    }
    return { node: wrap, text: out.join('\n') };
  }

  /* ---------------- text formats: inert preview ---------------- */
  var ALLOWED_HTML = {
    p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
    ul: 1, ol: 1, li: 1, table: 1, thead: 1, tbody: 1, tr: 1, td: 1, th: 1,
    pre: 1, code: 1, blockquote: 1, b: 1, i: 1, em: 1, strong: 1, u: 1,
    br: 1, hr: 1, div: 1, span: 1, section: 1, article: 1
  };

  function sanitizeHtml(sourceDoc) {
    var state = { nodes: 0, truncated: false };
    function clean(node, depth) {
      var out = document.createDocumentFragment();
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        if (state.nodes >= MAX_HTML_NODES) { state.truncated = true; break; }
        var k = kids[i];
        if (k.nodeType === 3) {
          state.nodes++;
          out.appendChild(document.createTextNode(k.nodeValue || ''));
        } else if (k.nodeType === 1) {
          if (depth >= MAX_HTML_DEPTH) {
            state.truncated = true; /* too deep: keep text, drop nesting */
            state.nodes++;
            out.appendChild(document.createTextNode(k.textContent || ''));
            continue;
          }
          var tag = (k.localName || k.nodeName || '').toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'img' ||
              tag === 'video' || tag === 'audio' || tag === 'iframe' ||
              tag === 'object' || tag === 'embed' || tag === 'link' ||
              tag === 'meta' || tag === 'form' || tag === 'input' ||
              tag === 'button' || tag === 'canvas' || tag === 'svg') {
            continue; /* dropped: executable, network-bearing, or form content */
          }
          state.nodes++;
          if (state.nodes > MAX_HTML_NODES) { state.truncated = true; break; }
          if (tag === 'a') {
            var span = document.createElement('span'); /* links become inert text */
            span.appendChild(clean(k, depth + 1));
            out.appendChild(span);
          } else if (ALLOWED_HTML[tag]) {
            /* allowlisted element, attributes stripped (no href/src/style/events) */
            var n = document.createElement(tag);
            n.appendChild(clean(k, depth + 1));
            out.appendChild(n);
          } else {
            out.appendChild(clean(k, depth + 1)); /* unknown wrapper: keep children only */
          }
        }
      }
      return out;
    }
    var root = sourceDoc.body || sourceDoc.documentElement;
    var frag = clean(root, 0);
    return { frag: frag, truncated: state.truncated };
  }

  function parseCsv(text) {
    /* Bounded: stops after MAX_CSV_ROWS rows, keeps MAX_CSV_COLS columns
       per row and MAX_CSV_FIELD chars per field — never parses all 10 MiB. */
    var rows = [];
    var row = [];
    var field = '';
    var fieldCut = false;
    var quoted = false;
    var truncated = false;
    function pushField() {
      if (row.length < MAX_CSV_COLS) row.push(field);
      else truncated = true; /* extra columns dropped */
      field = '';
      fieldCut = false;
    }
    function pushRow() {
      pushField();
      rows.push(row);
      row = [];
    }
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            if (!fieldCut && field.length < MAX_CSV_FIELD) field += '"';
            else if (!fieldCut) { fieldCut = true; truncated = true; }
            i++;
          } else quoted = false;
        } else if (!fieldCut) {
          if (field.length < MAX_CSV_FIELD) field += c;
          else { fieldCut = true; truncated = true; }
        }
      } else {
        if (c === '"') quoted = true;
        else if (c === ',') pushField();
        else if (c === '\n') {
          pushRow();
          if (rows.length >= MAX_CSV_ROWS) { truncated = true; break; }
        }
        else if (c === '\r') { /* skip, \n handles the break */ }
        else if (!fieldCut) {
          if (field.length < MAX_CSV_FIELD) field += c;
          else { fieldCut = true; truncated = true; }
        }
      }
    }
    if (rows.length < MAX_CSV_ROWS && (row.length || field || !/\n$/.test(text))) pushRow();
    return { rows: rows, truncated: truncated };
  }

  function appendInline(parent, text) {
    /* minimal inline markdown: `code`, **bold**, *italic* — capped at
       MAX_INLINE_NODES nodes per block so a hostile line cannot fork-bomb the DOM */
    var rest = String(text).slice(0, MAX_CSV_FIELD);
    var re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    var last = 0;
    var m;
    var nodes = 0;
    while ((m = re.exec(rest)) !== null) {
      if (nodes >= MAX_INLINE_NODES) break;
      if (m.index > last) {
        parent.appendChild(document.createTextNode(rest.slice(last, m.index)));
        nodes++;
        if (nodes >= MAX_INLINE_NODES) { last = m.index; break; }
      }
      var tok = m[0];
      if (tok[0] === '`') {
        parent.appendChild(el('code', '', tok.slice(1, -1)));
      } else if (tok.slice(0, 2) === '**') {
        parent.appendChild(el('strong', '', tok.slice(2, -2)));
      } else {
        parent.appendChild(el('em', '', tok.slice(1, -1)));
      }
      nodes++;
      last = m.index + tok.length;
    }
    if (last < rest.length && nodes < MAX_INLINE_NODES + 1) {
      parent.appendChild(document.createTextNode(
        nodes >= MAX_INLINE_NODES ? rest.slice(last, last + MAX_CSV_FIELD) : rest.slice(last)));
    }
  }

  function renderMarkdown(text) {
    var wrap = el('div', 'document-reader-doc');
    var lines = String(text).split('\n');
    var list = null;
    var fence = null;
    var fenceChars = 0;
    var blocks = 0;
    var truncated = false;
    function pushBlock() {
      blocks++;
      if (blocks > MAX_BLOCKS) { truncated = true; return false; }
      return true;
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if(line.length>MAX_CSV_FIELD){line=line.slice(0,MAX_CSV_FIELD);truncated=true;}
      if (/^```/.test(line)) {
        if (fence) {
          if (!pushBlock()) break;
          wrap.appendChild(el('pre', 'document-reader-text', fence.join('\n')));
          fence = null;
        } else fence = [];
        continue;
      }
      if (fence) {
        /* cap fenced code: lines and chars stay bounded even mid-fence */
        if (fence.length < MAX_ROWS_PER_SHEET && fenceChars < MAX_TEXT_RETURN) {
          fence.push(line.slice(0, MAX_CSV_FIELD));
          fenceChars += line.length + 1;
        } else truncated = true;
        continue;
      }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        list = null;
        if (!pushBlock()) break;
        var p = el('h' + h[1].length, '');
        appendInline(p, h[2]);
        wrap.appendChild(p);
        continue;
      }
      var li = /^(\s*)[-*]\s+(.*)$/.exec(line);
      if (li) {
        if (!pushBlock()) break; /* every list item counts */
        if (!list) { list = el('ul', 'document-reader-list'); wrap.appendChild(list); }
        var item = el('li', '');
        appendInline(item, li[2]);
        list.appendChild(item);
        continue;
      }
      if (/^\s*$/.test(line)) { list = null; continue; }
      list = null;
      if (!pushBlock()) break;
      var para = el('p', '');
      appendInline(para, line);
      wrap.appendChild(para);
    }
    if (fence && blocks < MAX_BLOCKS) {
      blocks++;
      wrap.appendChild(el('pre', 'document-reader-text', fence.join('\n')));
    } else if (fence) truncated = true;
    if (truncated) wrap.appendChild(note('Truncated: showing the first ' + MAX_BLOCKS + ' blocks, not the whole document.'));
    if (!wrap.childNodes.length) wrap.appendChild(el('pre', 'document-reader-text', String(text).slice(0, MAX_CSV_FIELD)));
    return wrap;
  }

  function renderTextFormat(format, bytes, title) {
    var text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        text = new TextDecoder('windows-1252').decode(bytes);
      } catch (e2) {
        throw new Error(title + ': not decodable text.');
      }
    }
    var textTruncated = format!=='csv' && text.length>MAX_TEXT_RETURN;
    if(textTruncated) text=text.slice(0,MAX_TEXT_RETURN);
    var wrap = el('div', 'document-reader-doc');
    if (format === 'markdown') {
      wrap.appendChild(renderMarkdown(text));
    } else if (format === 'html') {
      var parsed;
      try {
        parsed = new DOMParser().parseFromString(text, 'text/html');
      } catch (e) {
        throw new Error(title + ': malformed HTML.');
      }
      wrap.appendChild(note('Simplified preview: scripts, images and links removed.'));
      var clean = sanitizeHtml(parsed);
      wrap.appendChild(clean.frag);
      if (clean.truncated) {
        wrap.appendChild(note('Truncated: showing the first ' + MAX_HTML_NODES + ' elements, not the whole page.'));
      }
    } else if (format === 'csv') {
      var parsedCsv = parseCsv(text);
      var shown = parsedCsv.rows.slice(0, MAX_ROWS_PER_SHEET);
      var table = el('table', 'document-reader-table');
      for (var i = 0; i < shown.length; i++) {
        var tr = el('tr', '');
        for (var j = 0; j < shown[i].length; j++) tr.appendChild(el('td', '', shown[i][j]));
        table.appendChild(tr);
      }
      wrap.appendChild(table);
      if (parsedCsv.truncated) {
        wrap.appendChild(note('Truncated: showing ' + shown.length + ' rows × up to ' + MAX_CSV_COLS + ' columns (' + MAX_CSV_FIELD + ' chars per field); the rest was not parsed.'));
      }
    } else if (format === 'json' && !textTruncated) {
      var pretty = null;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch (e) {
        pretty = null;
      }
      if (pretty === null) {
        wrap.appendChild(note('Not strictly valid JSON; showing raw text.'));
        wrap.appendChild(el('pre', 'document-reader-text', text));
      } else {
        wrap.appendChild(el('pre', 'document-reader-text', pretty.slice(0,MAX_TEXT_RETURN)));
        if(pretty.length>MAX_TEXT_RETURN) wrap.appendChild(note('Truncated: large formatted JSON preview.'));
      }
    } else {
      wrap.appendChild(el('pre', 'document-reader-text', text));
    }
    if(textTruncated) wrap.appendChild(note('Truncated: showing the first '+MAX_TEXT_RETURN+' characters; the complete file remains unchanged.'));
    return { node: wrap, text: text };
  }

  /* ---------------- PDF: one page at a time ---------------- */
  function pdfPageText(items) {
    var lines = [];
    var lastY = null;
    var line = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var s = it.str || '';
      var y = it.transform ? it.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line) {
        lines.push(line);
        line = '';
      }
      if (s) line += (/[ \t]$/.test(line) || !line) ? s : ' ' + s;
      if (y !== null) lastY = y;
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  function renderPdfInto(a, token, lib, data, preview, setStatus, title) {
    var cancelled = function () { return token !== generation; };
    var params = { data: data };
    try { params.isEvalSupported = false; } catch (e) {} /* CSP: no unsafe-eval fallback */
    try { params.isOffscreenCanvasSupported = false; } catch (e) {}
    /* Local-only rendering data (vendored by scripts/sync-document-vendor.mjs):
       no CDN, so CJK CMaps and standard fonts render offline. */
    try { params.cMapUrl = SCRIPT_BASE + 'vendor/documents/cmaps/'; } catch (e) {}
    try { params.cMapPacked = true; } catch (e) {}
    try { params.standardFontDataUrl = SCRIPT_BASE + 'vendor/documents/standard_fonts/'; } catch (e) {}
    return lib.getDocument(params).promise.then(function (pdfDoc) {
      if (cancelled()) {
        try { if (pdfDoc.destroy) pdfDoc.destroy(); } catch (e) {}
        return { superseded: true };
      }
      a.pdfDoc = pdfDoc;
      var total = pdfDoc.numPages || 0;
      if (!total) throw new Error(title + ': PDF has no pages.');
      var refs = { page: 1, total: total, firstText: '' };

      var root = el('div', 'document-reader-pdf');
      var pager = el('div', 'document-reader-pdf-pager');
      var prev = el('button', 'document-reader-btn', '‹ Previous');
      prev.type = 'button';
      var count = el('span', 'document-reader-pdf-count', 'Page 1 of ' + total);
      var next = el('button', 'document-reader-btn', 'Next ›');
      next.type = 'button';
      pager.appendChild(prev);
      pager.appendChild(count);
      pager.appendChild(next);
      var canvas = document.createElement('canvas');
      canvas.className = 'document-reader-pdf-canvas';
      var textWrap = el('div', 'document-reader-pdf-textwrap');
      var textLabel = el('div', 'document-reader-note', 'Selectable page text:');
      var textDiv = el('div', 'document-reader-pdf-text', '');
      textWrap.appendChild(textLabel);
      textWrap.appendChild(textDiv);
      root.appendChild(pager);
      root.appendChild(canvas);
      root.appendChild(textWrap);
      clearEl(preview);
      preview.appendChild(root);

      function paintButtons() {
        prev.disabled = refs.page <= 1;
        next.disabled = refs.page >= refs.total;
        count.textContent = 'Page ' + refs.page + ' of ' + refs.total;
      }

      var renderSeq = 0; /* per-render generation: only the latest render paints */
      function renderPage(n) {
        if (cancelled() || !a.pdfDoc) return Promise.resolve();
        if (a.renderTask) {
          try { a.renderTask.cancel(); } catch (e) {}
          a.renderTask = null;
        }
        var want = Math.min(Math.max(1, n), refs.total);
        var seq = ++renderSeq;
        var stale = function () { return cancelled() || seq !== renderSeq || !a.pdfDoc; };
        refs.page = want;
        paintButtons();
        setStatus('Loading ' + title + ' — page ' + refs.page + ' of ' + refs.total + '…');
        var doc = a.pdfDoc;
        return doc.getPage(want).then(function (page) {
          if (stale()) return;
          var base = page.getViewport({ scale: 1 });
          var avail = (preview && preview.clientWidth ? preview.clientWidth : 640) - 2;
          if (!(avail > 100)) avail = 640;
          var fit = avail / base.width;
          var maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
          var scale = Math.min(fit, maxScale);
          if (!(scale > 0.05)) scale = 0.05;
          var viewport = page.getViewport({ scale: scale });
          var ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) throw new Error(title + ': 2D canvas unavailable.');
          canvas.width = Math.max(1,Math.floor(viewport.width));
          canvas.height = Math.max(1,Math.floor(viewport.height));
          var task = page.render({ canvasContext: ctx, viewport: viewport });
          a.renderTask = task;
          return task.promise.then(function () {
            if (stale()) return;
            if (a.renderTask === task) a.renderTask = null;
            return page.getTextContent().then(function (tc) {
              if (stale()) return;
              var t = pdfPageText(tc.items || []);
              if (want === 1) refs.firstText = t; /* tied to the requested page, not the current one */
              clearEl(textDiv);
              textDiv.appendChild(document.createTextNode(t || '(no selectable text on this page)'));
              paintButtons();
              setStatus(title + ' — page ' + refs.page + ' of ' + refs.total);
            }, function () {
              if (stale()) return;
              clearEl(textDiv);
              textDiv.appendChild(document.createTextNode('(page text unavailable)'));
              setStatus(title + ' — page ' + refs.page + ' of ' + refs.total);
            });
          }, function (err) {
            if (a.renderTask === task) a.renderTask = null;
            if (err && err.name === 'RenderingCancelledException') return;
            throw err;
          });
        });
      }

      prev.addEventListener('click', function () {
        if (refs.page > 1) renderPage(refs.page - 1).catch(function (err) {
          if (!cancelled()) setStatus('Page failed: ' + (err && err.message ? err.message : err));
        });
      });
      next.addEventListener('click', function () {
        if (refs.page < refs.total) renderPage(refs.page + 1).catch(function (err) {
          if (!cancelled()) setStatus('Page failed: ' + (err && err.message ? err.message : err));
        });
      });

      if ('ResizeObserver' in window) {
        try {
          var lastWidth = preview && preview.clientWidth ? preview.clientWidth : 0;
          a.ro = new ResizeObserver(function () {
            if (cancelled() || !a.pdfDoc) return;
            /* Width-only: our own canvas height writes must not re-trigger a refit loop. */
            var w = preview && preview.clientWidth ? preview.clientWidth : 0;
            if (Math.abs(w - lastWidth) < 2) return;
            lastWidth = w;
            clearTimeout(a.timer);
            a.timer = setTimeout(function () {
              if (cancelled() || !a.pdfDoc) return;
              lastWidth = preview && preview.clientWidth ? preview.clientWidth : lastWidth;
              renderPage(refs.page).catch(function () { /* keep old pixels on resize failure */ });
            }, RESIZE_DEBOUNCE_MS);
          });
          a.ro.observe(preview);
        } catch (e) { /* resize refit best-effort */ }
      }

      return renderPage(1).then(function () {
        if (cancelled()) return { superseded: true };
        return { refs: refs };
      });
    });
  }

  /* ---------------- source bytes ---------------- */
  function fetchUrlBytes(a, token, url, apiUrl, setStatus) {
    var endpoint;
    var direct = false;
    if (isStandalone()) {
      direct = true;
    } else if (typeof apiUrl === 'function') {
      endpoint = apiUrl('/api/doc/source?url=' + encodeURIComponent(url));
    } else {
      return Promise.reject(new Error('Remote documents need the document source endpoint.'));
    }
    var target = direct ? url : endpoint;
    setStatus('Fetching ' + url + '…');
    var opts = {};
    if (a.abort) opts.signal = a.abort.signal;
    var p;
    if (direct) {
      p = fetch(target, opts).catch(function (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new Error('Standalone direct fetch failed (likely CORS or offline): ' +
          (err && err.message ? err.message : err) + '. No cloud conversion is attempted.');
      });
    } else {
      p = fetch(target, opts);
    }
    return p.then(function (res) {
      if (!res || !res.ok) {
        throw new Error('Download failed (HTTP ' + (res ? res.status : 'unknown') + ').');
      }
      var len = null;
      try {
        var h = res.headers ? res.headers.get('content-length') : null;
        if (h) len = parseInt(h, 10);
      } catch (e) {}
      if (len !== null && len > MAX_BYTES) {
        throw new Error('Remote file exceeds the 10 MiB cap.');
      }
      if (!res.body || typeof res.body.getReader !== 'function') {
        return res.arrayBuffer();
      }
      /* Streamed when Content-Length is absent/untrusted: stop at 10 MiB + 1
         and cancel the connection instead of buffering an unbounded body. */
      var reader = res.body.getReader();
      var chunks = [];
      var size = 0;
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) return null;
          var v = step.value;
          if (v && v.byteLength) {
            size += v.byteLength;
            if (size > MAX_BYTES) {
              try { reader.cancel(); } catch (e) {}
              throw new Error('Remote file exceeds the 10 MiB cap.');
            }
            chunks.push(v);
          }
          return pump();
        });
      }
      return pump().then(function () {
        try { reader.releaseLock(); } catch (e) {}
        var out = new Uint8Array(size);
        var off = 0;
        for (var i = 0; i < chunks.length; i++) {
          out.set(chunks[i], off);
          off += chunks[i].byteLength;
        }
        return out.buffer;
      }, function (err) {
        try { reader.releaseLock(); } catch (e) {}
        throw err;
      });
    }).then(function (buf) {
      if (!buf || !buf.byteLength) throw new Error('Empty response.');
      if (buf.byteLength > MAX_BYTES) throw new Error('Remote file exceeds the 10 MiB cap.');
      return buf;
    });
  }

  /* ---------------- read / close ---------------- */
  function read(opts) {
    opts = opts || {};
    var preview = opts.preview || null;
    var status = opts.status || null;
    var file = opts.file || null;
    var url = opts.url || null;
    var apiUrl = opts.apiUrl || null;

    var token = ++generation;
    if (active) { teardown(active); active = null; }
    var a = {
      gen: token,
      abort: null,
      pdfDoc: null,
      renderTask: null,
      ro: null,
      timer: 0
    };
    try {
      if (typeof AbortController !== 'undefined') a.abort = new AbortController();
    } catch (e) {}
    active = a;
    lastPreview = preview;
    lastStatus = status;

    var cancelled = function () { return token !== generation; };
    function setStatus(msg) {
      if (cancelled()) return;
      if (status) status.textContent = msg || '';
    }
    function failResult(title, format, msg) {
      if (cancelled()) return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
      teardown(a);
      if (active === a) active = null;
      clearEl(preview);
      setStatus(msg);
      return { ok: false, title: title, format: format, error: msg };
    }

    if (!preview) {
      return Promise.resolve({ ok: false, title: '', format: '', error: 'no preview element provided' });
    }
    if (!file && !url) {
      var t0 = 'document';
      clearEl(preview);
      setStatus('Nothing to open: provide a file or a URL.');
      return Promise.resolve({ ok: false, title: t0, format: '', error: 'no file or URL provided' });
    }

    var title = titleOf(file, url);
    var format = formatOf(file ? file.name : url);
    if (!format) {
      var guess = extOf(file ? file.name : url);
      return Promise.resolve(failResult(title, guess || 'unknown',
        title + ': unsupported format' + (guess ? ' (.' + guess + ')' : '') +
        '. Viewable: PDF, DOCX, ODT, XLSX, PPTX, TXT, MD, HTML, CSV, JSON.'));
    }

    setStatus('Loading ' + title + '…');
    clearEl(preview);

    var bytesPromise;
    if (file) {
      try {
        if (typeof file.size === 'number' && file.size > MAX_BYTES) {
          return Promise.resolve(failResult(title, format, title + ': file exceeds the 10 MiB cap.'));
        }
        if (typeof file.arrayBuffer !== 'function') {
          return Promise.resolve(failResult(title, format, title + ': file cannot be read locally.'));
        }
      } catch (e) {
        return Promise.resolve(failResult(title, format, title + ': unreadable file.'));
      }
      bytesPromise = Promise.resolve().then(function () {
        /* Local files are read in place and never uploaded anywhere. */
        return file.arrayBuffer();
      }).then(function (buf) {
        if (!buf || !buf.byteLength) throw new Error(title + ': empty file.');
        if (buf.byteLength > MAX_BYTES) throw new Error(title + ': file exceeds the 10 MiB cap.');
        return buf;
      });
    } else {
      bytesPromise = fetchUrlBytes(a, token, url, apiUrl, setStatus);
    }

    return bytesPromise.then(function (buf) {
      if (cancelled()) return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
      var bytes = new Uint8Array(buf);

      if (format === 'pdf') {
        return loadPdfLib().then(function (lib) {
          if (cancelled()) return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
          return renderPdfInto(a, token, lib, bytes, preview, setStatus, title).then(function (r) {
            if (!r || r.superseded) {
              return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
            }
            return { ok: true, title: title, format: format, text: boundText(r.refs.firstText || '') };
          });
        });
      }

      if (format === 'docx' || format === 'odt' || format === 'xlsx' || format === 'pptx') {
        return loadFflate().then(function (fflate) {
          if (cancelled()) return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
          var wanted = function (name) {
            if (format === 'docx') return name === WORD_NS_HINT;
            if (format === 'odt') return name === 'content.xml';
            if (format === 'xlsx') {
              return name === 'xl/sharedStrings.xml' || name === 'xl/workbook.xml' ||
                isSheetFile(name, 'xl/worksheets/sheet') > 0;
            }
            return name === 'ppt/presentation.xml' || isSheetFile(name, 'ppt/slides/slide') > 0;
          };
          return unzipSelected(fflate, bytes, wanted).then(function (entries) {
            if (cancelled()) return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
            var r;
            if (format === 'docx') {
              if (!entries[WORD_NS_HINT]) throw new Error(title + ': no readable document body (not a DOCX?).');
              r = renderDocx(entries[WORD_NS_HINT]);
            } else if (format === 'odt') {
              if (!entries['content.xml']) throw new Error(title + ': no content found (not an ODT?).');
              r = renderOdt(entries['content.xml']);
            } else if (format === 'xlsx') {
              r = renderXlsx(entries);
            } else {
              r = renderPptx(entries);
            }
            if (cancelled()) return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
            teardown(a);
            if (active === a) active = null;
            clearEl(preview);
            preview.appendChild(r.node);
            setStatus(title);
            return { ok: true, title: title, format: format, text: boundText(r.text || '') };
          });
        });
      }

      /* text formats render client-side; local text works standalone too */
      var r = renderTextFormat(format, bytes, title);
      if (cancelled()) return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
      teardown(a);
      if (active === a) active = null;
      clearEl(preview);
      preview.appendChild(r.node);
      setStatus(title);
      return { ok: true, title: title, format: format, text: boundText(r.text || '') };
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, title: title, format: format, error: 'cancelled' };
      }
      if (cancelled()) {
        return { ok: false, title: title, format: format, error: 'superseded by a newer request' };
      }
      return failResult(title, format, err && err.message ? err.message : String(err));
    });
  }

  function close() {
    generation++;
    if (active) { teardown(active); active = null; }
    if (lastPreview) clearEl(lastPreview);
    if (lastStatus) {
      try { lastStatus.textContent = ''; } catch (e) {}
    }
    lastPreview = null;
    lastStatus = null;
  }

  if (typeof window !== 'undefined') {
    window.ProfilesDocumentReader = {
      supports: supports,
      read: read,
      close: close
    };
  }
})();
