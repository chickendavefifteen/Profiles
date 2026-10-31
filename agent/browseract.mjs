// Browser-act (P4): the agent drives a REAL browser — behind every gate
// we have, because this is the first tool that touches the live web.
//   - Profile X only, or any slot with Advanced explicitly on
//   - Two-step confirm: /prepare mints a 60s token + plain-English
//     summary; /run consumes it. No token, no driving. Ever.
//   - Allowlisted actions only: goto, title, text (selector), screenshot
//   - Headless Chromium (Playwright), screenshots land in the slot's
//     staging/browser/ as receipts in Activity
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slotPaths } from './slots.mjs';
import { hasNative, requestNative } from './native-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pending = new Map(); // token -> {slot, url, actions, expires}

const ALLOWED = ['goto', 'title', 'text', 'screenshot', 'wait'];
// Headless actors must not inherit a host/ephemeral desktop D-Bus session.
// Chromium aborts if that bus disconnects; rendering needs no desktop bus.
const browserEnv={...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',PULSE_SERVER:'unix:/nonexistent'};
const nativeShell=process.env.PROFILES_NATIVE_SHELL==='1';
function usesNative(slot){return nativeShell || hasNative(slot);}
export function summarise(url, actions) {
  return `Open ${url} and: ${actions.map((a) => a.type + (a.selector ? ` (${a.selector})` : '')).join(', ')}. Headless browser, receipts saved. Nothing will be clicked, submitted or posted — read-only driving.`;
}
export function prepare(slot, profile, url, actions) {
  if (slot !== 'X' && !profile?.advanced) return { ok: false, error: 'browser-act needs Profile X, or Advanced switched on for this profile' };
  if (!/^https?:\/\//i.test(url || '')) return { ok: false, error: 'url must be http(s)' };
  if (!Array.isArray(actions) || !actions.length || !actions.every((a) => ALLOWED.includes(a.type))) {
    return { ok: false, error: 'actions allowlist only: ' + ALLOWED.join(', ') };
  }
  const token = randomBytes(12).toString('hex');
  pending.set(token, { slot, url, actions, expires: Date.now() + 60000 });
  return { ok: true, token, summary: summarise(url, actions), expiresInSec: 60 };
}

export async function runPrepared(token) {
  const job = pending.get(token);
  pending.delete(token);
  if (!job) return { ok: false, error: 'confirm token missing or already used' };
  if (Date.now() > job.expires) return { ok: false, error: 'confirm token expired (60s) — prepare again' };
  let playwright;
  try { playwright = await import('playwright'); }
  catch { return { ok: false, error: 'playwright not installed (npm i -D playwright)' }; }
  const p = slotPaths(job.slot);
  const shotDir = join(p.staging, 'browser');
  await mkdir(shotDir, { recursive: true });
  const results = [];
  let browser;
  try { browser = await playwright.chromium.launch({ headless: true, env:browserEnv, args: ['--disable-gpu', '--mute-audio', '--no-first-run', '--disable-dev-shm-usage'] }); }
  catch (e) { return { ok: false, error: 'browser launch failed: ' + String(e.message || e).slice(0, 160) }; }
  try {
    const page = await browser.newPage();
    for (const a of job.actions) {
      if (a.type === 'goto') { await page.goto(a.url || job.url, { timeout: 15000, waitUntil: 'domcontentloaded' }); results.push({ type: 'goto', url: page.url() }); }
      else if (a.type === 'title') results.push({ type: 'title', title: await page.title() });
      else if (a.type === 'text') {
        const sel = a.selector || 'body';
        const txt = await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '');
        results.push({ type: 'text', selector: sel, text: String(txt).slice(0, 1200) });
      } else if (a.type === 'wait') { await page.waitForTimeout(Math.min(5000, a.ms || 800)); results.push({ type: 'wait' }); }
      else if (a.type === 'screenshot') {
        const name = `shot-${Date.now()}.png`;
        await page.screenshot({ path: join(shotDir, name), fullPage: false });
        await writeFile(join(shotDir, name + '.json'), JSON.stringify({ url: page.url(), at: new Date().toISOString(), slot: job.slot }, null, 2));
        results.push({ type: 'screenshot', file: name, path: `staging/browser/${name}` });
      }
    }
  } finally { await browser.close().catch(() => {}); }
  return { ok: true, slot: job.slot, url: job.url, results };
}
export { ALLOWED as BROWSER_ACTIONS };

/* ---- live pane sessions: the Browser pane IS a browser ----
   One headless Chromium per slot, kept open. The user drives it by
   clicking the screenshot (their click IS the consent); agent-drive
   above stays token-gated because the agent initiates it. */
const sessions = new Map();
/* Never orphan a Chromium on the profile lock: close contexts with the
   sidecar. An orphaned context was the "Target page closed" restart bug. */
export async function closeAllSessions() {
  for (const [, sess] of sessions) { try { await sess.ctx.close(); } catch {} try { await sess.browser.close(); } catch {} }
  sessions.clear();
}
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => { await closeAllSessions().catch(() => {}); process.exit(0); });
}
async function dismissConsent(page) {
  /* Presence, not title: the consent wall's page title is just "Google",
     which is exactly how it slipped past the first version. */
  try {
    const btn = page.getByRole('button', { name: /reject all/i });
    if (await btn.count()) { await btn.first().click({ timeout: 3000 }); await page.waitForTimeout(900); }
  } catch {}
}
/* Singleflight: concurrent first-touches (page img + tool call racing
   on a cold server) must SHARE one launch, never double-launch on the
   same profile dir — the loser's Chromium blocks on the Singleton lock
   and the request hangs with zero bytes. */
