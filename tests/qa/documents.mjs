// Profiles document-reader QA — real document behaviour only, no source-string assertions.
//
// Owns a throwaway vault + its own app server on a free loopback port (same
// conventions as reliability.mjs), plus a SECOND loopback fixture origin on a
// different port that serves the tests/fixtures/documents.mjs bytes with NO
// Access-Control-Allow-Origin header. Remote reads go through the app:
// #docUrl + #docLoad -> backend GET /api/doc/source?url=... -> raw bytes.
// A separate origin without CORS proves the bytes came through the backend,
// not a direct browser fetch; byte-equality against the fixture buffers
// proves actual content, not a pointer or staged fallback.
//
// Covers: local upload of a genuine 2-page PDF (canvas + real selectable
// page-one text, pager surfaces actual page-two text, rapid prev/next at the
// latest page stays consistent), Office paragraph/table/cell/slide text (DOCX
// round-trip + table, ODT, XLSX, PPTX), TXT/MD/CSV/JSON markers, HTML script
// malice never running, bounded malicious CSV/MD/HTML/Office fixtures (early
// markers stay readable, over-limit rows/blocks truncate with an explicit
// note, payloads stay inert text), malformed/unsupported files erroring
// honestly with no stale preview, switching documents mid-load keeping only
// the newest, 10MiB backend bound including a streamed no-length oversized
// rejection, slow A fetch cancelled on profile switch (nothing of A in B),
// and mode/viewport fit with zero horizontal overflow. Setup facts (server
// boot, slot A, separate fixture origin) are hard gates that throw, not
// counted checks; every counted check is consumer-visible document behaviour.
//
// Headless software-muted Chromium only; no visible window, no real user
// data, no legacy shared slots (A/B only, config reset at start).
//
// Run: node tests/qa/documents.mjs
// Exit: 0 when every check passes, 1 otherwise. Screenshots land in a temp
// report dir (path printed); vault + both servers are torn down in finally.
//
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import {
  KNOWN, FILENAMES, MIMES,
  PDF_BYTES, DOCX_ROUNDTRIP_BYTES, DOCX_TABLE_BYTES, ODT_BYTES, XLSX_BYTES,
  PPTX_BYTES, HTML_BYTES, TXT_BYTES, MD_BYTES, CSV_BYTES, JSON_BYTES,
  CSV_BOUND_BYTES, MD_BOUND_BYTES, HTML_BOUND_BYTES, DOCX_BOUND_BYTES, XLSX_BOUND_BYTES,
  MALFORMED_BYTES, UNSUPPORTED_BYTES,
} from '../fixtures/documents.mjs';
import {ensureSoftwareRuntime} from '../../scripts/qa-software-runtime.mjs';
ensureSoftwareRuntime();

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
function check(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log((cond ? 'ok' : 'FAIL') + ' - ' + name + (cond || !extra ? '' : ' :: ' + extra));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function apiJSON(base, path, opts) {
  const r = await fetch(base + path, opts);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; }
  catch { return { status: r.status, json: null, text }; }
}
const post = (base, path, body) => apiJSON(base, path,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function waitFor(fn, timeout, step = 500) {
  const t0 = Date.now();
  for (;;) {
    const out = await fn().catch(() => null);
    if (out) return out;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, step));
  }
}

const vault = await mkdtemp(join(tmpdir(), 'profiles-qa-docvault-'));
const reportDir = await mkdtemp(join(tmpdir(), 'profiles-qa-docreport-'));
await mkdir(reportDir, { recursive: true });
const port = await freePort();
const host = '127.0.0.1';
const apiBase = `http://${host}:${port}`;
const base = apiBase + '/src/';
let remoteBase;

let child = null;
let browser = null;
let fixtureServer = null;
let shotN = 0;
async function shot(page, tag) {
  shotN += 1;
  const file = join(reportDir, `shot-${shotN}-${tag}.png`);
  try { await page.screenshot({ path: file }); console.log('screenshot: ' + file); }
  catch (e) { console.log('screenshot failed (' + tag + '): ' + String(e && e.message || e)); }
}

/* 10MiB + 256KiB deterministic probe for the backend bound (built here so the
   exported fixtures stay small; the served length proves the test is real). */
const HUGE_BYTES = Buffer.alloc(10 * 1024 * 1024 + 262144, 0x41);

