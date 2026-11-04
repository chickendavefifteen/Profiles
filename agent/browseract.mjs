// The legacy prepare/run tool is separately confirmed and saves explicit
// staging/browser receipts. Ordinary live-tab actors keep screenshots in
// memory only and may mutate only their pinned, still-selected generation.
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { slotPaths } from './slots.mjs';
import { hasNative, requestNative } from './native-browser.mjs';

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
  if (usesNative(job.slot)) return { ok: false, error: 'The native shell uses its displayed WebView, not a second headless browser.' };
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

/* Each person owns one persistent context and independent live pages.
   Changing tabs only changes the selected page; it never navigates. */
const sessions = new Map();
const pendingSessions = new Map();
const tabCounters = new Map();
const browserTarget = new AsyncLocalStorage();
const screencasts = new Map();
const pendingScreencasts = new Map();
const screencastStops = new Map();
const frameSeq = new Map();
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

function reserveTabId(slot, requested) {
  const next = (tabCounters.get(slot) || 0) + 1;
  const number = requested === undefined ? next : Number(String(requested).match(/^tab-([1-9]\d*)$/)?.[1]);
  if (!Number.isSafeInteger(number) || number < next || String(requested ?? `tab-${number}`) !== `tab-${number}`) {
    throw new Error('New tab id must be an unused, increasing tab-N');
  }
  tabCounters.set(slot, number);
  return `tab-${number}`;
}

function activateTab(session, tab) {
  if (session.activeTabId === tab.id) return;
  session.activeTabId = tab.id;
  session.generation++;
  void stopScreencast(session.slot).catch(() => {});
}

function removeClosedTab(session, tab) {
  if (session.tabs.get(tab.id) !== tab) return;
  const ids = [...session.tabs.keys()];
  const index = ids.indexOf(tab.id);
  session.tabs.delete(tab.id);
  if (session.activeTabId !== tab.id) return;
  session.activeTabId = null;
  session.generation++;
  void stopScreencast(session.slot).catch(() => {});
  const next = [...session.tabs.values()][Math.min(index, session.tabs.size - 1)];
  if (next) activateTab(session, next);
  else if (!session.closing) void ensureActiveTab(session).catch(() => {});
}

function registerTab(session, page, { id, select = true } = {}) {
  const existing = session.pages.get(page);
  if (existing) return existing;
  const tab = { id: id || reserveTabId(session.slot), page, zoom: 1, loading: false };
  session.tabs.set(tab.id, tab);
  session.pages.set(page, tab);
  page.on('request', request => {
    try { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) tab.loading = true; } catch {}
  });
  page.on('requestfailed', request => {
    try { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) tab.loading = false; } catch {}
  });
  page.on('domcontentloaded', () => {
    tab.loading = false;
    if (tab.zoom !== 1) void page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, tab.zoom).catch(() => {});
  });
  page.on('load', () => { tab.loading = false; });
  page.on('popup', popup => {
    if (!session.closing && !popup.isClosed()) registerTab(session, popup);
  });
  page.once('close', () => removeClosedTab(session, tab));
  if (select || !session.activeTabId) activateTab(session, tab);
  return tab;
}

async function ensureActiveTab(session) {
  const current = session.tabs.get(session.activeTabId);
  if (current && !current.page.isClosed()) return current;
  if (session.replacement) return session.replacement;
  session.replacement = (async () => {
    session.creating++;
    let page;
    try { page = await session.ctx.newPage(); }
    finally { session.creating--; }
    if (session.closing) {
      await page.close().catch(() => {});
      throw new Error('Browser context closed');
    }
    return registerTab(session, page);
  })().finally(() => { session.replacement = null; });
  return session.replacement;
}

