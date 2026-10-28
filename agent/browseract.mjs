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
  const browser = await playwright.firefox.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const a of job.actions) {
      if (a.type === 'goto') { await page.goto(a.url || job.url, { timeout: 20000 }); results.push({ type: 'goto', url: page.url() }); }
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
async function ensureSession(slot) {
  if (sessions.has(slot)) return sessions.get(slot);
  const playwright = await import('playwright');
  const browser = await playwright.firefox.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await page.goto('https://www.google.com', { timeout: 25000 }).catch(() => {});
  const sess = { browser, page };
  sessions.set(slot, sess);
  return sess;
}
async function snap(slot) {
  const { page } = await ensureSession(slot);
  const p = slotPaths(slot);
  const dir = join(p.staging, 'browser');
  await mkdir(dir, { recursive: true });
  const file = `view-${slot}.png`;
  await page.screenshot({ path: join(dir, file) });
  return { ok: true, title: await page.title().catch(() => ''), url: page.url(), shot: file };
}
export async function viewGo(slot, url) {
  const { page } = await ensureSession(slot);
  const u = /^https?:\/\//i.test(url || '') ? url : 'https://' + (url || 'www.google.com');
  await page.goto(u, { timeout: 25000 }).catch(async () => { await page.goto('https://www.google.com').catch(() => {}); });
  return snap(slot);
}
export async function viewHome(slot) { return viewGo(slot, 'https://www.google.com'); }
export async function viewClick(slot, fx, fy) {
  const { page } = await ensureSession(slot);
  const vp = page.viewportSize() || { width: 1100, height: 750 };
  await page.mouse.click(Math.max(0, Math.min(1, fx)) * vp.width, Math.max(0, Math.min(1, fy)) * vp.height);
  await page.waitForTimeout(900);
  return snap(slot);
}
export async function viewType(slot, text, enter) {
  const { page } = await ensureSession(slot);
  await page.keyboard.type(String(text || '').slice(0, 300), { delay: 12 });
  if (enter) await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  return snap(slot);
}
export async function viewBack(slot) {
  const { page } = await ensureSession(slot);
  await page.goBack({ timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(700);
  return snap(slot);
}
