// Browser-act (P4): the agent drives a REAL browser — behind every gate
// we have, because this is the first tool that touches the live web.
//   - Profile X only, or any slot with Advanced explicitly on
//   - Two-step confirm: /prepare mints a 60s token + plain-English
//     summary; /run consumes it. No token, no driving. Ever.
//   - Allowlisted actions only: goto, title, text (selector), screenshot
//   - Headless Firefox (Playwright), screenshots land in the slot's
//     staging/browser/ as receipts in Activity
// CUA+vision (P4.2) will hang off this same confirm gate.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slotPaths } from './slots.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pending = new Map(); // token -> {slot, url, actions, expires}

const ALLOWED = ['goto', 'title', 'text', 'screenshot', 'wait'];
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
  try { browser = await playwright.chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] }); }
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
   One headless Firefox per slot, kept open. The user drives it by
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
async function ensureSession(slot) {
  if (sessions.has(slot)) {
    const s = sessions.get(slot);
    try { if (!s.page.isClosed()) return s; } catch {}
    sessions.delete(slot); /* dead session: never serve a corpse */
  }
  const { chromium } = await import('playwright');
  const p = slotPaths(slot);
  const profileDir = join(p.root, 'browser-profile-' + (process.env.PROFILES_SERVER_PORT || process.env.PROFILES_AGENT_PORT || 'main'));
  await mkdir(profileDir, { recursive: true });
  /* Headless persistent Chromium: passes Google's bot check (proven),
     works in every spawn context (Tauri-spawned sidecars have no
     DISPLAY — headed there dies instantly and poisons the session). */
  const opts = { viewport: { width: 1280, height: 800 }, headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'] };
  const ctx = await chromium.launchPersistentContext(profileDir, opts);
  const page = ctx.pages()[0] || await ctx.newPage();
  if (!page.url() || page.url() === 'about:blank') {
    await page.goto('https://www.google.com', { timeout: 25000 }).catch(() => {});
    await dismissConsent(page);
  }
  const sess = { browser: ctx, page, ctx };
  sessions.set(slot, sess);
  return sess;
}
async function snap(slot) {
  const { page } = await ensureSession(slot);
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    const title = await page.title().catch(() => '');
    return { ok: true, title, url: page.url(), shot: null };
  } catch (e) { return { ok: false, error: 'page closed: ' + String(e && e.message || e).slice(0, 80) }; }
}
/* ---- live view: one CDP screencast per slot, MJPEG over HTTP ----
   Chromium here is headless=false with xvfb-run, so screencast frames
   are the real rendered page (not a stale screenshot). Controls land
   on the same page the user sees: one actor, not two. */
const screencasts = new Map();
export async function ensureScreencast(slot) {
  if (screencasts.has(slot)) { const sess = screencasts.get(slot); if (!sess.dead) return sess; }
  const { page } = await ensureSession(slot);
  const { PassThrough } = await import('node:stream');
  const cdp = await page.context().newCDPSession(page);
  const boundary = 'profileframe' + Math.random().toString(36).slice(2);
  const stream = new PassThrough();
  let latest = null;
  const sess = { cdp, dead: false, boundary, stream, latest: () => latest };
  const onFrame = async ({ data, metadata }) => {
    try {
      latest = Buffer.from(data, 'base64');
      if (stream.writableLength < 1024 * 1024) {
        stream.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${latest.length}\r\n\r\n`);
        stream.write(latest); stream.write('\r\n');
      }
    } catch {}
    try { await cdp.send('Page.screencastFrameAck', { sessionId: metadata.sessionId }); } catch {}
  };
  cdp.on('Page.screencastFrame', onFrame);
  sess.stop = async () => { sess.dead = true; try { cdp.off('Page.screencastFrame', onFrame); await cdp.send('Page.stopScreencast').catch(() => {}); } catch {} };
  try { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1100, maxHeight: 800, everyNthFrame: 1 }); } catch {}
  page.on('close', () => sess.stop());
  screencasts.set(slot, sess);
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
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), url: u }; }
  const { page } = sess;
  try {
    await page.goto(u, { timeout: 15000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    try { await page.goto('https://www.google.com', { timeout: 15000 }).catch(() => {}); } catch {}
    const s = await snap(slot);
    if (!s.ok) return { ok: false, error: 'navigation failed: ' + String(e.message || e).slice(0, 160), url: u };
    s.note = 'fell back to home';
    return s;
  }
  return snap(slot);
}
export async function viewHome(slot) { return viewGo(slot, 'https://www.google.com'); }
export async function viewBack(slot) {
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

export async function viewCurrent(slot) { return snap(slot); }
export async function viewRead(slot) {
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
/** Web search through the integrated browser (DDG html results). */
export async function webSearch(slot, query) {
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), query, results: [] }; }
  try {
    const { page } = sess;
    await page.goto('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { timeout: 15000 });
    const results = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.result').forEach((r) => {
        const a = r.querySelector('.result__a');
        const sn = r.querySelector('.result__snippet');
        if (a) out.push({ title: a.textContent.trim(), href: a.href, snippet: sn ? sn.textContent.trim() : '' });
      });
      return out.slice(0, 6);
    }).catch(() => []);
    return { ok: true, query, results };
  } catch (e) { return { ok: false, error: 'search failed: ' + String(e.message || e).slice(0, 160), query, results: [] }; }
}