async function buildSession(slot) {
  const { chromium } = await import('playwright');
  const paths = slotPaths(slot);
  const profileDir = join(paths.root, 'browser-profile-' + (process.env.PROFILES_SERVER_PORT || process.env.PROFILES_AGENT_PORT || 'main'));
  await mkdir(profileDir, { recursive: true });
  const opts = { viewport: { width: 1280, height: 800 }, headless: true, env: browserEnv,
    args: ['--no-first-run', '--mute-audio', '--disable-gpu', '--disable-dev-shm-usage'] };
  let ctx;
  try { ctx = await chromium.launchPersistentContext(profileDir, opts); }
  catch (error) { console.error('[profiles] Browser launch failed for slot ' + slot + ':', error); throw error; }
  const session = { slot, ctx, browser: ctx, tabs: new Map(), pages: new WeakMap(), activeTabId: null,
    generation: 0, creating: 0, replacement: null, mutations: Promise.resolve(), closing: false };
  ctx.on('close', () => {
    session.closing = true;
    session.tabs.clear();
    if (sessions.get(slot) === session) {
      sessions.delete(slot);
      void stopScreencast(slot).catch(() => {});
    }
  });
  for (const page of ctx.pages()) {
    if (!page.isClosed()) registerTab(session, page, { select: false });
  }
  ctx.on('page', page => {
    if (!session.closing && !session.creating && !page.isClosed()) registerTab(session, page);
  });
  // New contexts stay genuinely blank until the user requests a URL.
  await ensureActiveTab(session);
  return session;
}

async function ensureState(slot) {
  if (usesNative(slot)) throw new Error('The native shell uses its displayed WebView, not a second headless browser.');
  const current = sessions.get(slot);
  if (current) {
    if (current.closing) throw new Error('Browser context closed');
    return current;
  }
  if (!pendingSessions.has(slot)) {
    const pending = buildSession(slot).then(session => {
      sessions.set(slot, session);
      return session;
    }).finally(() => { pendingSessions.delete(slot); });
    pendingSessions.set(slot, pending);
  }
  return pendingSessions.get(slot);
}

function pinTab(session, tab) {
  return { slot: session.slot, tabId: tab.id, page: tab.page, ctx: session.ctx, browser: session.browser,
    tab, session, generation: session.generation };
}

export async function ensureSession(slot) {
  const pinned = browserTarget.getStore();
  if (pinned?.slot === slot) {
    assertLiveTarget(pinned);
    return pinned;
  }
  // Capture a warm selected page before the first await, not after a tab switch.
  const current = sessions.get(slot);
  if (!usesNative(slot) && current && !current.closing) {
    const tab = current.tabs.get(current.activeTabId);
    if (tab && !tab.page.isClosed()) return pinTab(current, tab);
  }
  const session = await ensureState(slot);
  return pinTab(session, await ensureActiveTab(session));
}

export async function withBrowserTab(slot, tabId, fn) {
  // Text-only asks must not launch a browser, or adopt a tab selected later.
  const current = sessions.get(slot);
  if (tabId === undefined || tabId === null || tabId === '') {
    if (browserTarget.getStore()?.slot === slot) return fn();
    const tab = current && !current.closing ? current.tabs.get(current.activeTabId) : null;
    return tab && !tab.page.isClosed() ? browserTarget.run(pinTab(current, tab), fn) : fn();
  }
  const session = current || (pendingSessions.has(slot) ? await pendingSessions.get(slot) : null);
  const tab = session && !session.closing ? session.tabs.get(tabId) : null;
  if (!tab || tab.page.isClosed()) return { ok: false, slot, tabId, error: 'Browser tab is closed or unknown' };
  return browserTarget.run(pinTab(session, tab), fn);
}

export async function closeAllSessions() {
  await Promise.allSettled([...pendingSessions.values()]);
  const live = [...sessions.values()];
  for (const session of live) session.closing = true;
  await Promise.allSettled([...screencasts].map(([slot, cast]) => stopScreencast(slot, cast)));
  await Promise.allSettled([...pendingScreencasts.values()]);
  await Promise.allSettled(live.map(session => session.ctx.close()));
  sessions.clear();
}
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => { await closeAllSessions().catch(() => {}); process.exit(0); });
}

