// Framing proxy: any readable page becomes natively embeddable.
// Fetches the target server-side, strips X-Frame-Options + CSP
// frame-ancestors, rewrites link/form navigations to stay inside the
// proxy, absolutizes the rest. Per-slot in-memory cookie jar so a
// dismissed consent wall stays dismissed for the session.
// Logged-out browsing only: no auth, no websockets. Heavy JS apps may
// still refuse — the pane then says so with an open-external escape,
// never a white void.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jars = new Map(); // slot -> Map(host -> cookie string)
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function jarFor(slot) {
  if (!jars.has(slot)) jars.set(slot, new Map());
  return jars.get(slot);
}
function storeCookies(slot, host, headers) {
  const set = headers.getSetCookie ? headers.getSetCookie() : [];
  if (!set.length) return;
  const jar = jarFor(slot);
  const prev = jar.get(host) || '';
  const fresh = set.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  jar.set(host, prev ? prev + '; ' + fresh : fresh);
}
function cookieHeader(slot, host) {
  return jarFor(slot).get(host) || '';
}

function absolutize(raw, base) {
  if (!raw) return raw;
  const u = raw.trim();
  if (/^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(u)) return u;
  try {
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return new URL(base).protocol + u;
    return new URL(u, base).toString();
  } catch { return u; }
}

/** Rewrite one HTML doc so it lives inside the proxy. Pure + tested. */
export function rewriteHtml(html, pageUrl) {
  let out = String(html);
  // navigations stay proxied
  out = out.replace(/(<a\b[^>]*?\bhref\s*=\s*["'])([^"']*)(["'])/gi, (m, pre, href, post) => {
    if (/^(#|javascript:|mailto:|tel:|data:)/i.test(href.trim())) return m;
    return pre + '/api/proxy?url=' + encodeURIComponent(absolutize(href, pageUrl)) + post;
  });
  out = out.replace(/(<form\b[^>]*?\baction\s*=\s*["'])([^"']*)(["'])/gi, (m, pre, act, post) => {
    if (/^(#|javascript:|mailto:|data:)/i.test(act.trim())) return m;
    return pre + '/api/proxy?url=' + encodeURIComponent(absolutize(act, pageUrl)) + post;
  });
  // everything else loads direct, absolutized
  out = out.replace(/(<(?:img|script|link|source|video|audio|iframe)\b[^>]*?\b(?:src|href)\s*=\s*["'])([^"']*)(["'])/gi,
    (m, pre, u, post) => pre + absolutize(u, pageUrl) + post);
  // meta CSP frame-ancestors would re-block the embed
  out = out.replace(/(<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*content\s*=\s*["'])([^"']*)(["'])/gi,
    (m, pre, csp, post) => pre + csp.replace(/frame-ancestors[^;]*;?/gi, '') + post);
  return out;
}

function stripFraming(headers) {
  const out = {};
  const drop = new Set(['x-frame-options', 'content-security-policy', 'content-security-policy-report-only',
    'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy']);
  for (const [k, v] of headers) {
    const lk = k.toLowerCase();
    if (drop.has(lk)) {
      if (lk === 'content-security-policy') {
        const cleaned = String(v).replace(/frame-ancestors[^;]*;?/gi, '').trim();
        if (cleaned) out[k] = cleaned;
      }
      continue;
    }
    if (['content-type', 'content-length', 'cache-control', 'expires', 'etag', 'last-modified'].includes(lk)) out[k] = v;
  }
  out['cache-control'] = 'no-store';
  return out;
}

/** Fetch through redirects with the slot jar. Returns {status, headers, body, url}. */
export async function fetchUpstream(url, slot, method = 'GET', body = null, contentType = '') {
  let current = url;
  let jar = jarFor(slot);
  void jar;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(current);
    const headers = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-GB,en;q=0.9' };
    const ck = cookieHeader(slot, u.host);
    if (ck) headers.cookie = ck;
    if (body && method !== 'GET') headers['content-type'] = contentType || 'application/x-www-form-urlencoded';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch(current, { method, headers, body: method === 'GET' ? undefined : body, redirect: 'manual', signal: ctrl.signal });
    } finally { clearTimeout(timer); }
    storeCookies(slot, u.host, res.headers);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return { status: res.status, headers: {}, body: Buffer.alloc(0), url: current };
      await res.arrayBuffer().catch(() => {});
      current = new URL(loc, current).toString();
      if (res.status === 303) { method = 'GET'; body = null; }
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return { status: 413, headers: {}, body: Buffer.from('page too large to embed'), url: current };
    return { status: res.status, headers: res.headers, body: buf, url: current };
  }
  return { status: 508, headers: {}, body: Buffer.from('too many redirects'), url: current };
}

export function proxyUrl(url) {
  return '/api/proxy?url=' + encodeURIComponent(url);
}
