#!/usr/bin/env node
// Preflight gate: run before QA or "verified" claims. Refuses stale/dead stacks.
// Default: owns an ephemeral server (free loopback port + throwaway vault,
// keyring disabled) so it never touches a shared user vault, never resets
// slots, never kills foreign servers. Explicit --port probes that port only
// (no spawn, no teardown, read-only GETs).
// Only the owned-server route opens a muted, software/headless fixture browser.
// Usage: node scripts/preflight.mjs [--port 1420]
import { execSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {ensureSoftwareRuntime} from './qa-software-runtime.mjs';
ensureSoftwareRuntime();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const explicitPort = process.argv.includes('--port')
  ? Number(process.argv[process.argv.indexOf('--port') + 1])
  : NaN;
const hasExplicitPort = Number.isFinite(explicitPort);

function diskHead() {
  try { return execSync('git rev-parse --short HEAD', { cwd: root, timeout: 4000 }).toString().trim(); }
  catch { return ''; }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function waitHealthy(base, timeoutMs = 25000, expectedPid) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j && j.ok && (expectedPid===undefined || j.pid===expectedPid)) return j;
      }
    } catch {}
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 300));
  }
}

let fail = 0;
const ok = (c, n) => { console.log((c ? 'ok' : 'FAIL') + ' - ' + n); if (!c) fail++; };

let base = '';
let child = null;
let vault = '';
try {
  if (hasExplicitPort) {
    base = `http://localhost:${explicitPort}`;
    const h = await waitHealthy(base, 8000);
    ok(!!h, `sidecar alive on :${explicitPort} (explicit probe, read-only)`);
    if (!h) throw new Error('explicit server not healthy');
    const head = diskHead();
    ok(!!h.build, 'health carries build stamp (saw ' + (h.build || 'none') + ')');
    if (head && h.build && !String(h.build).startsWith(head)) {
      ok(false, `server build ${h.build} != disk ${head} — restart that server, refusing to certify stale code`);
    } else {
      ok(true, 'server build matches disk (' + (h.build || '?') + ')');
    }
  } else {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    vault = await mkdtemp(join(tmpdir(), 'profiles-preflight-vault-'));
    child = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
      cwd: root,
      env: { ...process.env, PROFILES_VAULT_DIR: vault, PROFILES_DISABLE_KEYRING: '1', PORT: String(port) },
      stdio: 'pipe',
    });
    let out = '';
    child.stdout?.on('data', (d) => { out += String(d); });
    child.stderr?.on('data', (d) => { out += String(d); });
    const h = await waitHealthy(base, 25000, child.pid);
    if (!h) {
      console.log('owned server did not boot; tail:\n' + out.slice(-2000));
      ok(false, `owned ephemeral server boots healthy on :${port}`);
      throw new Error('owned server failed to boot');
    }
    ok(true, `owned ephemeral server boots healthy on a free loopback port`);
    const head = diskHead();
    ok(!!h.build, 'health carries build stamp (saw ' + (h.build || 'none') + ')');
    if (head && h.build && !String(h.build).startsWith(head)) {
      ok(false, `owned server build ${h.build} != disk ${head} — refusing to certify stale code`);
    } else {
      ok(true, 'owned server build matches disk (' + (h.build || '?') + ')');
    }
  }

  // Models endpoint reachable (read-only; never requires a key or a present model).
  try {
    const r = await fetch(base + '/api/agent/models');
    const j = await r.json().catch(() => null);
    ok(r.ok && j && Array.isArray(j.choices), 'agent model availability reachable (no inference)');
  } catch (e) {
    ok(false, 'agent models endpoint reachable (read-only): ' + String(e?.message || e).slice(0, 120));
  }

  // Server-side poster render (no headed browser, no host window, no audio/GPU).
  if (!hasExplicitPort) {
    const opened=await fetch(base+'/api/browser/view',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({url:base+'/api/test/click-target'}),signal:AbortSignal.timeout(25000)});
    const observed=await opened.json();
    ok(opened.ok && observed.ok && observed.title==='CLICKTEST-READY','owned browser opens the actual local fixture');
  }
  try {
    const poster = await fetch(base + '/api/browser/poster');
    const buf = Buffer.from(await poster.arrayBuffer());
    const img = buf.length > 2000 && ((buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50));
    ok(poster.ok && img, 'browser poster renders server-side (' + buf.length + ' bytes, no headed launch)');
  } catch (e) {
    ok(false, 'browser poster renders server-side: ' + String(e?.message || e).slice(0, 120));
  }
} catch (e) {
  ok(false, 'preflight harness error: ' + String(e?.message || e).slice(0, 140));
} finally {
  // Owned teardown only: never kills foreign apps/servers.
  try { child?.kill(); } catch {}
  try { if (vault) await rm(vault, { recursive: true, force: true }); } catch {}
}

console.log(fail ? `\nPREFLIGHT RED — fix the stack before claiming anything` : '\nPREFLIGHT GREEN');
process.exit(fail ? 1 : 0);