async function tabSnapshot(session) {
  const activeTabId = session.activeTabId;
  const tabs = await Promise.all([...session.tabs.values()].map(async tab => ({
    id: tab.id, title: await tab.page.title().catch(() => ''), url: tab.page.url(), zoom: tab.zoom, loading: tab.loading
  })));
  const current = tabs.find(tab => tab.id === activeTabId);
  return { ok: true, slot: session.slot, activeTabId, tabs,
    tabId: activeTabId, url: current?.url || 'about:blank', title: current?.title || '' };
}

function mutateTabs(session, fn) {
  const result = session.mutations.then(fn);
  session.mutations = result.catch(() => {});
  return result;
}

export async function browserTabs(slot) {
  const session = await ensureState(slot);
  await ensureActiveTab(session);
  return tabSnapshot(session);
}

export async function createBrowserTab(slot, { id, url } = {}) {
  const session = await ensureState(slot);
  return mutateTabs(session, async () => {
    let page;
    try {
      const tabId = reserveTabId(slot, id);
      session.creating++;
      try { page = await session.ctx.newPage(); }
      finally { session.creating--; }
      registerTab(session, page, { id: tabId });
      if (url && url !== 'about:blank') await page.goto(normViewUrl(url), { timeout: 15000, waitUntil: 'domcontentloaded' });
      return tabSnapshot(session);
    } catch (error) {
      return { ...(await tabSnapshot(session)), ok: false, error: String(error?.message || error).slice(0, 200) };
    }
  });
}

export async function selectBrowserTab(slot, tabId) {
  const session = await ensureState(slot);
  return mutateTabs(session, async () => {
    const tab = session.tabs.get(tabId);
    if (!tab || tab.page.isClosed()) return { ...(await tabSnapshot(session)), ok: false, error: 'Browser tab is closed or unknown' };
    activateTab(session, tab);
    return tabSnapshot(session);
  });
}

export async function closeBrowserTab(slot, tabId) {
  const session = await ensureState(slot);
  return mutateTabs(session, async () => {
    const tab = session.tabs.get(tabId);
    if (!tab || tab.page.isClosed()) return { ...(await tabSnapshot(session)), ok: false, error: 'Browser tab is closed or unknown' };
    try {
      await tab.page.close({ runBeforeUnload: false });
      await ensureActiveTab(session);
      return tabSnapshot(session);
    } catch (error) {
      return { ...(await tabSnapshot(session)), ok: false, error: String(error?.message || error).slice(0, 200) };
    }
  });
}

function actionError(target, error, prefix = '') {
  return { ok: false, ...(target ? { slot: target.slot, tabId: target.tabId } : {}),
    error: prefix + String(error?.message || error).slice(0, 200) };
}

async function snap(slot, target) {
  target ||= await ensureSession(slot);
  const { page, tabId, tab } = target;
  try {
    assertLiveTarget(target);
    await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
    const title = await page.title();
    assertLiveTarget(target);
    return { ok: true, slot, tabId, title, url: page.url(), zoom: tab.zoom, loading: tab.loading };
  } catch (error) { return actionError(target, error, 'page closed: '); }
}

export function getFrameSeq(slot) { return frameSeq.get(slot) || 0; }

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(what + ' timed out')), ms);
  })]).finally(() => clearTimeout(timer));
}

function isActiveTarget(target) {
  const session = sessions.get(target.slot);
  return session === target.session && !session.closing && session.activeTabId === target.tabId
    && session.generation === target.generation && !target.page.isClosed();
}

function assertLiveTarget(target) {
  const session = sessions.get(target.slot);
  if (session !== target.session || session.closing || session.tabs.get(target.tabId) !== target.tab || target.page.isClosed()) {
    throw new Error('Browser tab is closed or its session was replaced');
  }
}

function assertActiveTarget(target) {
  assertLiveTarget(target);
  if (!isActiveTarget(target)) throw new Error('Browser tab changed before the action; select it and try again');
}

async function typeOnTarget(target, text) {
  // Playwright's delayed type() queues the entire string. Check each character
  // so switching away cannot leave hidden tabs receiving the remaining input.
  for (const character of text) {
    assertActiveTarget(target);
    await target.page.keyboard.type(character);
  }
}

