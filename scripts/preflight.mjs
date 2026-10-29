#!/usr/bin/env node
// Preflight gate: run before QA, screenshots, launches, or "verified"
// claims. Refuses to certify a stale or dead stack.
// Usage: node scripts/preflight.mjs [--port 1420]
import { execSync } from 'node:child_process';
const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 1420);
const base = `http://localhost:${port}`;
let fail = 0;
const ok = (c, n) => { console.log((c ? 'ok' : 'FAIL') + ' - ' + n); if (!c) fail++; };
const j = async (p, o) => (await (await fetch(base + p, o)).json());
try {
  const h = await j('/api/health');
  ok(h && h.ok, `sidecar alive on :${port}`);
  let head = '';
  try { head = execSync('git rev-parse --short HEAD', { timeout: 4000 }).toString().trim(); } catch {}
  const dirty = (() => { try { return execSync('git status --porcelain -- src agent server.mjs', { timeout: 4000 }).toString().trim(); } catch { return ''; } })();
  ok(!!h.build, 'health carries build stamp (saw ' + (h.build || 'none') + ')');
  if (head && h.build && !h.build.startsWith(head)) {
    ok(false, `server build ${h.build} != disk ${head}${dirty ? '-dirty' : ''} — RESTART THE SERVER, results would certify stale code`);
  } else {
    ok(true, 'server build matches disk (' + (h.build || '?') + ')');
  }
  const caps = await j('/api/capabilities');
  ok(caps && (caps.modelsPresent || []).length > 0, 'local model present (' + ((caps && caps.modelsPresent || []).join(', ') || 'none') + ')');
  const poster = await fetch(base + '/api/browser/poster');
  const buf = Buffer.from(await poster.arrayBuffer());
  const img = buf.length > 2000 && ((buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50));
  ok(poster.ok && img, 'browser renders (' + buf.length + ' bytes, live session)');
} catch (e) {
  ok(false, 'preflight fetch failed: ' + String(e.message || e).slice(0, 140));
}
console.log(fail ? `\nPREFLIGHT RED — fix the stack before claiming anything` : '\nPREFLIGHT GREEN');
process.exit(fail ? 1 : 0);
