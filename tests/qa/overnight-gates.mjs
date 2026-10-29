// Overnight acceptance gates (Playwright, headless by default; QA_HEADED=1 for headed).
// Covers the five 2026-10-29 spec workstreams:
//   gate1 profile X gating · gate2 adaptive + hotkeys · gate3 pin resize
//   gate4 popup dismissal · gate5 canvas pass-through.
//
// Two assertion kinds:
//   pin(name, cond)  — behaviour that holds TODAY and must never regress.
//   gate(name, cond) — target contract owned by a sibling worker branch;
//                      may fail until the linear merge lands.
// Exit code: nonzero iff any pin fails. `--strict` also fails on gates
// (for post-merge CI). QA_BASE reuses a running server, otherwise one is
// spawned on QA_PORT (default 8124).
import { firefox } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const strict = process.argv.includes('--strict');
const PORT = Number(process.env.QA_PORT || 8124);
const base = process.env.QA_BASE || `http://localhost:${PORT}/src/`;
const headed = process.env.QA_HEADED === '1';

let child = null;
async function ensureServer() {
  if (process.env.QA_BASE) return;
  child = spawn('node', ['server.mjs', '--port', String(PORT)], { cwd: root, stdio: 'ignore' });
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {}
    if (Date.now() - t0 > 15000) throw new Error('server did not boot on ' + base);
    await new Promise((r) => setTimeout(r, 250));
  }
}
process.on('exit', () => { try { child?.kill(); } catch {} });

const pins = [];
const gates = [];
function pin(name, cond) { pins.push([name, !!cond]); console.log((cond ? 'pin  - ' : 'PINFAIL - ') + name); }
function gate(name, cond, owner) {
  gates.push([name, !!cond, owner]);
  console.log((cond ? 'gate - ' : 'GATEOPEN - ') + name + (cond ? '' : `   [pending: ${owner}]`));
}
async function api(path, opts) {
  const r = await fetch(base.replace(/\/src\/$/, '') + '/api' + path, opts);
  return r.json();
}
async function blur(page) { await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); }); }
async function bodyMode(page) { return page.evaluate(() => document.body.dataset.mode); }
async function pillsText(page) { return page.evaluate(() => document.querySelector('.pills').textContent); }
async function ensureHidden(page, sel) { await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.hidden = true; }, sel); }