export async function ensureScreencast(slot) {
  const target = await ensureSession(slot);
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = pendingScreencasts.get(slot);
    if (pending) await pending.catch(() => {});
    if (!isActiveTarget(target)) throw new Error('Browser tab changed before the stream opened');
    let cast = screencasts.get(slot);
    if (cast && (cast.dead || cast.page !== target.page || cast.generation !== target.generation)) {
      await stopScreencast(slot, cast);
      cast = null;
    }
    if (!cast) {
      const building = (async () => {
        await screencastStops.get(slot);
        if (!isActiveTarget(target)) throw new Error('Browser tab changed before the stream opened');
        const created = await buildScreencast(target);
        if (!isActiveTarget(target)) {
          await created.stop();
          throw new Error('Browser tab changed before the stream opened');
        }
        screencasts.set(slot, created);
        return created;
      })();
      pendingScreencasts.set(slot, building);
      try { cast = await building; }
      finally { if (pendingScreencasts.get(slot) === building) pendingScreencasts.delete(slot); }
    }
    const proof = await withTimeout(
      target.page.screenshot({ type: 'jpeg', quality: 70, timeout: 10000 }), 11000, 'proof shot').catch(() => null);
    if (proof?.length > 500 && !cast.dead && isActiveTarget(target)) {
      cast.proof = proof;
      return cast;
    }
    await stopScreencast(slot, cast);
    if (!isActiveTarget(target)) throw new Error('Browser tab changed before the stream opened');
  }
  throw new Error('browser produced no render');
}