const pendingSessions = new Map();
export async function ensureSession(slot) {
  if(nativeShell) throw new Error('The native shell uses its displayed WebView, not a second headless browser.');
  const cur = sessions.get(slot);
  if (cur) {
    try { if (!cur.page.isClosed()) return cur; } catch {}
    sessions.delete(slot); /* dead session: never serve a corpse */
  }
  if (pendingSessions.has(slot)) return pendingSessions.get(slot);
  const p = buildSession(slot).finally(() => pendingSessions.delete(slot));
  pendingSessions.set(slot, p);
  const sess = await p;
  sessions.set(slot, sess);
  return sess;
}
async function buildSession(slot) {
  const { chromium } = await import('playwright');
  const p = slotPaths(slot);
  const profileDir = join(p.root, 'browser-profile-' + (process.env.PROFILES_SERVER_PORT || process.env.PROFILES_AGENT_PORT || 'main'));
  await mkdir(profileDir, { recursive: true });
  /* Headless, private per-slot storage; no host window, audio or GPU use.
     A launch failure is logged in full locally, never hidden by a retry. */
  const opts = { viewport: { width: 1280, height: 800 }, headless: true, env:browserEnv,
    args: ['--no-first-run', '--mute-audio', '--disable-gpu', '--disable-dev-shm-usage'] };
  let ctx;
  try{ctx=await chromium.launchPersistentContext(profileDir,opts);}
  catch(error){console.error('[profiles] Browser launch failed for slot '+slot+':',error);throw error;}
  const page = ctx.pages()[0] || await ctx.newPage();
  // Stay blank until the user asks to browse; no network on cold launch.
  return { browser: ctx, page, ctx };
}
async function snap(slot) {
  const { page } = await ensureSession(slot);
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    const title = await page.title().catch(() => '');
    const url = page.url();
    /* The stream is the live view; the still is its poster + receipt.
       Written best-effort, never allowed to fail the snap. */
    let shot = null;
    try {
      const p = slotPaths(slot);
      const dir = join(p.staging, 'browser');
      await mkdir(dir, { recursive: true });
      const file = `view-${slot}.png`;
      await page.screenshot({ path: join(dir, file) });
      shot = file;
    } catch {}
    return { ok: true, title, url, shot };
  } catch (e) { return { ok: false, error: 'page closed: ' + String(e && e.message || e).slice(0, 80) }; }
}
/* ---- live view: one CDP screencast per slot, MJPEG over HTTP ----
   Chromium is headless, muted and software-rendered. Screencast frames
   are the real rendered page (not a stale screenshot). Controls land
   on the same page the user sees: one actor, not two. */
const screencasts = new Map();
const frameSeq = new Map(); /* slot -> frames emitted (stall detector reads this) */
export function getFrameSeq(slot) { return frameSeq.get(slot) || 0 };
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);
}
/* Robust: reuse only a session that PROVES itself with a real frame
   within seconds; otherwise tear down and rebuild once, then fail loud
   (503 -> frontend poster + retry) instead of hanging the request. */
