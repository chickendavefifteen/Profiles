#!/usr/bin/env node
// Every-build gate: the 8 checks that run before anything is shown to Dave.
// Usage: node scripts/verify-build.mjs [--port 1420] [--skip-qa]
import { execSync, spawnSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 1420);
const skipQa = process.argv.includes('--skip-qa');
const base = `http://localhost:${port}`;
let pass = 0, fail = 0;
const check = (c, n, extra = '') => { console.log(((c ? 'ok' : 'FAIL') + ' - ' + n + (extra ? ' ' + extra : ''))); c ? pass++ : fail++; };
const sh = (cmd, timeout = 120000) => {
  const r = spawnSync('bash', ['-c', cmd], { timeout, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// 1. preflight: server alive, build matches disk, model present, browser renders
console.log('--- 1/6 preflight ---');
let r = sh(`node scripts/preflight.mjs --port ${port}`, 60000);
console.log(r.out.trim().split('\n').slice(-6).join('\n'));
check(r.code === 0, 'preflight green');

// 2. unit tests
console.log('--- 2/6 unit ---');
r = sh('npm test 2>&1 | tail -1', 120000);
check(/0 failed/.test(r.out), 'unit green', r.out.trim());

// 3. behaviour QA (headless Playwright)
if (!skipQa) {
  console.log('--- 3/6 behaviour QA ---');
  r = sh(`node tests/qa/core-flows.mjs 2>&1 | grep -E "^FAIL|QA:"`, 540000);
  console.log(r.out.trim());
  check(!/^FAIL/m.test(r.out) && /QA: \d+\/\d+ passed/.test(r.out), 'behaviour QA green');
} else console.log('--- 3/6 behaviour QA SKIPPED ---');

// 4. proxy embeds real pages (framing stripped, links rewritten)
console.log('--- 4/6 proxy embeds ---');
r = sh(`curl -s --max-time 25 "${base}/api/proxy?url=https://www.bbc.co.uk/news" -o /tmp/verify-proxy.html -D /tmp/verify-proxy.h; grep -qi "x-frame-options" /tmp/verify-proxy.h && echo HAS_XFRAME || echo NO_XFRAME; grep -c "api/proxy?url=" /tmp/verify-proxy.html; python3 -c "d=open('/tmp/verify-proxy.html',encoding='utf8',errors='replace').read(); print('bytes=%d bbc=%s' % (len(d), 'bbc' in d.lower()))"`, 90000);
console.log(r.out.trim());
check(r.out.includes('NO_XFRAME') && /bytes=\d+ bbc=true/i.test(r.out), 'proxy strips framing, keeps content+links');

// 5. click round-trip through the real stack (view -> click center -> title flips)
console.log('--- 5/6 click round-trip ---');
r = sh(`SLOT=$(curl -s --max-time 10 ${base}/api/slot | python3 -c "import json,sys; print(json.load(sys.stdin).get('active','A'))"); curl -s --max-time 10 -X POST ${base}/api/slot -H 'content-type: application/json' -d '{"slot":"C"}' >/dev/null; curl -s --max-time 30 -X POST ${base}/api/browser/view -H 'content-type: application/json' -d '{"url":"${base}/api/test/click-target"}' | head -c 80; echo; sleep 1; curl -s --max-time 30 -X POST ${base}/api/browser/click -H 'content-type: application/json' -d '{"fx":0.5,"fy":0.5}' >/dev/null; sleep 1; curl -s --max-time 30 -X POST ${base}/api/browser/view -H 'content-type: application/json' -d '{}' | python3 -c "import json,sys; print('title:', json.load(sys.stdin).get('title'))"; curl -s --max-time 10 -X POST ${base}/api/slot -H 'content-type: application/json' -d "{\"slot\":\"$SLOT\"}" >/dev/null; echo "(slot restored: $SLOT)"`, 120000);
console.log(r.out.trim());
check(r.out.includes('title: HIT'), 'click flips test page');

// 6. binary freshness: native bundle newer than every src/agent file
console.log('--- 6/6 binary freshness ---');
try {
  const bin = statSync('src-tauri/target/debug/profiles').mtimeMs;
  const src = execSync(`find src agent server.mjs -type f -newer src-tauri/target/debug/profiles 2>/dev/null | head -5`, { encoding: 'utf8' }).trim();
  check(!src, 'binary newer than all frontend/agent sources', src ? ('STALE vs: ' + src.split('\n')[0]) : '');
} catch (e) { check(false, 'binary freshness', 'no debug binary built yet'); }

console.log(`\nVERIFY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
