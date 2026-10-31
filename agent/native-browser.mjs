// The trusted app hosts the native page; tools request actions on that same page.
// A lease belongs to one profile and one app instance, never to remote page HTML.
import { randomBytes } from 'node:crypto';
const leases = new Map();
const pending = new Map();
const actions = new Set(['navigate', 'current', 'read', 'back']);
const TTL = 45000;
export function registerNative(slot) {
  const old = leases.get(slot);
  if (old) expire(old, 'Native browser reconnected');
  const lease = { slot, token: randomBytes(24).toString('hex'), touched: Date.now(), queue: [] };
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
export function pollNative(token) {
  const lease = authenticate(token);
  if (!lease) return null;
  lease.touched = Date.now();
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
  clearTimeout(job.timer);
  pending.delete(id);
  job.resolve({ ok: out.ok === true, slot:lease.slot, url:text(out.url,8192), title:text(out.title,1000),
    text:text(out.text,12000), error:text(out.error,500), links, native:true,
    ...(Number.isFinite(out.zoom) ? {zoom:out.zoom} : {}),
    ...(typeof out.visible==='boolean' ? {visible:out.visible} : {}),
    ...(typeof out.loading==='boolean' ? {loading:out.loading} : {}) });
  return true;
}
export function requestNative(slot, action, args = {}) {
  if (!actions.has(action)) return Promise.resolve({ ok: false, error: 'Unsupported browser action' });
  if (!hasNative(slot)) return Promise.resolve({ ok: false, error: 'Native browser is not connected' });
  const lease = leases.get(slot), id = randomBytes(12).toString('hex');
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id);
      lease.queue = lease.queue.filter(c => c.id !== id);
      resolve({ ok: false, error: 'Native browser action timed out', native: true });
    }, 25000);
    pending.set(id, { token: lease.token, resolve, timer });
    lease.queue.push({ id, action, args });
  });
}