export async function ensureScreencast(slot) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let sess = screencasts.get(slot) || null;
    if (sess && sess.dead) { screencasts.delete(slot); sess = null; }
    if (!sess) {
      sess = await withTimeout(buildScreencast(slot), 15000, 'screencast setup');
      screencasts.set(slot, sess);
    }
    /* Liveness proof is a real render, not a fresh paint: CDP screencast
       only emits on repaint, so an idle page starves frame-waits. A
       screenshot proves the page renders NOW; live frames follow it. */
    const { page } = await ensureSession(slot);
    const proof = await withTimeout(
      page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null), 10000, 'proof shot').catch(() => null);
    if (proof && proof.length > 500) { sess.proof = proof; return sess; }
    try { await sess.stop(); } catch {}
    screencasts.delete(slot);
  }
  throw new Error('browser produced no render');
}
async function buildScreencast(slot) {
  const { page } = await ensureSession(slot);
  const { PassThrough } = await import('node:stream');
  const cdp = await page.context().newCDPSession(page);
  const boundary = 'profileframe' + Math.random().toString(36).slice(2);
  const stream = new PassThrough();
  let latest = null;
  const sess = { cdp, dead: false, boundary, stream, latest: () => latest };
  const onFrame = async ({ data, sessionId }) => {
    try {
      latest = Buffer.from(data, 'base64');
      frameSeq.set(slot, (frameSeq.get(slot) || 0) + 1);
      if (stream.writableLength < 1024 * 1024) {
        stream.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${latest.length}\r\n\r\n`);
        stream.write(latest); stream.write('\r\n');
      }
    } catch {}
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
  };
  cdp.on('Page.screencastFrame', onFrame);
  sess.stop = async () => { sess.dead = true; try { cdp.off('Page.screencastFrame', onFrame); await cdp.send('Page.stopScreencast').catch(() => {}); } catch {} };
  try { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 68, maxWidth: 1100, maxHeight: 800, everyNthFrame: 3 }); } catch {}
  page.on('close', () => sess.stop());
  return sess;
}
export async function stopScreencast(slot) { const sess = screencasts.get(slot); if (sess) { screencasts.delete(slot); await sess.stop(); } }
export async function mouseAct(slot, kind, fx, fy, w, h) {
  const { page } = await ensureSession(slot);
  try {
    if (kind === 'move') await page.mouse.move(fx * w, fy * h);
    else if (kind === 'down') await page.mouse.down();
    else if (kind === 'up') await page.mouse.up();
    else if (kind === 'click') await page.mouse.click(fx * w, fy * h);
    else if (kind === 'dblclick') await page.mouse.dblclick(fx * w, fy * h);
    else if (kind === 'wheel') await page.mouse.wheel(0, fy || 120);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 140) }; }
}
export async function keysAct(slot, kind, key, text) {
  const { page } = await ensureSession(slot);
  try {
    if (kind === 'type' && text) await page.keyboard.type(String(text).slice(0, 500), { delay: 8 });
    else if (kind === 'press' && key) await page.keyboard.press(key);
    else if (kind === 'down' && key) await page.keyboard.down(key);
    else if (kind === 'up' && key) await page.keyboard.up(key);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 140) }; }
}
/* Temporary compat: old type/click callers -> unified live path. */
export async function viewType(slot, text, enter, backspace) {
  if (backspace) await keysAct(slot, 'press', 'Backspace');
  if (text) await keysAct(slot, 'type', null, text);
  if (enter) await keysAct(slot, 'press', 'Enter');
  return snap(slot);
}
export async function viewClick(slot, fx, fy) {
  const { page } = await ensureSession(slot);
  const vp = page.viewportSize() || { width: 1280, height: 800 };
  const r = await mouseAct(slot, 'click', fx, fy, vp.width, vp.height);
  await page.waitForTimeout(700).catch(() => {});
  return { ...(await snap(slot)), click: r };
}
export function normViewUrl(url) {
  const u = String(url || '').trim();
  if (!u) return 'https://www.google.com';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(u)) return 'https://' + u;
  return 'https://www.google.com/search?q=' + encodeURIComponent(u);
}
export async function viewGo(slot, url) {
  const u = normViewUrl(url);
  if (usesNative(slot)) return requestNative(slot, 'navigate', { url: u });
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), url: u }; }
  const { page } = sess;
  try {
    await page.goto(u, { timeout: 15000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    return { ok: false, error: 'Navigation failed: ' + String(e.message || e).slice(0, 160), url: u };
  }
  return snap(slot);
}
export async function viewHome(slot) { return viewGo(slot, 'https://www.google.com'); }
export async function viewZoom(slot, value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 2) return { ok: false, error: 'Zoom must be 50–200%' };
  const { page } = await ensureSession(slot);
  await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
  return { ok: true, zoom };
}
/* The page always matches the pane: the frontend reports the live pane
   size and the session resizes its viewport to it (clamped). The stream
   then maps 1:1 onto the frame — no crop math, no drift, at any window. */
export async function viewSize(slot, w, h) {
  const { page } = await ensureSession(slot);
  w = Math.max(320, Math.min(1920, Math.round(Number(w) || 1280)));
  h = Math.max(200, Math.min(1200, Math.round(Number(h) || 800)));
  try {
    await page.setViewportSize({ width: w, height: h });
    const sess = screencasts.get(slot);
    if (sess && !sess.dead) {
      try { await sess.cdp.send('Page.stopScreencast').catch(() => {}); } catch {}
      try { await sess.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: w, maxHeight: h, everyNthFrame: 1 }); } catch {}
    }
    try {
      const p = slotPaths(slot);
      const dir = join(p.staging, 'browser');
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `view-${slot}.png`) });
    } catch {}
    return { ok: true, w, h };
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 140) }; }
}
export async function viewBack(slot) {
  if (usesNative(slot)) return requestNative(slot, 'back');
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
  try {
    const { page } = sess;
    await page.goBack({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(700);
  } catch (e) { return { ok: false, error: 'back failed: ' + String(e.message || e).slice(0, 160) }; }
  return snap(slot);
}

export async function viewCurrent(slot) {
  return usesNative(slot) ? requestNative(slot, 'current') : snap(slot);
}
export async function viewRead(slot) {
  if (usesNative(slot)) return requestNative(slot, 'read');
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
  try {
    const { page } = sess;
    const text = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
    let title = '', url = '';
    try { title = await page.title(); } catch {}
    try { url = page.url(); } catch {}
    return { ok: true, title, url, text: String(text).slice(0, 4000) };
  } catch (e) { return { ok: false, error: 'read failed: ' + String(e.message || e).slice(0, 160) }; }
}
/** Web search through the visible native browser when connected, else live Playwright. */
export async function webSearch(slot, query) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return { ok: false, error: 'empty query', query: q, results: [] };
  /* Native path: the VISIBLE native browser does the search. Same actor the
     user sees — never spawn a second Playwright when hasNative. Navigate the
     native page to Bing, then read back the fixed reader payload
     {title,text,links:[{title,href}]} and keep only sanitized safe links. */
  if (usesNative(slot)) {
    const searchUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(q);
    let nav = null;
    try { nav = await requestNative(slot, 'navigate', { url: searchUrl }); }
    catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200), query: q, results: [], native: true, pageUrl: searchUrl }; }
    if (!nav || !nav.ok) {
      return { ok: false, error: String((nav && nav.error) || 'native navigation failed').slice(0, 200),
        query: q, results: [], native: true, pageUrl: (nav && nav.url) || searchUrl };
    }
    let rd = null;
    try { rd = await requestNative(slot, 'read'); }
    catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200), query: q, results: [], native: true, pageUrl: nav.url || searchUrl }; }
    if (!rd || !rd.ok) {
      return { ok: false, error: String((rd && rd.error) || 'native read failed').slice(0, 200),
        query: q, results: [], native: true, pageUrl: (rd && rd.url) || nav.url || searchUrl };
    }
    const results = [];
    const rawLinks = Array.isArray(rd.links) ? rd.links : [];
    const decodeBing = (href) => {
      // Same redirect decoding as the Playwright extractBing pass: Bing
      // wraps result hrefs as ...?u=a1<base64>. Decode exactly that form.
      const m = String(href || '').match(/[?&]u=a1([A-Za-z0-9_-]+)/);
      if (!m) return href;
      try {
        const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
        const dec = Buffer.from(b64, 'base64').toString('utf8');
        if (/^https?:\/\//i.test(dec)) return dec;
      } catch {}
      return href;
    };
    const isBingNav = (href) => {
      // Bing nav/internal/Copilot chrome is never a result: search pages,
      // click wrappers, Copilot and account links. Never auto-opened.
      try {
        const u = new URL(href);
        const host = u.host.toLowerCase();
        const path = u.pathname.toLowerCase();
        if (host.endsWith('bing.com')) {
          if (path.startsWith('/search') || path.startsWith('/images') || path.startsWith('/videos') || path.startsWith('/maps') || path.startsWith('/news') || path.startsWith('/chat') || path.startsWith('/copilot') || path.startsWith('/account') || path.startsWith('/fred') || path.startsWith('/ck/') || path.startsWith('/aclick')) return true;
          if (/[?&](qs|sp|form|pq|cvid|aff)/i.test(u.search)) return path === '/' || path.startsWith('/search');
        }
        if (/(^|\.)copilot\.microsoft\.com$/i.test(host)) return true;
        if (/^aka\.ms$/i.test(host)) return true;
        if (/(^|\.)microsoft\.com$/i.test(host) && /copilot/i.test(path + u.search)) return true;
      } catch { return true; }
      return false;
    };
    for (const item of rawLinks) {
      if (results.length >= 6) break;
      let href = String((item && item.href) || '').trim();
      const title = String((item && item.title) || '').trim().slice(0, 200);
      if (!title) continue;
      if (!/^https?:\/\//i.test(href)) continue;
      href = decodeBing(href);
      if (!/^https?:\/\//i.test(href)) continue;
      if (href === searchUrl) continue;
      if (isBingNav(href)) continue;
      results.push({ title, href: href.slice(0, 2000), snippet: '' });
    }
    if (!results.length) {
      return { ok: false, error: 'no usable results in native read — page shows live in Browser pane; try different words or "read this page"',
        query: q, results: [], native: true, pageUrl: rd.url || nav.url || searchUrl, via: 'bing-native' };
    }
    return { ok: true, query: q, results, via: 'bing-native', pageUrl: rd.url || searchUrl, native: true };
  }
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), query: q, results: [] }; }
  const { page } = sess;
  const extractBing = () => page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#b_results .b_algo').forEach((li) => {
      const h = li.querySelector('h2');
      const a = li.querySelector('h2 a');
      if (!a || !h) return;
      let href = a.href || '';
      try {
        const m = href.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
        if (m) href = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
      } catch {}
      const cap = li.querySelector('.b_caption');
      out.push({ title: (h.textContent || '').trim(), href,
        snippet: ((cap && cap.textContent) || '').trim().slice(0, 300) });
    });
    return out.slice(0, 6);
  }).catch(() => []);
  /* Pass 1: Bing (renders headless, no wall as of 2026-10-29). Google
     scraping is retired: it sorry-pages automated browsers, and one
     rate-limited IP poisons the whole visible session. */
  try {
    await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(q), { timeout: 25000 });
    await page.waitForTimeout(1200).catch(() => {});
    const results = (await extractBing()).filter((r) => r.title && /^https?:\/\//.test(r.href));
    if (results.length) return { ok: true, query: q, results, via: 'bing', pageUrl: page.url() };
  } catch {}
  /* Pass 2: DuckDuckGo html (often challenged; cheap to try). */
  try {
    await page.goto('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { timeout: 15000 });
    const results = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.result').forEach((r) => {
        const a = r.querySelector('.result__a');
        const sn = r.querySelector('.result__snippet');
        if (a) out.push({ title: a.textContent.trim(), href: a.href, snippet: sn ? sn.textContent.trim() : '' });
      });
      return out.slice(0, 6);
    }).catch(() => []);
    if (results.length) return { ok: true, query: q, results, via: 'duckduckgo' };
  } catch {}
  let pageUrl = '';
  try { pageUrl = page.url() || ''; } catch {}
  return { ok: false, query: q, results: [], via: 'none', pageUrl,
    error: 'both search backends came back empty — the page is showing Bing for the query; read it there or try different words' };
}