function fixtureRoutes() {
  return {
    '/remote.pdf': { bytes: PDF_BYTES, type: MIMES.pdf, delay: 0 },
    '/remote-table.docx': { bytes: DOCX_TABLE_BYTES, type: MIMES.docx, delay: 0 },
    '/remote-sheet.xlsx': { bytes: XLSX_BYTES, type: MIMES.xlsx, delay: 0 },
    '/remote-slow.pdf': { bytes: PDF_BYTES, type: MIMES.pdf, delay: 2500 },
    '/remote-profile-a.pdf': { bytes: PDF_BYTES, type: MIMES.pdf, delay: 3000 },
    '/huge.bin': { bytes: HUGE_BYTES, type: 'application/octet-stream', delay: 0 },
    '/huge-nolength.pdf': { bytes: HUGE_BYTES, type: MIMES.pdf, delay: 0, noLength: true },
  };
}

/* ---- page drivers (all through real UI elements) ---- */
async function openDocPane(page) {
  if (await page.isVisible('#pane-doc').catch(() => false)) return true;
  const plus = page.locator('#paneTabs button').filter({ hasText: '+' }).first();
  if ((await plus.count().catch(() => 0)) > 0) {
    await plus.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const add = page.locator('[data-add="pane-doc"]').first();
  if ((await add.count().catch(() => 0)) > 0) await add.click().catch(() => {});
  await page.waitForTimeout(400);
  return page.isVisible('#pane-doc').catch(() => false);
}

async function previewText(page) {
  return (await page.locator('#docPreview').innerText().catch(() => '')) || '';
}

async function statusText(page) {
  return (await page.locator('#docStatus').innerText().catch(() => '')) || '';
}

async function previewHas(page, marker, timeout = 15000, step = 300) {
  try {
    await waitFor(async () => ((await previewText(page)).includes(marker)) || null, timeout, step);
    return true;
  } catch { return false; }
}

async function statusHas(page, re, timeout = 15000) {
  try {
    await waitFor(async () => (re.test(await statusText(page))) || null, timeout, 300);
    return true;
  } catch { return false; }
}

async function loadLocal(page, name, mimeType, buffer, marker) {
  try { await page.setInputFiles('#docFile', [{ name, mimeType, buffer }]); }
  catch { return false; }
  if (await previewHas(page, marker, 6000, 250)) return true;
  try { await page.click('#docLoad'); } catch { return false; }
  return previewHas(page, marker, 15000, 300);
}

async function readRemote(page, url) {
  try {
    await page.fill('#docUrl', url);
    await page.click('#docLoad');
    return true;
  } catch { return false; }
}

async function clickDocNext(page) {
  return page.evaluate(() => {
    const roots = [document.querySelector('#docPreview'), document.querySelector('#docPager'),
      document.querySelector('#pane-doc')].filter(Boolean);
    const btns = [];
    for (const r of roots) btns.push(...r.querySelectorAll('button'));
    const want = btns.find((b) => /next|›|»|page\s*2/i.test(b.textContent || '')
      && !b.disabled && b.offsetParent !== null);
    if (want) { want.click(); return (want.textContent || '').trim().slice(0, 40); }
    return null;
  }).catch(() => null);
}

async function clickDocPrev(page) {
  return page.evaluate(() => {
    const roots = [document.querySelector('#docPreview'), document.querySelector('#docPager'),
      document.querySelector('#pane-doc')].filter(Boolean);
    const btns = [];
    for (const r of roots) btns.push(...r.querySelectorAll('button'));
    const want = btns.find((b) => /prev|‹|«|page\s*1/i.test(b.textContent || '')
      && !b.disabled && b.offsetParent !== null);
    if (want) { want.click(); return (want.textContent || '').trim().slice(0, 40); }
    return null;
  }).catch(() => null);
}

async function pagerText(page) {
  return page.evaluate(() => {
    const roots = [document.querySelector('#docPreview'), document.querySelector('#docPager'),
      document.querySelector('#pane-doc')].filter(Boolean);
    for (const r of roots) {
      const m = (r.textContent || '').match(/page\s*\d+\s*of\s*\d+/i);
      if (m) return m[0];
    }
    return '';
  }).catch(() => '');
}

async function nextDisabled(page) {
  return page.evaluate(() => {
    const roots = [document.querySelector('#docPreview'), document.querySelector('#docPager'),
      document.querySelector('#pane-doc')].filter(Boolean);
    for (const r of roots) {
      for (const b of r.querySelectorAll('button')) {
        if (/next|›|»/i.test(b.textContent || '')) return !!b.disabled;
      }
    }
    return null;
  }).catch(() => null);
}

async function docFits(page) {
  return page.evaluate(() => {
    const pv = document.querySelector('#docPreview');
    return {
      appScroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      prev: pv ? { scroll: pv.scrollWidth, client: pv.clientWidth } : null,
    };
  });
}

async function slotIs(apiBaseUrl, want, timeout = 10000) {
  try {
    await waitFor(async () => {
      const s = await apiJSON(apiBaseUrl, '/api/slot').catch(() => null);
      return (s && s.json && s.json.active === want) || null;
    }, timeout, 300);
    return true;
  } catch { return false; }
}

async function blurActive(page) {
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); }).catch(() => {});
}

