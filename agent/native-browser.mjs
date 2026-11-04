// The trusted app hosts the native page; tools request actions on that same page.
// A lease belongs to one profile and one app instance, never to remote page HTML.
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const tabContext = new AsyncLocalStorage();
const validTab = value => typeof value === 'string' && /^tab-[1-9]\d{0,8}$/.test(value);
export function withNativeTab(slot, tabId, fn) {
  if (tabId != null && !validTab(tabId)) return Promise.resolve({ ok: false, error: 'Invalid browser tab', slot, tabId });
  // A provider await must never turn this request into a capability for a
  // replacement app, even if it reconnects with the same tab id.
  const lease = hasNative(slot) ? leases.get(slot) : null;
  return tabContext.run({ slot, tabId: tabId ?? lease?.activeTabId, lease }, fn);
}
const leases = new Map();
const pending = new Map();
const actions = new Set(['navigate', 'current', 'read', 'back', 'forward', 'reload', 'zoom', 'resize', 'tabs', 'click', 'type', 'press', 'screenshot', 'cursor']);
const TTL = 45000;
export const MAX_NATIVE_RESULT_BYTES = 16 * 1024 * 1024;
export function registerNative(slot, tabId = 'tab-1') {
  const old = leases.get(slot);
  if (old) expire(old, 'Native browser reconnected');
  const lease = { slot, activeTabId: validTab(tabId) ? tabId : 'tab-1', token: randomBytes(24).toString('hex'), touched: Date.now(), queue: [] };
  leases.set(slot, lease);
  return { token: lease.token, expiresIn: TTL };
}
function expire(lease, reason) {
  if (leases.get(lease.slot) === lease) leases.delete(lease.slot);
  for (const [id, job] of pending) {
    if (job.token !== lease.token) continue;
    clearTimeout(job.timer);
    pending.delete(id);
    job.resolve({ ok: false, error: reason });
  }
}
function authenticate(token) {
  const lease = [...leases.values()].find(l => l.token === token);
  if (!lease) return null;
  if (Date.now() - lease.touched > TTL) { expire(lease, 'Native browser disconnected'); return null; }
  return lease;
}
export function hasNative(slot) {
  const lease = leases.get(slot);
  if (!lease) return false;
  if (Date.now() - lease.touched > TTL) { expire(lease, 'Native browser disconnected'); return false; }
  return true;
}
export function pollNative(token, tabId) {
  const lease = authenticate(token);
  if (!lease) return null;
  lease.touched = Date.now();
  if (validTab(tabId)) lease.activeTabId = tabId;
  return { slot: lease.slot, commands: lease.queue.splice(0) };
}
export function completeNative(token, id, result) {
  const lease = authenticate(token), job = pending.get(id);
  if (!lease || !job || job.token !== token) return false;
  const out = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const text = (value, max) => typeof value === 'string' ? value.slice(0,max) : '';
  // Preserve only sanitized safe links from the fixed native reader:
  // http(s) only, non-empty title, bounded count/length. The fixed reader
  // emits up to 100; keep all 100 here so search can filter Bing nav/
  // internal/Copilot links and decode redirects. Never trust
  // javascript:/data:/chrome: or bare paths — they never reach search.
  const links = [];
  if (Array.isArray(out.links)) {
    for (const item of out.links) {
      if (links.length >= 100) break;
      if (!item || typeof item !== 'object') continue;
      const href = text(item.href,2000).trim();
      const title = text(item.title,200).trim();
      if (!title) continue;
      if (!/^https?:\/\//i.test(href)) continue;
      links.push({ title, href });
    }
  }
  const image = job.action === 'screenshot' && out.ok === true
    && typeof out.dataUrl === 'string' && out.dataUrl.length <= MAX_NATIVE_RESULT_BYTES
    && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(out.dataUrl)
    && out.mime === 'image/png' && Number.isInteger(out.width) && out.width > 0
    && Number.isInteger(out.height) && out.height > 0
    ? { dataUrl: out.dataUrl, mime: out.mime, width: out.width, height: out.height } : null;
  const missingImage = job.action === 'screenshot' && out.ok === true && !image;
  const wrongTab = job.action !== 'tabs' && out.tabId && out.tabId !== job.tabId;
  const tabs = job.action === 'tabs' && Array.isArray(out.tabs) ? out.tabs.slice(0, 100)
    .filter(t => t && validTab(t.id)).map(t => ({
      id: t.id, title: text(t.title, 1000), url: text(t.url, 8192),
      zoom: Number.isFinite(t.zoom) ? t.zoom : 1, loading: t.loading === true
    })) : null;
  if (job.action === 'tabs' && out.ok === true) {
    if (validTab(out.activeTabId)) lease.activeTabId = out.activeTabId;
    else if (validTab(out.tabId)) lease.activeTabId = out.tabId;
  }
  clearTimeout(job.timer);
  pending.delete(id);
  job.resolve({ ok: out.ok === true && !missingImage && !wrongTab, slot:lease.slot,
    tabId: job.action === 'tabs' && validTab(out.tabId) ? out.tabId : job.tabId,
    url:text(out.url,8192), title:text(out.title,1000),
    text:text(out.text,12000), error: wrongTab ? 'Browser result belongs to another tab' : missingImage ? 'Native screenshot returned no valid PNG image' : text(out.error,500), links, native:true,
    ...(tabs ? { tabs, activeTabId: validTab(out.activeTabId) ? out.activeTabId : undefined } : {}),
    ...(image || {}),
    ...(typeof out.fullPage === 'boolean' ? { fullPage: out.fullPage } : {}),
    ...(out.clicked ? { clicked: text(out.clicked, 500) } : {}),
    ...(Number.isFinite(out.fx) && Number.isFinite(out.fy) ? { fx: Math.min(1, Math.max(0, out.fx)), fy: Math.min(1, Math.max(0, out.fy)) } : {}),
    ...(typeof out.cursor === 'boolean' ? { cursor: out.cursor } : {}),
    ...(out.typed ? { typed: text(out.typed, 2000) } : {}),
    ...(out.pressed ? { pressed: text(out.pressed, 100) } : {}),
    ...(out.path ? { path: text(out.path, 1000) } : {}),
    ...(Number.isFinite(out.zoom) ? {zoom:out.zoom} : {}),
    ...(typeof out.visible==='boolean' ? {visible:out.visible} : {}),
    ...(typeof out.loading==='boolean' ? {loading:out.loading} : {}) });
  return true;
}
export function requestNative(slot, action, args = {}) {
  if (!actions.has(action)) return Promise.resolve({ ok: false, error: 'Unsupported browser action' });
  const pinned = tabContext.getStore();
  const scoped = pinned?.slot === slot;
  const connected = hasNative(slot);
  const lease = connected ? leases.get(slot) : null;
  if (scoped && pinned.lease !== lease) {
    return Promise.resolve({ ok: false, slot, tabId: pinned.tabId, error: 'Native browser changed during this request', native: true });
  }
  if (!lease) return Promise.resolve({ ok: false, error: 'Native browser is not connected' });
  const id = randomBytes(12).toString('hex');
  const tabId = args.tabId || (scoped ? pinned.tabId : lease.activeTabId);
  if (!validTab(tabId)) return Promise.resolve({ ok: false, slot, error: 'Invalid browser tab' });
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id);
      lease.queue = lease.queue.filter(c => c.id !== id);
      resolve({ ok: false, slot, tabId, error: 'Native browser action timed out', native: true });
    }, 25000);
    pending.set(id, { token: lease.token, action, tabId, resolve, timer });
    lease.queue.push({ id, action, args, tabId });
  });
}