async function buildScreencast(target) {
  const { page, slot, tabId, generation } = target;
  const { PassThrough } = await import('node:stream');
  const cdp = await page.context().newCDPSession(page);
  const boundary = 'profileframe' + randomBytes(8).toString('hex');
  const stream = new PassThrough();
  let latest = null;
  let stopping;
  const cast = { cdp, page, slot, tabId, generation, dead: false, boundary, stream, latest: () => latest };
  const onFrame = async ({ data, sessionId }) => {
    try {
      if (!cast.dead) {
        latest = Buffer.from(data, 'base64');
        frameSeq.set(slot, (frameSeq.get(slot) || 0) + 1);
        if (stream.writableLength < 1024 * 1024) {
          stream.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${latest.length}\r\n\r\n`);
          stream.write(latest);
          stream.write('\r\n');
        }
      }
    } catch {}
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
  };
  const onClose = () => { void stopScreencast(slot, cast).catch(() => {}); };
  cast.stop = () => {
    if (stopping) return stopping;
    cast.dead = true;
    cdp.off('Page.screencastFrame', onFrame);
    page.off('close', onClose);
    stream.end();
    stopping = (async () => {
      try { await cdp.send('Page.stopScreencast'); } catch {}
      try { await cdp.detach(); } catch {}
    })();
    return stopping;
  };
  cdp.on('Page.screencastFrame', onFrame);
  page.once('close', onClose);
  try {
    const viewport = page.viewportSize() || { width: 1280, height: 800 };
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80,
      maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
    return cast;
  } catch (error) {
    await cast.stop();
    throw error;
  }
}

// The owner is the exact object returned by ensureScreencast, not a tab id.
// A late close from an old HTTP response must not stop its replacement.
export async function stopScreencast(slot, owner) {
  const cast = screencasts.get(slot);
  if (!cast || (owner && cast !== owner)) return;
  screencasts.delete(slot);
  const previous = screencastStops.get(slot);
  const stopping = Promise.allSettled([previous, cast.stop()]).then(() => {});
  screencastStops.set(slot, stopping);
  await stopping;
  if (screencastStops.get(slot) === stopping) screencastStops.delete(slot);
}

export async function mouseAct(slot, kind, fx, fy, w, h) {
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    const { page } = target;
    const viewport = page.viewportSize() || { width: w || 1280, height: h || 800 };
    if (kind === 'move') await page.mouse.move(fx * viewport.width, fy * viewport.height);
    else if (kind === 'down') await page.mouse.down();
    else if (kind === 'up') await page.mouse.up();
    else if (kind === 'click') await page.mouse.click(fx * viewport.width, fy * viewport.height);
    else if (kind === 'dblclick') await page.mouse.dblclick(fx * viewport.width, fy * viewport.height);
    else if (kind === 'wheel') await page.mouse.wheel(0, fy || 120);
    else return actionError(target, 'Unsupported mouse action');
    return { ok: true, slot, tabId: target.tabId };
  } catch (error) { return actionError(target, error); }
}

export async function keysAct(slot, kind, key, text) {
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    const { page } = target;
    if (kind === 'type' && typeof text === 'string' && text.length) await typeOnTarget(target, text.slice(0, 2000));
    else if (kind === 'press' && key) await page.keyboard.press(key);
    else if (kind === 'down' && key) await page.keyboard.down(key);
    else if (kind === 'up' && key) await page.keyboard.up(key);
    else return actionError(target, 'Keyboard action needs a supported kind and text or key');
    return { ok: true, slot, tabId: target.tabId };
  } catch (error) { return actionError(target, error); }
}

// Missing named targets never redirect input to an unrelated focused field.
async function pageTarget(page, selector, typing) {
  const css = page.locator(selector).first();
  let count = 0;
  try { count = await css.count(); } catch {}
  if (count) return css;
  if (typing) {
    const input = page.getByPlaceholder(selector).first();
    return await input.count() ? input : null;
  }
  const button = page.getByRole('button', { name: selector }).first();
  if (await button.count()) return button;
  const text = page.getByText(selector, { exact: false }).first();
  return await text.count() ? text : null;
}

export async function viewType(slot, text, selector, press, clear) {
  if (typeof text !== 'string' || !text.length || text.length > 2000) return { ok: false, error: 'Type needs text (1–2000 characters)' };
  if (usesNative(slot)) return requestNative(slot, 'type', { text, selector, press, clear });
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    const { page } = target;
    if (selector) {
      const input = await pageTarget(page, selector, true);
      if (!input) return actionError(target, 'Input target not found: ' + selector);
      assertActiveTarget(target);
      // Do not leave an actionability-waiting fill queued on a hidden tab.
      await input.fill(text, { timeout: 4000, force: true });
      if (press) {
        assertActiveTarget(target);
        await page.keyboard.press(press);
      }
    } else {
      const focused = page.locator(':focus').first();
      if (!await focused.count() || !await focused.isEditable()) return actionError(target, 'No editable input is focused');
      assertActiveTarget(target);
      if (clear) {
        await focused.fill('', { timeout: 4000, force: true });
        assertActiveTarget(target);
      }
      await typeOnTarget(target, text);
      if (press) {
        assertActiveTarget(target);
        await page.keyboard.press(press);
      }
    }
    return { ...(await snap(slot, target)), typed: text, ...(selector ? { selector } : {}) };
  } catch (error) { return actionError(target, error); }
}

export async function viewClick(slot, fx, fy, selector) {
  const coordinates = fx !== undefined || fy !== undefined;
  if ((coordinates || !selector) && (!Number.isFinite(fx) || !Number.isFinite(fy) || fx < 0 || fx > 1 || fy < 0 || fy > 1)) {
    return { ok: false, error: 'Click needs a selector or both fx/fy coordinates between 0 and 1' };
  }
  if (usesNative(slot)) {
    const out = await requestNative(slot, 'click', { fx, fy, selector });
    // Visible computer-use: plant the virtual cursor where the click landed so
    // the action is seen, not just done. Fire-and-forget: never fails a click.
    if (out && out.ok) {
      const px = Number.isFinite(out.fx) ? out.fx : fx, py = Number.isFinite(out.fy) ? out.fy : fy;
      if (Number.isFinite(px) && Number.isFinite(py)) requestNative(slot, 'cursor', { show: true, fx: px, fy: py });
    }
    return out;
  }
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    const { page } = target;
    if (selector) {
      const element = await pageTarget(page, selector, false);
      if (!element) return actionError(target, 'Click target not found: ' + selector);
      assertActiveTarget(target);
      // A trial may await actionability but cannot emit input. Recheck the
      // generation afterwards; the real click must not queue another wait.
      await element.click({ trial: true, timeout: 4000 });
      assertActiveTarget(target);
      await element.click({ force: true, timeout: 4000 });
      return { ...(await snap(slot, target)), clicked: selector };
    }
    const viewport = page.viewportSize() || { width: 1280, height: 800 };
    await page.mouse.click(fx * viewport.width, fy * viewport.height);
    return { ...(await snap(slot, target)), click: { ok: true, slot, tabId: target.tabId } };
  } catch (error) { return actionError(target, error); }
}

export async function viewPress(slot, key) {
  if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'Press needs a key name' };
  if (usesNative(slot)) return requestNative(slot, 'press', { key });
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    await target.page.keyboard.press(key);
    return { ...(await snap(slot, target)), pressed: key };
  } catch (error) { return actionError(target, error); }
}

export async function viewScreenshot(slot, fullPage) {
  if (usesNative(slot)) return requestNative(slot, 'screenshot', { fullPage });
  let target;
  try {
    target = await ensureSession(slot);
    const { page, tabId } = target;
    const png = await page.screenshot({ type: 'png', fullPage: !!fullPage, timeout: 15000 });
    if (png.length > MAX_SCREENSHOT_BYTES) return actionError(target, 'Screenshot exceeds the 4 MiB PNG limit');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    const url = page.url(), title = await page.title();
    assertLiveTarget(target);
    return { ok: true, slot, tabId, url, title, mime: 'image/png', width, height,
      bytes: png.length, fullPage: !!fullPage, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
  } catch (error) { return actionError(target, error); }
}

export function normViewUrl(url) {
  const value = String(url || '').trim();
  if (value === 'about:blank') return value;
  if (!value) return 'https://www.google.com';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(value)) return 'https://' + value;
  return 'https://www.google.com/search?q=' + encodeURIComponent(value);
}

export async function viewGo(slot, url) {
  const destination = normViewUrl(url);
  if (usesNative(slot)) return requestNative(slot, 'navigate', { url: destination });
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    await target.page.goto(destination, { timeout: 15000, waitUntil: 'domcontentloaded' });
    return snap(slot, target);
  } catch (error) { return { ...actionError(target, error, 'Navigation failed: '), url: destination }; }
}

export async function viewHome(slot) { return viewGo(slot, 'https://www.google.com'); }

export async function viewZoom(slot, value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 2) return { ok: false, error: 'Zoom must be 50–200%' };
  if (usesNative(slot)) return requestNative(slot, 'zoom', { zoom });
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    await target.page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    target.tab.zoom = zoom;
    return { ok: true, slot, tabId: target.tabId, zoom };
  } catch (error) { return actionError(target, error); }
}

export async function viewSize(slot, w, h) {
  w = Math.max(320, Math.min(1920, Math.round(Number(w) || 1280)));
  h = Math.max(200, Math.min(1200, Math.round(Number(h) || 800)));
  if (usesNative(slot)) return requestNative(slot, 'resize', { width: w, height: h });
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    await target.page.setViewportSize({ width: w, height: h });
    const cast = screencasts.get(slot);
    if (cast && !cast.dead && cast.page === target.page && cast.generation === target.generation) {
      await cast.cdp.send('Page.stopScreencast');
      assertActiveTarget(target);
      if (!cast.dead) await cast.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80,
        maxWidth: w, maxHeight: h, everyNthFrame: 1 });
    }
    return { ...(await snap(slot, target)), w, h };
  } catch (error) { return actionError(target, error); }
}

async function viewHistory(slot, action) {
  if (usesNative(slot)) return requestNative(slot, action);
  let target;
  try {
    target = await ensureSession(slot);
    assertActiveTarget(target);
    const options = { timeout: 15000, waitUntil: 'domcontentloaded' };
    if (action === 'back') await target.page.goBack(options);
    else if (action === 'forward') await target.page.goForward(options);
    else await target.page.reload(options);
    return snap(slot, target);
  } catch (error) { return actionError(target, error, action + ' failed: '); }
}

export async function viewBack(slot) { return viewHistory(slot, 'back'); }
export async function viewForward(slot) { return viewHistory(slot, 'forward'); }
export async function viewReload(slot) { return viewHistory(slot, 'reload'); }

export async function viewCurrent(slot) {
  return usesNative(slot) ? requestNative(slot, 'current') : snap(slot);
}

export async function viewRead(slot) {
  if (usesNative(slot)) return requestNative(slot, 'read');
  let target;
  try {
    target = await ensureSession(slot);
    const text = await target.page.locator('body').innerText({ timeout: 8000 });
    const title = await target.page.title();
    assertLiveTarget(target);
    return { ok: true, slot, tabId: target.tabId, title, url: target.page.url(), text: String(text).slice(0, 4000) };
  } catch (error) { return actionError(target, error, 'read failed: '); }
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
    catch (e) { return { ok: false, slot, error: String((e && e.message) || e).slice(0, 200), query: q, results: [], native: true, pageUrl: searchUrl }; }
    if (!nav || !nav.ok) {
      return { ok: false, error: String((nav && nav.error) || 'native navigation failed').slice(0, 200),
        slot, tabId: nav?.tabId, query: q, results: [], native: true, pageUrl: (nav && nav.url) || searchUrl };
    }
    let rd = null;
    try { rd = await requestNative(slot, 'read', { tabId: nav.tabId }); }
    catch (e) { return { ok: false, slot, tabId: nav.tabId, error: String((e && e.message) || e).slice(0, 200), query: q, results: [], native: true, pageUrl: nav.url || searchUrl }; }
    if (!rd || !rd.ok) {
      return { ok: false, error: String((rd && rd.error) || 'native read failed').slice(0, 200),
        slot, tabId: nav.tabId, query: q, results: [], native: true, pageUrl: (rd && rd.url) || nav.url || searchUrl };
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
        slot, tabId: nav.tabId, query: q, results: [], native: true, pageUrl: rd.url || nav.url || searchUrl, via: 'bing-native' };
    }
    return { ok: true, slot, tabId: nav.tabId, query: q, results, via: 'bing-native', pageUrl: rd.url || searchUrl, native: true };
  }
  let sess;
  try { sess = await ensureSession(slot); assertActiveTarget(sess); }
  catch (e) { return { ok: false, slot, error: String(e.message || e).slice(0, 200), query: q, results: [] }; }
  const { page, tabId } = sess;
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
     rate-limited IP poisons the whole visible session. Headed user search
     (main.js searchUrl, start page) defaults Google — never this path. */
  try {
    assertActiveTarget(sess);
    await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(q), { timeout: 25000 });
    await page.waitForTimeout(1200).catch(() => {});
    assertActiveTarget(sess);
    const results = (await extractBing()).filter((r) => r.title && /^https?:\/\//.test(r.href));
    assertActiveTarget(sess);
    if (results.length) return { ok: true, slot, tabId, query: q, results, via: 'bing', pageUrl: page.url() };
  } catch (error) {
    if (!isActiveTarget(sess)) return { ...actionError(sess, error), query: q, results: [] };
  }
  /* Pass 2: DuckDuckGo html (often challenged; cheap to try). */
  try {
    assertActiveTarget(sess);
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
    assertActiveTarget(sess);
    if (results.length) return { ok: true, slot, tabId, query: q, results, via: 'duckduckgo', pageUrl: page.url() };
  } catch (error) {
    if (!isActiveTarget(sess)) return { ...actionError(sess, error), query: q, results: [] };
  }
  let pageUrl = '';
  try { pageUrl = page.url() || ''; } catch {}
  return { ok: false, slot, tabId, query: q, results: [], via: 'none', pageUrl,
    error: 'No usable search results were returned. The Browser pane shows the last attempted search; read it there or try different words.' };
}