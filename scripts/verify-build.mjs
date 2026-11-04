#!/usr/bin/env node
// Every-build gate: preflight + unit + behaviour QA + proxy + click, all disposable.
// Default owns its servers (free loopback ports + throwaway vaults, keyring
// disabled): never touches a shared user vault, never resets slots, never kills
// foreign apps/servers. Behaviour QA is tests/qa/reliability.mjs (headless
// software-mute Chromium only); nothing here launches a headed browser, host
// window, audio, or GPU work. Exit codes decide, never numerical test counts or
// legacy iframe IDs. Binary freshness runs only with --check-native (explicit
// native build, separate from the default gate).
// Usage: node scripts/verify-build.mjs [--port 1420] [--skip-qa] [--check-native]
import { spawn, spawnSync } from 'node:child_process';
import { statSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {ensureSoftwareRuntime} from './qa-software-runtime.mjs';
ensureSoftwareRuntime();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skipQa = process.argv.includes('--skip-qa');
const checkNative = process.argv.includes('--check-native');
const explicitPort = process.argv.includes('--port')
  ? Number(process.argv[process.argv.indexOf('--port') + 1])
  : NaN;

let pass = 0, fail = 0;
const check = (c, n, extra = '') => { console.log(((c ? 'ok' : 'FAIL') + ' - ' + n + (extra ? ' ' + extra : ''))); c ? pass++ : fail++; };
const run = (cmd, args, timeout = 300000) => {
  const r = spawnSync(cmd, args, { cwd: root, timeout, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

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

// 1. preflight (own ephemeral by default; explicit --port probes read-only).
console.log('--- 1/4 preflight ---');
{
  const args = Number.isFinite(explicitPort)
    ? ['scripts/preflight.mjs', '--port', String(explicitPort)]
    : ['scripts/preflight.mjs'];
  const r = run(process.execPath, args, 90000);
  console.log(r.out.trim().split('\n').slice(-6).join('\n'));
  check(r.code === 0, 'preflight green');
}

// 2. unit: all DOM-free regressions, exit code decides (no count greps).
console.log('--- 2/4 unit ---');
{
  const r = run('npm', ['test'], 300000);
  console.log(r.out.trim().split('\n').slice(-4).join('\n'));
  check(r.code === 0, 'unit green (exit 0 across run + model-agent + native suites)');
}

// 3. real frontend behavior, including document rendering; exit code decides.
if (!skipQa) {
  console.log('--- 3/4 behaviour QA ---');
  const r = run('npm', ['run', 'qa'], 540000);
  console.log(r.code===0 ? r.out.trim().split('\n').slice(-6).join('\n') : r.out.trim());
  check(r.code === 0 && !/^FAIL/m.test(r.out), 'behaviour QA green (panes + documents, headless only)');
  if(process.platform==='linux'){
    const lifetime=run(process.execPath,['tests/qa/browser-environment.mjs'],45000);
    console.log(lifetime.out.trim());
    check(lifetime.code===0,'browser remains live after an unrelated desktop bus shuts down');
  }
} else console.log('--- 3/4 behaviour QA SKIPPED ---');

// 4. proxy + click round-trip through one owned ephemeral server (local fixture only).
console.log('--- 4/4 proxy + click (owned ephemeral, local fixture) ---');
{
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const vault = await mkdtemp(join(tmpdir(), 'profiles-verify-vault-'));
  let child = null;
  try {
    child = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
      cwd: root,
      env: { ...process.env, PROFILES_VAULT_DIR: vault, PROFILES_DISABLE_KEYRING: '1', PORT: String(port) },
      stdio: 'pipe',
    });
    const h = await waitHealthy(base, 25000, child.pid);
    check(!!h && !!h.build, 'owned verify server boots with build stamp');
    if (!h) throw new Error('verify server did not boot');

    // Proxy: local fixture through /api/proxy keeps content+links, strips framing.
    try {
      const target = base + '/api/test/click-target';
      const r = await fetch(base + '/api/proxy?url=' + encodeURIComponent(target));
      const text = await r.text();
      const xframe = r.headers.get('x-frame-options');
      check(r.ok && !xframe && /CLICKTEST/i.test(text), 'proxy keeps local content without framing headers');
    } catch (e) {
      check(false, 'proxy keeps local content without framing headers', String(e?.message || e).slice(0, 100));
    }

    // Click: view fixture -> click HIT zone -> title flips on the same actor page.
    try {
      const fixture = base + '/api/test/click-target';
      await fetch(base + '/api/browser/view', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: fixture }),
      });
      await new Promise((r) => setTimeout(r, 1500));
      await fetch(base + '/api/browser/click', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fx: 0.5, fy: 0.2 }),
      });
      await new Promise((r) => setTimeout(r, 1500));
      const v = await (await fetch(base + '/api/browser/state')).json().catch(() => null);
      check(!!v && /HIT/.test(String(v.title || '')) && String(v.url || '').includes('click-target'),
        'click flips fixture title on the same actor page');
    } catch (e) {
      check(false, 'click flips fixture title on the same actor page', String(e?.message || e).slice(0, 100));
    }
  } finally {
    try { child?.kill(); } catch {}
    try { await rm(vault, { recursive: true, force: true }); } catch {}
  }
}

// Native bundle freshness: explicit only, never part of the default gate.
if (checkNative) {
  console.log('--- native bundle freshness (explicit --check-native only) ---');
  try {
    const binPath=join(root,'src-tauri/target/release/profiles');
    const bin=statSync(binPath).mtimeMs;
    function newer(path){
      const info=statSync(path);
      if(info.isDirectory()) return readdirSync(path,{withFileTypes:true}).some(e=>!e.isSymbolicLink() && newer(join(path,e.name)));
      return info.mtimeMs>bin;
    }
    const stale=['src','src-tauri/src','src-tauri/Cargo.toml','src-tauri/tauri.conf.json','src-tauri/build.rs'].find(p=>newer(join(root,p)));
    check(!stale,'release binary newer than embedded frontend and Rust sources',stale?'STALE vs '+stale:'');
  } catch { check(false, 'binary freshness', 'build the release binary first'); }
} else {
  console.log('--- native bundle freshness SKIPPED (pass --check-native for the explicit native gate) ---');
}

console.log(`\nVERIFY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