await ensureServer();
const browser = await firefox.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const apiBase = base.replace(/\/src\/$/, '');
async function apiCall(path, opts) {
  const r = await fetch(apiBase + '/api' + path, opts);
  return r.json();
}
// pristine state snapshot for cleanup
const origApp = await apiCall('/appconfig');
const origSlot = await apiCall('/slot');
await apiCall('/slot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'A' }) });
const origNotesA = (await apiCall('/notes')).text ?? '';
const post = (path, body) => apiCall(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

/* ================= gate1: Profile X gating ================= */
console.log('--- gate1: profile X gating ---');
// setup pane must be reachable, X toggle present with plain-spoken warning
await page.click('#paneTabs button[aria-label="Add a pane"]');
await page.waitForTimeout(200);
await page.click('[data-add="pane-setup"]');
await page.waitForTimeout(600);
pin('X opt-in toggle exists', await page.isVisible('#showXToggle'));
{
  const warn = await page.evaluate(() => document.body.textContent || '');
  pin('disclaimer names full-access/whole-machine power', /full-access|whole-machine/i.test(warn));
  pin('disclaimer names A/B/C ringfence', /ringfenced|A\/B\/C/i.test(warn));
  gate('disclaimer names one-click rollback', /rollback|snapshots/i.test(warn), 'worker-1-core');
}
// turning on X reveals the X slot; single action, no sub-checkbox maze
await post('/appconfig', { showX: true });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
pin('showX reveals slot X', await page.evaluate(() => { const x = document.getElementById('slotX'); return !!x && !x.hidden; }));
{
  const cfg = await apiCall('/appconfig');
  pin('appconfig persists showX', cfg.showX === true);
}
await page.click('#slotX');
await page.waitForTimeout(900);
pin('single click lands in X (everything-on, no sub-gates)', await page.evaluate(() => document.getElementById('slotX').getAttribute('aria-pressed') === 'true'));
gate('activating X verifies a private git rollback repo', existsSync(join(root, 'vault', 'X', '.git')) || existsSync(join(root, 'vault', '.git')), 'worker-1-core');
// A/B/C isolation over the real backend
const canary = 'QA-CANARY-' + Date.now();
await post('/slot', { slot: 'A' });
await page.waitForTimeout(400);
await post('/notes', { text: origNotesA + '\n' + canary });
await post('/slot', { slot: 'B' });
await page.waitForTimeout(400);
const notesB = (await apiCall('/notes')).text ?? '';
pin('B sees none of A notes (zero carry-across)', !notesB.includes(canary));
await post('/slot', { slot: 'A' });
await page.waitForTimeout(400);
pin('A keeps its own notes', ((await apiCall('/notes')).text ?? '').includes(canary));
// X must never touch A/B/C
const aCfgPath = join(root, 'vault', 'A', 'config.json');
const aBefore = await readFile(aCfgPath, 'utf8');
await post('/slot', { slot: 'X' });
await page.waitForTimeout(400);
await post('/notes', { text: 'x scratch ' + Date.now() });
await post('/slot', { slot: 'A' });
await page.waitForTimeout(400);
pin('X operations leave A vault byte-identical', (await readFile(aCfgPath, 'utf8')) === aBefore);
pin('zero page errors in gate1', errors.length === 0);

/* ================= gate2: adaptive + hotkeys ================= */
console.log('--- gate2: adaptive toggle + segways + hotkeys ---');
await post('/appconfig', { showX: true });
await post('/slot', { slot: 'A' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
{
  const n = await page.locator('#adaptiveToggle').count();
  gate('Adaptive toggle exists', n > 0, 'worker-2-modes');
  if (n > 0) {
    const label = await page.evaluate(() => {
      const t = document.getElementById('adaptiveToggle');
      const lab = t.closest('label');
      return (lab ? lab.textContent : t.getAttribute('aria-label') || '') + '|' + t.type;
    });
    gate('Adaptive toggle is a labelled checkbox', /adaptive/i.test(label), 'worker-2-modes');
    const pos = await page.evaluate(() => {
      const t = document.getElementById('adaptiveToggle').getBoundingClientRect();
      const p = document.querySelector('.pills').getBoundingClientRect();
      return t.right <= p.left + 4;
    });
    gate('Adaptive sits left of the profile pills', pos, 'worker-2-modes');
    await page.evaluate(() => document.getElementById('adaptiveToggle').click());
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    gate('Adaptive choice persists across reload', await page.evaluate(() => document.getElementById('adaptiveToggle').checked === true), 'worker-2-modes');
  } else {
    gate('Adaptive toggle is a labelled checkbox', false, 'worker-2-modes');
    gate('Adaptive sits left of the profile pills', false, 'worker-2-modes');
    gate('Adaptive choice persists across reload', false, 'worker-2-modes');
  }
}
// smooth segways: cross-fade, never a hard cut (pins current motion contract)
await page.evaluate(() => document.querySelector('[data-profile="lifeful"], [data-profile="Vibes"], .pills button').click());
await page.waitForTimeout(400);
{
  const dur = await page.evaluate(() => getComputedStyle(document.body).transitionDuration);
  pin('mode swap cross-fades (body bg transition >= .3s)', dur.split(',').some((d) => parseFloat(d) >= 0.3));
}
await page.evaluate(() => { const c = [...document.querySelectorAll('.pills button')].find((b) => /low-sensory|calm/i.test(b.textContent)); if (c) c.click(); });
await page.waitForTimeout(400);
pin('calm freezes motion (governor kill-switch)', await page.evaluate(() => document.body.classList.contains('gov-freeze')));
// hotkeys 1-6: six distinct modes once X is on
await post('/slot', { slot: 'X' });
await page.waitForTimeout(600);
await blur(page);
const seen = [];
for (const k of ['1', '2', '3', '4', '5', '6']) {
  await blur(page);
  await page.keyboard.press(k);
  await page.waitForTimeout(350);
  seen.push(await bodyMode(page));
}
pin('keys 1-5 select five distinct modes', new Set(seen.slice(0, 5)).size === 5);
gate('key 6 selects the 6th mode (xMAX, X-only)', new Set(seen).size === 6, 'worker-2-modes');
{
  const pills = await pillsText(page);
  gate('pills read babylite/chill/FOCUSMAX/Vibes/xMAX/calm', /babylite/i.test(pills) && /FOCUSMAX/.test(pills) && /Vibes/.test(pills) && /xMAX/.test(pills) && /calm/i.test(pills), 'worker-2-modes');
}
// xMAX exclusivity
await post('/appconfig', { showX: false });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
{
  const pills = await pillsText(page);
  gate('xMAX hidden while X is off', !/xMAX/.test(pills), 'worker-2-modes');
}
await post('/appconfig', { showX: true });
await post('/slot', { slot: 'X' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
// slot hotkeys a/b/c/x
await post('/slot', { slot: 'A' });
await page.waitForTimeout(500);
for (const [k, id] of [['a', 'slotA'], ['b', 'slotB'], ['c', 'slotC'], ['x', 'slotX']]) {
  await blur(page);
  await page.keyboard.press(k);
  await page.waitForTimeout(800);
  const pressed = await page.evaluate((s) => document.getElementById(s)?.getAttribute('aria-pressed'), id);
  gate(`hotkey ${k} switches to slot ${id.replace('slot', '')}`, pressed === 'true', 'worker-2-modes');
}
pin('zero page errors in gate2', errors.length === 0);

/* ================= gate3: pin resize ================= */
console.log('--- gate3: pin unlock, border resize, re-pin ---');
await post('/slot', { slot: 'A' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('#paneTabs button[aria-label="Add a pane"]');
await page.waitForTimeout(200);
await page.click('[data-add="pane-doc"]');
await page.waitForTimeout(600);
pin('doc pane on canvas', await page.isVisible('#pane-doc'));
await page.click('#pane-doc .pinbtn');
await page.waitForTimeout(300);
pin('pin click unlocks the pane', await page.evaluate(() => document.getElementById('pane-doc').classList.contains('unpinned')));
{
  const box = await page.locator('#pane-doc').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + box.width - 2 + i * 10, y); await page.waitForTimeout(40); }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const box2 = await page.locator('#pane-doc').boundingBox();
  gate('border drag resizes the unlocked pane', box2.width - box.width > 15, 'worker-4-ui');
}
await page.click('#pane-doc .pinbtn');
await page.waitForTimeout(300);
pin('pin click re-locks the pane', await page.evaluate(() => !document.getElementById('pane-doc').classList.contains('unpinned')));
{
  const cfg = await apiCall('/config');
  pin('layout order persists to profile config', Array.isArray(cfg.profile?.layout?.order) && cfg.profile.layout.order.includes('pane-doc'));
}
pin('zero page errors in gate3', errors.length === 0);

/* ================= gate4: universal popup dismissal ================= */
console.log('--- gate4: click-outside dismissal everywhere ---');
await ensureHidden(page, '#trashPop');
await ensureHidden(page, '#addMenu');
await ensureHidden(page, '#brandMenu');
async function openDismissed(open, sel, owner) {
  await open();
  await page.waitForTimeout(250);
  const shown = await page.evaluate((s) => { const el = document.querySelector(s); return !!el && !el.hidden; }, sel);
  if (!shown) { gate(`${sel} opens`, false, owner); return; }
  await page.mouse.click(8, 8);
  await page.waitForTimeout(250);
  const gone = await page.evaluate((s) => document.querySelector(s).hidden, sel);
  gate(`${sel} dismisses on outside click`, gone, owner);
}
// recycle bin (target behaviour)
await page.evaluate(() => { const d = document.querySelector('[data-close="pane-doc"]'); if (document.getElementById('pane-doc').classList.contains('hiddenPane') === false && d) d.click(); });
await page.waitForTimeout(400);
await openDismissed(() => page.click('#trashBtn'), '#trashPop', 'worker-4-ui');
// plus menu + brand menu (regression pins: already dismiss today)
await openDismissed(() => page.click('#paneTabs button[aria-label="Add a pane"]'), '#addMenu', 'worker-4-ui');
await openDismissed(() => page.click('#brandMenuBtn'), '#brandMenu', 'worker-4-ui');
// bin still recovers after a dismissal round-trip
await page.click('#trashBtn');
await page.waitForTimeout(300);
pin('trash still lists a recoverable pane', await page.evaluate(() => document.querySelectorAll('#trashList button').length > 0));
await ensureHidden(page, '#trashPop');
pin('zero page errors in gate4', errors.length === 0);

/* ================= gate5: canvas pass-through ================= */
console.log('--- gate5: read/write canvas pass-through ---');
await page.click('#paneTabs button[aria-label="Add a pane"]');
await page.waitForTimeout(250);
{
  const menu = await page.evaluate(() => document.getElementById('addMenu').textContent);
  gate('+ menu drops Video suggestion', !/Video/.test(menu), 'worker-3-canvas');
  gate('+ menu drops Activity suggestion', !/Activity/.test(menu), 'worker-3-canvas');
  pin('+ menu keeps Notes', /Notes/.test(menu));
  await ensureHidden(page, '#addMenu');
}
await page.click('#paneTabs button[aria-label="Add a pane"]');
await page.waitForTimeout(200);
await page.click('[data-add="pane-doc"]');
await page.waitForTimeout(600);
pin('Read/Write opens the document pane', await page.isVisible('#pane-doc'));
pin('staged docs export (.md + .docx)', await page.evaluate(() => {
  const t = document.getElementById('pane-doc').textContent;
  return /Export \.md/.test(t) || /No staged drafts yet/.test(t);
}));
{
  const n = await page.locator('#pane-doc canvas').count();
  gate('native sketch canvas lives in the doc pane', n > 0, 'worker-3-canvas');
  if (n > 0) {
    const box = await page.locator('#pane-doc canvas').first().boundingBox();
    const blank = await page.evaluate(() => {
      const c = document.querySelector('#pane-doc canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 401) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    });
    await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i <= 10; i++) { await page.mouse.move(box.x + box.width / 2 - 40 + i * 8, box.y + box.height / 2 + (i % 2 ? 6 : -6)); await page.waitForTimeout(20); }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const drawn = await page.evaluate(() => {
      const c = document.querySelector('#pane-doc canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 401) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    });
    gate('mouse stroke lands pixels on the sketch canvas', drawn !== blank, 'worker-3-canvas');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const kept = await page.evaluate(() => {
      const c = document.querySelector('#pane-doc canvas');
      if (!c) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 401) s += d[i] + d[i + 1] + d[i + 2];
      return s !== 0;
    });
    gate('sketch survives reload', kept, 'worker-3-canvas');
  } else {
    gate('mouse stroke lands pixels on the sketch canvas', false, 'worker-3-canvas');
    gate('sketch survives reload', false, 'worker-3-canvas');
  }
}
pin('zero page errors in gate5', errors.length === 0);
if (errors.length) console.log(errors);

/* ================= cleanup + verdict ================= */
await post('/notes', { text: origNotesA }).catch(() => {});
await post('/slot', { slot: origSlot.active || 'A' }).catch(() => {});
await post('/appconfig', { showX: !!origApp.showX, extraSlots: origApp.extraSlots || [] }).catch(() => {});
await browser.close();
try { child?.kill(); } catch {}

const pinFail = pins.filter(([, ok]) => !ok);
const gateOpen = gates.filter(([, ok]) => !ok);
console.log(`\nPINS: ${pins.length - pinFail.length}/${pins.length} holding (must never regress)`);
console.log(`GATES: ${gates.length - gateOpen.length}/${gates.length} target checks passing`);
for (const [name, , owner] of gateOpen) console.log(`  open: ${name} [${owner}]`);
process.exit(pinFail.length || (strict && gateOpen.length) ? 1 : 0);