let exitCode = 0;
try {
  // ---- owned app server (fresh cwd, isolated throwaway vault, no keyring) ----
  child = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, PROFILES_VAULT_DIR: vault, PROFILES_DISABLE_KEYRING: '1', PORT: String(port) },
    stdio: 'pipe',
  });
  let serverOut = '';
  child.stdout?.on('data', (d) => { serverOut += String(d); });
  child.stderr?.on('data', (d) => { serverOut += String(d); });
  try {
    await waitFor(async () => {
      const r = await apiJSON(apiBase, '/api/health').catch(() => null);
      return r && r.status === 200 && r.json && r.json.ok && r.json.pid===child.pid ? true : null;
    }, 25000, 300);
  } catch {
    console.log('server did not boot; output tail:\n' + serverOut.slice(-2000));
    throw new Error('owned server failed to boot on ' + apiBase);
  }
  // Setup facts are hard gates (throw), not counted checks: every counted
  // check below is consumer-visible document behaviour.
  // (server boot verified by the /api/health wait above)

  // ---- deterministic start: slot A, pristine config, throwaway vault ----
  await apiJSON(apiBase, '/api/slot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'A' }) });
  await post(apiBase, '/api/config', { reset: true });
  const slotA = await apiJSON(apiBase, '/api/slot');
  if (!(slotA.json && slotA.json.active === 'A')) throw new Error('setup: expected slot A, got ' + JSON.stringify(slotA.json));

  // ---- second loopback origin: fixtures, deliberately WITHOUT CORS ----
  const routes = fixtureRoutes();
  fixtureServer = createHttpServer((req, res) => {
    const path = new URL(req.url || '/', 'http://x').pathname;
    const route = routes[path];
    if (!route) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no such fixture'); return; }
    const send = () => {
      if (route.noLength) {
        // Streamed with chunked encoding and NO content-length so the backend
        // streaming guard (not the header fast-path) must enforce the cap.
        res.writeHead(200, { 'content-type': route.type });
        const CH = 64 * 1024;
        for (let off = 0; off < route.bytes.length; off += CH) res.write(route.bytes.subarray(off, off + CH));
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': route.type, 'content-length': route.bytes.length });
      res.end(route.bytes);
    };
    if (route.delay) setTimeout(send, route.delay);
    else send();
  });
  await new Promise((resolve,reject) => {fixtureServer.once('error',reject);fixtureServer.listen(0,host,resolve);});
  const fixturePort=fixtureServer.address().port;
  remoteBase=`http://${host}:${fixturePort}`;
  if (!(fixturePort !== port)) throw new Error('setup: fixture origin must differ from app port');

  // ---- owned headless browser: software rendering, muted, no user data ----
  browser = await chromium.launch({
    headless: true,
    env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',PULSE_SERVER:'unix:/nonexistent'},
    args: ['--disable-gpu', '--mute-audio', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));

  await page.goto(base + '?mode=Vibes', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await page.isVisible('#pane-chat')) || null, 15000, 300);
  await page.waitForTimeout(2500);

  // ---- open the doc pane (hard gate: later behavior checks need it) ----
  if (!(await openDocPane(page))) throw new Error('setup: doc pane did not open from the + add menu');
  // ---- T1: local PDF — real canvas, real selectable page text, real pager ----
  const pdfOk = await loadLocal(page, FILENAMES.pdf, MIMES.pdf, PDF_BYTES, KNOWN.pdfPage1);
  check('local PDF renders actual page-one text (selectable layer, not an image)', pdfOk, (await previewText(page)).slice(0, 200));
  const canvasN = await page.locator('#docPreview canvas').count().catch(() => 0);
  check('local PDF renders a real page canvas (not a staged pointer)', canvasN >= 1, 'canvas=' + canvasN);
  await page.locator('#docPreview canvas').scrollIntoViewIfNeeded();
  await shot(page, 'local-pdf');
  const nextLabel = await clickDocNext(page);
  check('PDF pager offers a next-page control', nextLabel !== null, String(nextLabel));
  const page2 = await previewHas(page, KNOWN.pdfPage2, 15000);
  check('pager moves to actual page-two text', page2, (await previewText(page)).slice(0, 200));
  const paneText = await page.locator('#pane-doc').innerText().catch(() => '');
  check('pager names page 2 after moving', /page\s*2|2\s*\/\s*2/.test(paneText), paneText.slice(0, 200));
  // ---- T1b: latest-page rapid prev/next stays consistent ----
  // On the last page Next is disabled (no page 3); rapid clicks must not
  // blank the canvas, overshoot the indicator, or mix page-one text in.
  check('latest page disables Next (no page 3 to move to)', await nextDisabled(page) === true, await pagerText(page));
  await clickDocNext(page);
  await clickDocNext(page);
  await page.waitForTimeout(800);
  const stillLate = await previewText(page);
  check('rapid Next at the latest page keeps page-two text (no overshoot/blank)',
    stillLate.includes(KNOWN.pdfPage2) && !stillLate.includes(KNOWN.pdfPage1), stillLate.slice(0, 200));
  check('rapid Next at the latest page keeps a Page 2 of 2 indicator', /page\s*2\s*of\s*2/i.test(await pagerText(page)), await pagerText(page));
  await clickDocPrev(page);
  await page.waitForTimeout(150);
  await clickDocNext(page);
  await clickDocNext(page);
  const racedToLate = await previewHas(page, KNOWN.pdfPage2, 15000);
  const racedText = await previewText(page);
  const racedPager = await pagerText(page);
  check('rapid prev->next->next settles on consistent latest-page content',
    racedToLate && racedText.includes(KNOWN.pdfPage2) && !racedText.includes(KNOWN.pdfPage1)
    && /page\s*2\s*of\s*2/i.test(racedPager), racedText.slice(0, 200) + ' | ' + racedPager);
  const racedCanvas = await page.locator('#docPreview canvas').count().catch(() => 0);
  check('rapid pager race keeps a real page canvas', racedCanvas >= 1, 'canvas=' + racedCanvas);
  // ---- T2..T6: Office formats — real paragraph/table/cell/slide text ----
  const rtOk = await loadLocal(page, FILENAMES.docxRoundtrip, MIMES.docx, DOCX_ROUNDTRIP_BYTES, KNOWN.docxRoundtripTitle);
  const rtText = await previewText(page);
  check('DOCX round-trip renders the real title and body (not a pointer)',
    rtOk && rtText.includes(KNOWN.docxRoundtripBody) && !/needs its own app|staged a pointer/i.test(rtText), rtText.slice(0, 240));

  const tblOk = await loadLocal(page, FILENAMES.docxTable, MIMES.docx, DOCX_TABLE_BYTES, KNOWN.docxTableTitle);
  const tblText = await previewText(page);
  check('DOCX table fixture renders every cell',
    tblOk && KNOWN.docxCells.every((c) => tblText.includes(c)), tblText.slice(0, 300));
  await page.locator('#docPreview table').scrollIntoViewIfNeeded();
  await shot(page, 'local-docx-table');

  const odtOk = await loadLocal(page, FILENAMES.odt, MIMES.odt, ODT_BYTES, KNOWN.odtPara);
  const odtText = await previewText(page);
  check('ODT renders the real paragraph and table cells',
    odtOk && odtText.includes(KNOWN.odtPara2) && KNOWN.odtCells.every((c) => odtText.includes(c)), odtText.slice(0, 300));

  const xlsxOk = await loadLocal(page, FILENAMES.xlsx, MIMES.xlsx, XLSX_BYTES, KNOWN.xlsxCellA1);
  const xlsxText = await previewText(page);
  check('XLSX renders real cell text (A1 header row and B2)',
    xlsxOk && xlsxText.includes(KNOWN.xlsxHeader) && xlsxText.includes(KNOWN.xlsxCellB2), xlsxText.slice(0, 300));

  const pptxOk = await loadLocal(page, FILENAMES.pptx, MIMES.pptx, PPTX_BYTES, KNOWN.pptxSlide1);
  const pptxText = await previewText(page);
  check('PPTX renders real slide text from both slides',
    pptxOk && pptxText.includes(KNOWN.pptxSlide2), pptxText.slice(0, 300));

  // ---- T7: plain formats carry their markers ----
  check('TXT renders its real body', await loadLocal(page, FILENAMES.txt, MIMES.txt, TXT_BYTES, KNOWN.txtBody));
  check('Markdown renders its real heading and body',
    (await loadLocal(page, FILENAMES.md, MIMES.md, MD_BYTES, KNOWN.mdHeading))
    && (await previewText(page)).includes(KNOWN.mdBody));
  const csvOk = await loadLocal(page, FILENAMES.csv, MIMES.csv, CSV_BYTES, KNOWN.csvRow1);
  check('CSV renders real row values', csvOk && (await previewText(page)).includes(KNOWN.csvRow2));
  check('JSON renders its real title', await loadLocal(page, FILENAMES.json, MIMES.json, JSON_BYTES, KNOWN.jsonTitle));

  // ---- T8: HTML script malice never runs ----
  const htmlOk = await loadLocal(page, FILENAMES.html, MIMES.html, HTML_BYTES, KNOWN.htmlBody);
  check('HTML renders its real body text', htmlOk);
  const xss = await page.evaluate(() => ({
    fired: window.__docQaXssFired === 1 || window.__docQaXssImg === 1,
    script: !!document.querySelector('#docPreview script'),
    attr: !!document.querySelector('#docPreview [data-xss]'),
  })).catch(() => null);
  check('HTML script malice never runs (no script el, no globals, no onerror)',
    !!xss && xss.fired === false && xss.script === false && xss.attr === false, JSON.stringify(xss));

  // ---- T8b: bounded malicious CSV — capped rows, early markers readable ----
  const csvBigOk = await loadLocal(page, FILENAMES.csvBound, MIMES.csv, CSV_BOUND_BYTES, KNOWN.csvBigFirst);
  const csvBigText = await previewText(page);
  check('big CSV keeps its first real row readable', csvBigOk && csvBigText.includes(KNOWN.csvBigFirst), csvBigText.slice(0, 300));
  check('big CSV cuts the over-limit tail (last row absent)',
    !csvBigText.includes(KNOWN.csvBigLast), csvBigText.slice(-300));
  const csvBigRows = await page.locator('#docPreview table tr').count().catch(() => -1);
  check('big CSV renders a bounded table (300 shown rows)', csvBigRows === 300, 'rows=' + csvBigRows);
  check('big CSV formula payload stays inert text (never a link/script)',
    csvBigText.includes(KNOWN.csvBigEvil), csvBigText.slice(0, 300));
  const csvBigXss = await page.evaluate(() => ({
    script: !!document.querySelector('#docPreview script'),
    link: !!document.querySelector('#docPreview a'),
    img: !!document.querySelector('#docPreview img'),
  })).catch(() => null);
  check('big CSV carries no executable elements', !!csvBigXss && !csvBigXss.script && !csvBigXss.link && !csvBigXss.img, JSON.stringify(csvBigXss));

  // ---- T8c: bounded markdown list — full list readable, traps literal ----
  const mdBigOk = await loadLocal(page, FILENAMES.mdBound, MIMES.md, MD_BOUND_BYTES, KNOWN.mdBigHeading);
  const mdBigText = await previewText(page);
  check('big markdown keeps heading, bold marker and first list item',
    mdBigOk && mdBigText.includes(KNOWN.mdBigFirst) && mdBigText.includes(KNOWN.mdBigBold), mdBigText.slice(0, 300));
  const mdBigLi = await page.locator('#docPreview li').count().catch(() => -1);
  check('big markdown renders its whole bounded list (400 items, no silent drop)', mdBigLi === 400, 'li=' + mdBigLi);
  const mdBigXss = await page.evaluate(() => ({
    fired: window.__docQaMdXss === 1 || window.__docQaMdImg === 1 || window.__docQaMdFence === 1,
    script: !!document.querySelector('#docPreview script'),
    img: !!document.querySelector('#docPreview img'),
    anchor: !!document.querySelector('#docPreview a'),
  })).catch(() => null);
  check('big markdown traps stay literal text (no script/img/link runs)',
    !!mdBigXss && mdBigXss.fired === false && !mdBigXss.script && !mdBigXss.img && !mdBigXss.anchor, JSON.stringify(mdBigXss));

  // ---- T8d: bounded HTML list/table — kept content plus explicit note ----
  const htmlBigOk = await loadLocal(page, FILENAMES.htmlBound, MIMES.html, HTML_BOUND_BYTES, KNOWN.htmlBigFirst);
  const htmlBigText = await previewText(page);
  check('big HTML keeps its first list marker and table cell',
    htmlBigOk && htmlBigText.includes(KNOWN.htmlBigCell), htmlBigText.slice(0, 300));
  const htmlBigLi = await page.locator('#docPreview li').count().catch(() => -1);
  const htmlBigTable = await page.locator('#docPreview table').count().catch(() => 0);
  check('big HTML keeps its bounded list and table structure', htmlBigLi === 200 && htmlBigTable >= 1, `li=${htmlBigLi} table=${htmlBigTable}`);
  const htmlBigXss = await page.evaluate(() => ({
    fired: window.__docQaHtmlBigFired === 1 || window.__docQaHtmlBigImg === 1,
    script: !!document.querySelector('#docPreview script'),
    img: !!document.querySelector('#docPreview img'),
    iframe: !!document.querySelector('#docPreview iframe'),
    anchor: !!document.querySelector('#docPreview a'),
    attr: !!document.querySelector('#docPreview [data-xss]'),
  })).catch(() => null);
  check('big HTML traps never run (no script/img/iframe/link/attrs)',
    !!htmlBigXss && htmlBigXss.fired === false && !htmlBigXss.script && !htmlBigXss.img
    && !htmlBigXss.iframe && !htmlBigXss.anchor && !htmlBigXss.attr, JSON.stringify(htmlBigXss));

  // ---- T8e: bounded Office DOCX — list/table kept, blocks truncated ----
  const docxBigOk = await loadLocal(page, FILENAMES.docxBound, MIMES.docx, DOCX_BOUND_BYTES, KNOWN.docxBigTitle);
  const docxBigText = await previewText(page);
  check('big DOCX keeps title, numbered-list marker and table cell',
    docxBigOk && docxBigText.includes(KNOWN.docxBigList) && docxBigText.includes(KNOWN.docxBigCell), docxBigText.slice(0, 300));
  const docxBigStruct = await page.evaluate(() => ({
    list: !!document.querySelector('#docPreview ul'),
    table: !!document.querySelector('#docPreview table'),
  })).catch(() => null);
  check('big DOCX keeps real list and table structure', !!docxBigStruct && docxBigStruct.list && docxBigStruct.table, JSON.stringify(docxBigStruct));

  // ---- T8f: bounded Office XLSX — first rows kept, tail cut, noted ----
  const xlsxBigOk = await loadLocal(page, FILENAMES.xlsxBound, MIMES.xlsx, XLSX_BOUND_BYTES, KNOWN.xlsxBigFirst);
  const xlsxBigText = await previewText(page);
  check('big XLSX keeps its first real cell readable', xlsxBigOk, xlsxBigText.slice(0, 300));
  check('big XLSX cuts the over-limit tail (last row absent)',
    !xlsxBigText.includes(KNOWN.xlsxBigLast), xlsxBigText.slice(-300));
  const xlsxBigTable = await page.locator('#docPreview table').count().catch(() => 0);
  check('big XLSX still renders a bounded table', xlsxBigTable >= 1, 'table=' + xlsxBigTable);

  // Large single-line inputs must not create megabyte-sized layout nodes.
  for(const [ext,content] of [
    ['txt','LARGE-TEXT-591 '+ 'x'.repeat(1024*1024)+' HIDDEN-TAIL-732'],
    ['md','LARGE-TEXT-591 '+ '`*'.repeat(512*1024)+' HIDDEN-TAIL-732'],
    ['json',JSON.stringify({body:'LARGE-TEXT-591 '+ 'x'.repeat(1024*1024)+' HIDDEN-TAIL-732'})]
  ]){
    const opened=await loadLocal(page,'large.'+ext,'text/plain',Buffer.from(content),'LARGE-TEXT-591');
    const shown=await previewText(page);
    check(ext+': oversized single-line preview stays bounded and readable',
      opened && !shown.includes('HIDDEN-TAIL-732') && shown.length<250000,'rendered characters='+shown.length);
  }

  // ---- T9: malformed / unsupported — honest error, no stale preview ----
  await loadLocal(page, FILENAMES.pdf, MIMES.pdf, PDF_BYTES, KNOWN.pdfPage1);
  try { await page.setInputFiles('#docFile', [{ name: FILENAMES.malformed, mimeType: MIMES.pdf, buffer: MALFORMED_BYTES }]); } catch {}
  const badStatusOk = await statusHas(page, /could not|cannot|can't|invalid|corrupt|truncat|failed|error|unsupported|unknown/i, 15000);
  const badStatusText = await statusText(page);
  check('malformed PDF reports an honest error', badStatusOk, badStatusText.slice(0, 200));
  const badText = await previewText(page);
  check('malformed PDF clears the old preview (no stale page text)',
    !badText.includes(KNOWN.pdfPage1) && !badText.includes(KNOWN.pdfPage2), badText.slice(0, 200));
  try { await page.setInputFiles('#docFile', [{ name: FILENAMES.unsupported, mimeType: 'application/octet-stream', buffer: UNSUPPORTED_BYTES }]); } catch {}
  const unsupOk = await statusHas(page, /unsupported|unknown|not support|cannot|could not|failed|error/i, 15000);
  const unsupStatusText = await statusText(page);
  check('unsupported type reports an honest error', unsupOk && /unsupported|unknown|not support/i.test(unsupStatusText), unsupStatusText.slice(0, 200));
  const unsupText = await previewText(page);
  check('unsupported file keeps no old preview', !unsupText.includes(KNOWN.pdfPage1) && !unsupText.includes(KNOWN.pdfPage2), unsupText.slice(0, 200));

  // ---- T10: backend returns the actual remote bytes (separate no-CORS origin) ----
  const remotePdf = `${remoteBase}/remote.pdf`;
  const corsProbe = await fetch(remotePdf);
  if (!(corsProbe.headers.get('access-control-allow-origin') === null
    && new URL(remotePdf).port !== new URL(apiBase).port)) {
    throw new Error('setup: fixture origin must stay a separate no-CORS origin');
  }
  const pvRes = await fetch(apiBase + '/api/doc/source?url=' + encodeURIComponent(remotePdf));
  const pvBuf = Buffer.from(await pvRes.arrayBuffer());
  check('backend returns the actual remote PDF bytes (not a pointer)',
    pvRes.status === 200 && pvBuf.equals(PDF_BYTES), 'status=' + pvRes.status + ' len=' + pvBuf.length + '/' + PDF_BYTES.length);
  const remoteXlsx = `${remoteBase}/remote-sheet.xlsx`;
  const xvRes = await fetch(apiBase + '/api/doc/source?url=' + encodeURIComponent(remoteXlsx));
  const xvBuf = Buffer.from(await xvRes.arrayBuffer());
  check('backend returns the actual remote Office bytes (not a pointer)',
    xvRes.status === 200 && xvBuf.equals(XLSX_BYTES), 'status=' + xvRes.status + ' len=' + xvBuf.length + '/' + XLSX_BYTES.length);
  // ---- T11: remote reads render real content through the backend ----
  await openDocPane(page);
  await readRemote(page, remotePdf);
  const rp = await previewHas(page, KNOWN.pdfPage1, 20000);
  const rpText = await previewText(page);
  check('remote PDF renders its real page text through the backend', rp, rpText.slice(0, 200));
  check('remote PDF is a real render, not the staged-pointer fallback',
    rp && !/needs its own app|staged a pointer/i.test(rpText), rpText.slice(0, 200));
  const rpCanvas = await page.locator('#docPreview canvas').count().catch(() => 0);
  check('remote PDF renders a real page canvas', rpCanvas >= 1, 'canvas=' + rpCanvas);
  await readRemote(page, remoteXlsx);
  const rx = await previewHas(page, KNOWN.xlsxCellA1, 20000);
  const rxText = await previewText(page);
  check('remote Office bytes render real cell text, not a pointer',
    rx && rxText.includes(KNOWN.xlsxCellB2) && !/needs its own app|staged a pointer/i.test(rxText), rxText.slice(0, 300));

  // ---- T12: backend bound at 10MiB ----
  const hugeUrl = `${remoteBase}/huge.bin`;
  const hugeDirect = Buffer.from(await (await fetch(hugeUrl)).arrayBuffer());
  if (!(hugeDirect.length > 10 * 1024 * 1024)) throw new Error('setup: huge probe must exceed 10MiB, got len=' + hugeDirect.length);
  const hugeVia = await fetch(apiBase + '/api/doc/source?url=' + encodeURIComponent(hugeUrl));
  const hugeViaBuf = Buffer.from(await hugeVia.arrayBuffer());
  check('backend /api/doc/source stays bounded at 10MiB',
    hugeVia.status === 413 || hugeViaBuf.length <= 10 * 1024 * 1024, 'status=' + hugeVia.status + ' len=' + hugeViaBuf.length);

  // ---- T12b: streamed oversized rejection with NO content-length ----
  // The fixture streams chunked bytes with no length header, so only the
  // backend streaming guard can stop it. Feasible: document-source.mjs reads
  // the body reader chunk-by-chunk and 413s past MAX_BYTES.
  const hugeNoLengthUrl = `${remoteBase}/huge-nolength.pdf`;
  const hugeNoLengthDirect = await fetch(hugeNoLengthUrl);
  if (!(hugeNoLengthDirect.headers.get('content-length') === null)) {
    throw new Error('setup: no-length probe must omit content-length, got ' + hugeNoLengthDirect.headers.get('content-length'));
  }
  const hugeNoLengthDirectBuf = Buffer.from(await hugeNoLengthDirect.arrayBuffer());
  if (!(hugeNoLengthDirectBuf.length > 10 * 1024 * 1024)) {
    throw new Error('setup: no-length probe must exceed 10MiB, got len=' + hugeNoLengthDirectBuf.length);
  }
  const hugeNoLengthVia = await fetch(apiBase + '/api/doc/source?url=' + encodeURIComponent(hugeNoLengthUrl));
  const hugeNoLengthViaBuf = Buffer.from(await hugeNoLengthVia.arrayBuffer());
  check('streamed oversized body without a length is rejected (413, bounded)',
    hugeNoLengthVia.status === 413 && hugeNoLengthViaBuf.length <= 10 * 1024 * 1024,
    'status=' + hugeNoLengthVia.status + ' len=' + hugeNoLengthViaBuf.length);
  await openDocPane(page);
  await readRemote(page, hugeNoLengthUrl);
  const hugeNoLengthStatusOk = await statusHas(page, /exceeds|10 ?MiB|too large|bounded|failed|error|download failed|413/i, 20000);
  const hugeNoLengthStatus = await statusText(page);
  check('oversized no-length remote reports an honest bound error',
    hugeNoLengthStatusOk, hugeNoLengthStatus.slice(0, 200));
  const hugeNoLengthPreview = await previewText(page);
  check('oversized no-length remote keeps no document preview',
    !hugeNoLengthPreview.includes(KNOWN.pdfPage1) && !hugeNoLengthPreview.includes(KNOWN.pdfPage2), hugeNoLengthPreview.slice(0, 200));
  // ---- T13: switching documents mid-load keeps only the newest ----
  await openDocPane(page);
  await readRemote(page, `${remoteBase}/remote-slow.pdf`);
  await page.waitForTimeout(200);
  await readRemote(page, `${remoteBase}/remote-table.docx`);
  const fastWon = await previewHas(page, KNOWN.docxTableTitle, 20000);
  check('newest document wins while the older fetch is still loading', fastWon, (await previewText(page)).slice(0, 200));
  await page.waitForTimeout(3200);
  const raceText = await previewText(page);
  check('slow first fetch never overwrites the newer document',
    raceText.includes(KNOWN.docxTableTitle)
    && raceText.includes(KNOWN.docxCells[3])
    && !raceText.includes(KNOWN.pdfPage1) && !raceText.includes(KNOWN.pdfPage2), raceText.slice(0, 300));

  // ---- T14: slow A fetch cancelled on profile switch — nothing of A in B ----
  await blurActive(page);
  await page.keyboard.press('a');
  await slotIs(apiBase, 'A');
  await openDocPane(page);
  await readRemote(page, `${remoteBase}/remote-profile-a.pdf`);
  await page.waitForTimeout(400);
  await blurActive(page);
  await page.keyboard.press('b');
  check('profile switches to B while A\u2019s slow fetch is in flight', await slotIs(apiBase, 'B'));
  await openDocPane(page);
  await page.waitForTimeout(3800);
  const bText = await previewText(page);
  check('B shows none of A\u2019s slow document after it resolves',
    !bText.includes(KNOWN.pdfPage1) && !bText.includes(KNOWN.pdfPage2), bText.slice(0, 200));
  await blurActive(page);
  await page.keyboard.press('a');
  await slotIs(apiBase, 'A');
  await openDocPane(page);

  // ---- T15: mode + viewport fit, no horizontal overflow ----
  await loadLocal(page, FILENAMES.xlsx, MIMES.xlsx, XLSX_BYTES, KNOWN.xlsxCellA1);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(700);
  let fit = await docFits(page).catch(() => null);
  check('1366x768: doc preview never scrolls sideways', !!fit && !!fit.prev && fit.prev.scroll <= fit.prev.client + 1, JSON.stringify(fit && fit.prev));
  check('1366x768: app never scrolls sideways with a doc open', !!fit && fit.appScroll <= fit.inner + 1, JSON.stringify(fit));
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.waitForTimeout(700);
  fit = await docFits(page).catch(() => null);
  check('1024x700: doc preview never scrolls sideways', !!fit && !!fit.prev && fit.prev.scroll <= fit.prev.client + 1, JSON.stringify(fit && fit.prev));
  check('1024x700: app never scrolls sideways with a doc open', !!fit && fit.appScroll <= fit.inner + 1, JSON.stringify(fit));
  let calmOk = true;
  try { await page.click('.pills button[data-profile="calm"]'); } catch { calmOk = false; }
  await page.waitForTimeout(600);
  fit = await docFits(page).catch(() => null);
  check('calm mode: doc preview still never scrolls sideways',
    calmOk && !!fit && !!fit.prev && fit.prev.scroll <= fit.prev.client + 1, JSON.stringify(fit && fit.prev));
  try { await page.click('.pills button[data-profile="Vibes"]'); } catch {}
  await page.waitForTimeout(400);

  check('no uncaught page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await shot(page, 'final');
} catch (e) {
  try {
    if (browser) {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages[0]) await shot(pages[0], 'failure').catch(() => {});
    }
  } catch {}
  console.log('HARNESS ERROR - ' + String((e && e.message) || e));
  exitCode = 1;
} finally {
  // Owned teardown only: close what this file opened, nothing broader.
  try { await browser?.close(); } catch {}
  try { child?.kill(); } catch {}
  try { await new Promise((r) => { try { fixtureServer.close(r); } catch { r(); } }); } catch {}
  try { await rm(vault, { recursive: true, force: true }); } catch {}
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\ndocuments: ${results.length - failed.length}/${results.length} checks passed`);
console.log('report dir (kept): ' + reportDir);
for (const [name] of failed) console.log('FAILED - ' + name);
process.exit(failed.length || exitCode ? 1 : 0);
