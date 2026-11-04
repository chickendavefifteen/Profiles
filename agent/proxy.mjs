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
import { readFile as readCookieFile, writeFile as writeCookieFile, mkdir as mkdirCookie } from 'node:fs/promises';
import { existsSync as existsCookie } from 'node:fs';
let jarTimer = null;
async function persistJars() {
  try {
    const { slotPaths } = await import('./slots.mjs');
    for (const [slot, jar] of jars) {
      const p = slotPaths(slot);
      await mkdirCookie(p.root, { recursive: true });
      const obj = {};
      for (const [host, ck] of jar) obj[host] = ck;
      await writeCookieFile(join(p.root, 'proxy-cookies.json'), JSON.stringify(obj));
    }
  } catch {}
}
function schedulePersist() {
  if (jarTimer) return;
  jarTimer = setTimeout(() => { jarTimer = null; persistJars().catch(() => {}); }, 2000);
}
async function loadJar(slot) {
  try {
    const { slotPaths } = await import('./slots.mjs');
    const f = join(slotPaths(slot).root, 'proxy-cookies.json');
    if (!existsCookie(f)) return;
    const obj = JSON.parse(await readCookieFile(f, 'utf8'));
    const jar = jarFor(slot);
    for (const [host, ck] of Object.entries(obj)) if (!jar.has(host)) jar.set(host, ck);
  } catch {}
}
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function jarFor(slot) {
  if (!jars.has(slot)) jars.set(slot, new Map());
  return jars.get(slot);
}
const jarsLoaded = new Set();
async function ensureJar(slot) {
  if (jarsLoaded.has(slot)) return;
  jarsLoaded.add(slot);
  await loadJar(slot);
}
function storeCookies(slot, host, headers) {
  const set = headers.getSetCookie ? headers.getSetCookie() : [];
  if (!set.length) return;
  ensureJar(slot).catch(() => {});
  const jar = jarFor(slot);
  const prev = jar.get(host) || '';
  const fresh = set.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  jar.set(host, prev ? prev + '; ' + fresh : fresh);
  schedulePersist();
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
  /* rewritten links stay in the pane (no forced new tabs) */
  out = out.replace(/<a\b([^>]*?)>/gi, (tag) => tag.replace(/\s+target\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''));
  out = out.replace(/(<form\b[^>]*?\baction\s*=\s*["'])([^"']*)(["'])([^>]*>)/gi, (m, pre, act, post, rest) => {
    if (/^(#|javascript:|mailto:|data:)/i.test(act.trim())) return m;
    const abs = absolutize(act, pageUrl);
    return pre + '/api/proxy?url=' + encodeURIComponent(abs) + post + rest +
      `<input type="hidden" name="__proxy_target" value="${encodeURIComponent(abs)}">`;
  });
  out = out.replace(/<form\b(?![^>]*\baction\b)([^>]*>)/gi, (m, rest) => {
    return `<form action="/api/proxy?url=${encodeURIComponent(pageUrl)}"${rest}<input type="hidden" name="__proxy_target" value="${encodeURIComponent(pageUrl)}">`;
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

/** Plain HTTP/1.1 fetch (http/https modules, never H2): search engines
   GOAWAY undici H2 sessions under bot-mitigation, while plain H1 sails
   through. Returns {status, headers, body, url}. */
import http from 'node:http';
import https from 'node:https';
function h1Fetch(url, { method = 'GET', headers = {}, body = null, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 8 * 1024 * 1024) { req.destroy(); reject(new Error('page too large to embed')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('upstream timeout')); });
    req.on('error', reject);
    if (body && method !== 'GET') req.write(body);
    req.end();
  });
}
/** Fetch through redirects with the slot jar. Returns {status, headers, body, url}. */
export async function fetchUpstream(url, slot, method = 'GET', body = null, contentType = '') {
  await ensureJar(slot);
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(current);
    const headers = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-GB,en;q=0.9' };
    const ck = cookieHeader(slot, u.host);
    if (ck) headers.cookie = ck;
    if (body && method !== 'GET') headers['content-type'] = contentType || 'application/x-www-form-urlencoded';
    let status, rheaders, buf;
    try {
      ({ status, headers: rheaders, body: buf } = await h1Fetch(current, { method, headers, body }));
    } catch (e) {
      return { status: 502, headers: {}, body: Buffer.from('proxy failed: ' + String(e.message || e).slice(0, 120)), url: current };
    }
    const setCookies = rheaders['set-cookie'] || [];
    if (setCookies.length) {
      const jar = jarFor(slot);
      const fresh = setCookies.map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
      const prev = jar.get(u.host) || '';
      jar.set(u.host, prev ? prev + '; ' + fresh : fresh);
      schedulePersist();
    }
    if ([301, 302, 303, 307, 308].includes(status)) {
      const loc = Array.isArray(rheaders.location) ? rheaders.location[0] : rheaders.location;
      if (!loc) return { status, headers: {}, body: Buffer.alloc(0), url: current };
      current = new URL(loc, current).toString();
      if (status === 303) { method = 'GET'; body = null; }
      continue;
    }
    if (buf.length > 8 * 1024 * 1024) return { status: 413, headers: {}, body: Buffer.from('page too large to embed'), url: current };
    const h = { get: (k) => rheaders[String(k).toLowerCase()], 'content-type': rheaders['content-type'] };
    return { status, headers: h, body: buf, url: current };
  }
  return { status: 508, headers: {}, body: Buffer.from('too many redirects'), url: current };
}
export function proxyUrl(url) {
  return '/api/proxy?url=' + encodeURIComponent(url);
}

/* ---- document paste-through: safe preview helpers (pure, tested) ----
   Doc-pane URL loads reuse this same framing proxy + slot cookie jar
   (fetchUpstream below); only the rendering differs: sanitized inline
   HTML for text kinds, an honest fallback for heavy binaries. */
const DOC_TEXT_EXT = ['md', 'markdown', 'txt', 'text', 'html', 'htm'];
const DOC_BINARY_EXT = ['pdf', 'docx', 'odt', 'pptx', 'ppt', 'doc', 'xls', 'xlsx'];
/** Classify a document URL: 'text' (renderable), 'binary' (honest
   fallback), or 'other'. Pure. */
export function docKindForUrl(raw) {
  const u = String(raw || '').split(/[?#]/)[0].toLowerCase();
  const m = /\.([a-z0-9]+)$/.exec(u.trim());
  if (!m) return 'other';
  if (DOC_TEXT_EXT.includes(m[1])) return 'text';
  if (DOC_BINARY_EXT.includes(m[1])) return 'binary';
  return 'other';
}
/** Sanitize pasted/fetched HTML for inline preview: no scripts, no
   handlers, no javascript: links, no embedded frames or forms. Pure. */
export function sanitizeDocHtml(html) {
  let out = String(html || '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  out = out.replace(/<(\/?)(iframe|frame|object|embed|form|input|button|select|textarea|meta|link|base)\b[^>]*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/(<a\b[^>]*?\bhref\s*=\s*["'])\s*javascript:[^"']*(["'])/gi, '$1#$2');
  return out;
}
