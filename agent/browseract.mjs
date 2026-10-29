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
  await dismissConsent(page);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(500);
  const p = slotPaths(slot);
  const dir = join(p.staging, 'browser');
  await mkdir(dir, { recursive: true });
  const file = `view-${slot}.png`;
  await page.screenshot({ path: join(dir, file) });
  return { ok: true, title: await page.title().catch(() => ''), url: page.url(), shot: file };
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
export async function viewClick(slot, fx, fy) {
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
  try {
    const { page } = sess;
    const vp = page.viewportSize() || { width: 1100, height: 750 };
    const cx = Math.max(0, Math.min(1, Number(fx) || 0)) * vp.width;
    const cy = Math.max(0, Math.min(1, Number(fy) || 0)) * vp.height;
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(900);
  } catch (e) { return { ok: false, error: 'click failed: ' + String(e.message || e).slice(0, 160) }; }
  return snap(slot);
}
export async function viewType(slot, text, enter) {
  let sess;
  try { sess = await ensureSession(slot); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
  try {
    const { page } = sess;
    await page.keyboard.type(String(text || '').slice(0, 300), { delay: 12 });
    if (enter) await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
  } catch (e) { return { ok: false, error: 'typing failed: ' + String(e.message || e).slice(0, 160) }; }
  return snap(slot);
}
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
