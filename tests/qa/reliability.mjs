// Profiles reliability QA — behaviour only, no source-string assertions.
//
// Owns a throwaway vault + its own server on a free loopback port, so it
// never touches a shared user vault or a stale ghost server. Headless
// Chromium only (--disable-gpu --mute-audio); nothing here ever opens a
// visible browser window. No external sites: browsing/typing targets the
// sidecar's own /api/test/click-target fixture served from the same port.
//
// Covers: chat ask opens the local fixture (agent names the observed url +
// title, browser pane + actor session agree), stream click mapping and
// real key-input typing on the same actor page, minimize/restore preserving
// original messages + typed draft (minimise posts a status bubble, so content
// not count) with both loops live after restore, mode persistence across
// reload, Super and latched-Super shortcuts from inside an input, ABC profile
// switching, ctrl+wheel zoom containment (browser only, 50-200%), repeated
// resize (1366x768, 1024x700, touch) without app overflow or collapsed panes,
// and honest model-menu selection (Basic ready, cloud not faked, no provider).
//
// Run: node tests/qa/reliability.mjs
// Exit: 0 when every check passes, 1 otherwise. Screenshots land in a temp
// report dir (path printed); the vault and server are torn down in finally.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import {ensureSoftwareRuntime} from '../../scripts/qa-software-runtime.mjs';
ensureSoftwareRuntime();

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
function check(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log((cond ? 'ok' : 'FAIL') + ' - ' + name + (cond || !extra ? '' : ' :: ' + extra));
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

async function apiJSON(base, path, opts) {
  const r = await fetch(base + path, opts);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; }
  catch { return { status: r.status, json: null, text }; }
}
const post = (base, path, body) => apiJSON(base, path,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function waitFor(fn, timeout, step = 500) {
  const t0 = Date.now();
  for (;;) {
    const out = await fn().catch(() => null);
    if (out) return out;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, step));
  }
}

const vault = await mkdtemp(join(tmpdir(), 'profiles-qa-vault-'));
const reportDir = await mkdtemp(join(tmpdir(), 'profiles-qa-report-'));
await mkdir(reportDir, { recursive: true });
const port = await freePort();
const host = '127.0.0.1';
const apiBase = `http://${host}:${port}`;
const base = apiBase + '/src/';
const fixturePath = '/api/test/click-target';

let child = null;
let browser = null;
let shotN = 0;
let serverOut = '';
async function shot(page, tag) {
  shotN += 1;
  const file = join(reportDir, `shot-${shotN}-${tag}.png`);
  try { await page.screenshot({ path: file }); console.log('screenshot: ' + file); }
  catch (e) { console.log('screenshot failed (' + tag + '): ' + String(e && e.message || e)); }
}

let exitCode = 0;
try {
  // ---- owned server (fresh, cwd = this lane, isolated throwaway vault, no keyring) ----
  child = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, PROFILES_VAULT_DIR: vault, PROFILES_DISABLE_KEYRING: '1', PORT: String(port) },
    stdio: 'pipe',
  });
  serverOut = '';
  child.stdout?.on('data', (d) => { serverOut += String(d); });
  child.stderr?.on('data', (d) => { serverOut += String(d); });
  try {
    await waitFor(async () => {
      const r = await apiJSON(apiBase, '/api/health').catch(() => null);
      return r && r.status === 200 && r.json && r.json.ok && r.json.pid===child.pid ? true : null;
    }, 25000, 300);
  } catch {
    console.log('server did not boot; output tail:\n' + serverOut.slice(-2000));
    throw new Error('owned server failed to boot on ' + apiBase);
  }
  check('owned server boots healthy on a free loopback port', true);

  // ---- deterministic start: slot A, pristine config, throwaway vault ----
  await apiJSON(apiBase, '/api/slot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'A' }) });
  await post(apiBase, '/api/config', { reset: true });
  const slotA = await apiJSON(apiBase, '/api/slot');
  check('starts on slot A', slotA.json && slotA.json.active === 'A');

  // ---- owned headless browser: never visible, never audible ----
  browser = await chromium.launch({
    headless: true,
    env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent',PULSE_SERVER:'unix:/nonexistent'},
    args: ['--disable-gpu', '--mute-audio', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));

  await page.goto(base + '?mode=Vibes', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await page.isVisible('#pane-chat')) || null, 15000, 300);
  await page.waitForTimeout(2500);
  check('default canvas shows chat', await page.isVisible('#pane-chat'));
  check('default canvas shows browser', await page.isVisible('#pane-browser'));
  check('ask box present', await page.isVisible('#ask'));
  check('address bar present', await page.isVisible('#urlInput'));
  check('model badge present', await page.isVisible('#brainBadge'));

  const fixtureUrl = `${apiBase}${fixturePath}`;
  const stateOf = async () => {
    // Prefer /api/browser/state; fall back to POST /api/browser/view.
    const s = await apiJSON(apiBase, '/api/browser/state').catch(() => null);
    if (s && s.json && typeof s.json.url === 'string' && s.json.url) return s.json;
    const v = await post(apiBase, '/api/browser/view', {}).catch(() => null);
    return (v && v.json) || null;
  };

  // ---- T1: chat ask opens the local fixture; agent + browser agree ----
  const bubblesBefore = await page.locator('#chatLog .bubble').count();
  await page.fill('#ask', 'open ' + fixtureUrl);
  await page.press('#ask', 'Enter');
  await waitFor(async () => {
    const n = await page.locator('#chatLog .bubble').count();
    const urlVal = await page.inputValue('#urlInput').catch(() => '');
    return (n > bubblesBefore && urlVal.includes('click-target')) || null;
  }, 45000, 750);
  const urlAfterAsk = await page.inputValue('#urlInput');
  const st1 = await stateOf();
  check('chat ask navigates the browser pane to the fixture', urlAfterAsk.includes('click-target'), urlAfterAsk);
  check('actor session matches the pane address', !!(st1 && st1.url && st1.url.includes('click-target')), st1 && st1.url);
  const st1titled = await waitFor(async () => {
    const s = await stateOf().catch(() => null);
    return (s && s.title && /CLICKTEST/.test(s.title)) ? s : null;
  }, 20000, 500).catch(() => null);
  check('actor reports the observed fixture title', !!st1titled, st1titled && st1titled.title);
  const lastAgent = await page.locator('#chatLog .bubble.agent').last().textContent().catch(() => '');
  check('agent answer names what it observed (url or title, not a bare ok)', !!((lastAgent || '').match(/click-target|CLICKTEST/i)), (lastAgent || '').slice(0, 160));

  // ---- T2: click through the visible stream lands on the live actor ----
  await waitFor(async () => (await page.locator('#browserSurface img').count()) > 0 || null, 20000, 500);
  const imgBox = await page.locator('#browserSurface img').boundingBox();
  check('browser pane shows the live stream image', !!imgBox, JSON.stringify(imgBox));
  if (imgBox) {
    // Fixture top 45% is the full-width HIT button: click it via the
    // same fraction mapping the frontend uses (clientX-rect)/width.
    await page.mouse.click(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height * 0.2);
    const hit = await waitFor(async () => {
      const s = await stateOf();
      return (s && /HIT/.test(s.title || '')) ? s : null;
    }, 20000, 500).catch(() => null);
    check('stream click reaches the actor page (title flips)', !!hit, hit && hit.title);
    check('stream click stays on the same actor page (no navigation away)', !!(hit && st1 && hit.url === st1.url), hit && hit.url);
  }

  // ---- T3: typing goes through real key inputs, fixture form submits ----
  if (imgBox) {
    // Click the fixture input zone (lower half) to focus it in the actor,
    // then type with real key events (the hidden textarea forwards them).
    await page.mouse.click(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height * 0.65);
    await page.waitForTimeout(600);
    const word = 'hello-qa-' + String(Date.now() % 100000);
    await page.keyboard.type(word, { delay: 25 });
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    const typed = await waitFor(async () => {
      const s = await stateOf();
      return (s && /TYPED:/.test(s.title || '') && s.title.includes(word)) ? s : null;
    }, 20000, 500).catch(() => null);
    check('typing stays in the same actor page as the open (one actor, click + type)', !!(typed && st1 && typed.url === st1.url), typed && typed.url);
    check('typed keys land in the actor form and submit', !!typed, typed && typed.title);
  }

  // ---- T4: minimize/restore keeps originals + draft; both loops live after ----
  // (minimise posts a status bubble by design, so count grows — assert content.)
  const draft = 'keeper draft — must survive minimise';
  await page.fill('#ask', draft);
  const chatTextsBefore = await page.locator('#chatLog .bubble').evaluateAll((els) => els.map((el) => el.textContent));
  await page.click('[data-min="pane-chat"]');
  await page.waitForTimeout(500);
  const chatHidden = await page.evaluate(() => document.querySelector('#pane-chat').classList.contains('hiddenPane'));
  // Click the tab icon itself: the tab also carries a × close affordance.
  await page.click('#paneTabs button[aria-label="Chat"] .paneicon');
  await page.waitForTimeout(500);
  check('chat minimises to its tab', chatHidden === true);
  check('chat restores visible', await page.isVisible('#pane-chat'));
  check('typed draft survives minimise/restore', (await page.inputValue('#ask')) === draft);
  const chatTextsAfter = await page.locator('#chatLog .bubble').evaluateAll((els) => els.map((el) => el.textContent));
  check('original chat messages survive minimise/restore', chatTextsBefore.length > 0 && chatTextsBefore.every((t) => chatTextsAfter.includes(t)), chatTextsBefore.length + ' -> ' + chatTextsAfter.length);
  await page.fill('#ask', 'post-restore probe');
  check('ask box still takes input after chat restore', (await page.inputValue('#ask')) === 'post-restore probe');
  await page.fill('#ask', draft);
  const urlBeforeMin = await page.inputValue('#urlInput');
  await page.click('[data-min="pane-browser"]');
  await page.waitForTimeout(500);
  await page.click('#paneTabs button[aria-label="Browser"] .paneicon');
  check('browser restores visible', await page.isVisible('#pane-browser'));
  check('browser address survives minimise/restore', (await page.inputValue('#urlInput')) === urlBeforeMin, urlBeforeMin);
  const stAfterMin = await stateOf().catch(() => null);
  check('browser actor still answers after restore', !!(stAfterMin && stAfterMin.url && stAfterMin.url.includes('click-target')), stAfterMin && stAfterMin.url);

  // ---- T5: explicit mode persists across reload ----
  await page.click('.pills button[data-profile="calm"]');
  await page.waitForTimeout(600);
  const calmNow = await page.evaluate(() => document.body.dataset.mode);
  // No ?mode= here: the query param is a one-shot override, so a bare load
  // proves the persisted profile (not the URL) restores the mode.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await page.isVisible('#pane-chat')) || null, 15000, 300);
  await page.waitForTimeout(2500);
  const calmAfter = await page.evaluate(() => document.body.dataset.mode);
  check('calm mode persists across reload', calmNow === 'calm' && calmAfter === 'calm', calmNow + ' -> ' + calmAfter);
  await page.click('.pills button[data-profile="Vibes"]');
  await page.waitForTimeout(600);
  check('mode switches back to Vibes', (await page.evaluate(() => document.body.dataset.mode)) === 'Vibes');

  // ---- T6: Super shortcuts work while focused inside the ask input ----
  await page.click('#ask');
  await page.keyboard.type('x');
  await page.keyboard.press('Meta+2');
  await page.waitForTimeout(600);
  const superMode = await page.evaluate(() => document.body.dataset.mode);
  check('Super+digit switches mode from inside an input', superMode === 'chill', superMode);
  await page.keyboard.press('Meta');
  check('lone Super enters all-pane adjust mode', await page.evaluate(() => window.isAdjustMode()));
  await page.keyboard.press('4');
  check('next digit locks panes without changing the mode', !(await page.evaluate(() => window.isAdjustMode())) &&
    (await page.evaluate(() => document.body.dataset.mode)) === 'chill');
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

  // ---- T7: ABC keys switch profiles; returning keeps isolation ----
  await page.keyboard.press('b');
  await waitFor(async () => {
    const s = await apiJSON(apiBase, '/api/slot').catch(() => null);
    return (s && s.json && s.json.active === 'B') || null;
  }, 10000, 300);
  const slotB = (await apiJSON(apiBase, '/api/slot')).json;
  check('letter shortcut switches to profile B', slotB && slotB.active === 'B');
  await page.keyboard.press('a');
  await waitFor(async () => {
    const s = await apiJSON(apiBase, '/api/slot').catch(() => null);
    return (s && s.json && s.json.active === 'A') || null;
  }, 10000, 300);
  const backA = (await apiJSON(apiBase, '/api/slot')).json;
  check('letter shortcut switches back to profile A', backA && backA.active === 'A');
  await page.waitForTimeout(2000);

  // Re-establish a live page for the zoom/resize checks below.
  await page.fill('#urlInput', fixtureUrl);
  await page.press('#urlInput', 'Enter');
  await waitFor(async () => {
    const s = await stateOf();
    return (s && s.url && s.url.includes('click-target')) || null;
  }, 30000, 750);

  // ---- T8: ctrl+wheel over the browser zooms only the browser, clamped ----
  const chatBoxBefore = await page.locator('#pane-chat').boundingBox();
  const appZoomBefore = await page.evaluate(() => { try { return localStorage.getItem('profilesZoom'); } catch { return null; } });
  const pageZoomBefore = await page.evaluate(() => { try { return localStorage.getItem('profilesPageZoom'); } catch { return null; } });
  const surf = await page.locator('#browserSurface').boundingBox();
  if (surf) {
    await page.mouse.move(surf.x + surf.width / 2, surf.y + surf.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(400);
    await page.keyboard.up('Control');
  }
  const appZoomAfter = await page.evaluate(() => { try { return localStorage.getItem('profilesZoom'); } catch { return null; } });
  const pageZoomAfter = await page.evaluate(() => { try { return localStorage.getItem('profilesPageZoom'); } catch { return null; } });
  const chatBoxAfter = await page.locator('#pane-chat').boundingBox();
  const pageZoomNum = Number(pageZoomAfter);
  check('ctrl+wheel over browser changes browser zoom', pageZoomAfter !== pageZoomBefore, pageZoomBefore + ' -> ' + pageZoomAfter);
  check('browser zoom stays within 50-200%', Number.isFinite(pageZoomNum) && pageZoomNum >= 0.5 && pageZoomNum <= 2, String(pageZoomAfter));
  check('app zoom untouched by browser zoom', appZoomAfter === appZoomBefore, appZoomBefore + ' -> ' + appZoomAfter);
  const chatUnmoved = chatBoxBefore && chatBoxAfter
    && Math.abs(chatBoxBefore.width - chatBoxAfter.width) < 2
    && Math.abs(chatBoxBefore.height - chatBoxAfter.height) < 2;
  check('chat pane bounds unchanged by browser zoom', !!chatUnmoved);
  const zoomTooFar = await post(apiBase, '/api/browser/zoom', { zoom: 5 });
  const zoomTooNear = await post(apiBase, '/api/browser/zoom', { zoom: 0.1 });
  check('actor rejects zoom above 200%', zoomTooFar.json && zoomTooFar.json.ok === false);
  check('actor rejects zoom below 50%', zoomTooNear.json && zoomTooNear.json.ok === false);

  // ---- T9: model menu opens, lists choices, persists lite with no provider ----
  await page.click('#brainBadge');
  await waitFor(async () => (await page.locator('#modelMenu button').count()) >= 2 || null, 8000, 100);
  const modelsResp = await apiJSON(apiBase, '/api/agent/models');
  const modelChoices = (modelsResp.json && modelsResp.json.choices) || [];
  const liteChoice = modelChoices.find((c) => c.id === 'lite');
  const cloudChoice = modelChoices.find((c) => c.id === 'cloud');
  check('basic choice is offered with no key required', !!(liteChoice && liteChoice.available === true), JSON.stringify(liteChoice));
  check('cloud choice is honest without a key (not shown ready)', !!(cloudChoice && cloudChoice.available === false), JSON.stringify(cloudChoice));
  const liteIdx = await page.locator('#modelMenu button').evaluateAll((els) =>
    els.findIndex((el) => /basic tools/i.test(el.textContent || '')));
  if (liteIdx >= 0) {
    await page.locator('#modelMenu button').nth(liteIdx).click();
    await page.waitForTimeout(800);
  }
  const menuGone = (await page.locator('#modelMenu').count()) === 0;
  const cfg = await apiJSON(apiBase, '/api/config');
  const agentModel = cfg.json && cfg.json.profile && cfg.json.profile.agentModel;
  check('model menu closes after choosing', menuGone);
  check('lite choice persists without any provider key', agentModel === 'lite', String(agentModel));

  // ---- T10: repeated resize (+ touch) never overflows or collapses a pane ----
  for(let i=0;i<3;i++){
    await page.fill('#ask','read this page');
    await page.press('#ask','Enter');
    await page.waitForFunction(()=>!document.getElementById('agentStatus').classList.contains('working'));
  }
  for (const vp of [{ width: 1366, height: 768 }, { width: 1024, height: 700 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      surfRight: (() => {
        const el = document.querySelector('#browserSurface');
        if (!el) return -1;
        const r = el.getBoundingClientRect();
        return r.right;
      })(),
      panes: ['pane-chat', 'pane-browser'].map((id) => {
        const el = document.getElementById(id);
        if (!el) return { id, missing: true };
        const r = el.getBoundingClientRect();
        return { id, w: Math.round(r.width), h: Math.round(r.height) };
      }),
    }));
    check(`no app overflow at ${vp.width}x${vp.height}`,
      overflow.scroll <= overflow.inner + 1 && (overflow.surfRight < 0 || overflow.surfRight <= overflow.inner + 1),
      JSON.stringify(overflow));
    check(`chat+browser panes not collapsed at ${vp.width}x${vp.height}`,
      overflow.panes.every((p) => !p.missing && p.w > 0 && p.h > 0),
      JSON.stringify(overflow.panes));
    const latestVisible=await page.evaluate(()=>{
      const log=document.getElementById('chatLog'), last=log.lastElementChild;
      const viewport=log.getBoundingClientRect(), tail=last.getBoundingClientRect();
      return tail.bottom<=viewport.bottom+2 && tail.bottom>viewport.top;
    });
    check(`latest chat reply stays visible after resizing to ${vp.width}x${vp.height}`,latestVisible);
  }
  // Touch emulation: same canvas reachable with coarse pointers, no overflow.
  const touchCtx = await browser.newContext({ viewport: { width: 1024, height: 700 }, hasTouch: true, isMobile: true });
  const touchPage = await touchCtx.newPage();
  await touchPage.goto(base, { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await touchPage.isVisible('#pane-chat')) || null, 15000, 300);
  await touchPage.waitForTimeout(1500);
  const touchOverflow = await touchPage.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    chat: (() => { const el = document.getElementById('pane-chat'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  }));
  check('no app overflow under touch emulation (1024x700)', touchOverflow.scroll <= touchOverflow.inner + 1, JSON.stringify(touchOverflow));
  check('chat pane not collapsed under touch emulation', !!(touchOverflow.chat && touchOverflow.chat.w > 0 && touchOverflow.chat.h > 0), JSON.stringify(touchOverflow.chat));
  await touchCtx.close();

  // A drag must change the row while held, with no initial size jump.
  await page.setViewportSize({width:1366,height:768});
  await page.locator('#pane-chat .pinbtn').click();
  const resizeStart=await page.locator('#pane-chat').boundingBox();
  const edge={x:resizeStart.x+resizeStart.width-3,y:resizeStart.y+150};
  await page.mouse.move(edge.x,edge.y); await page.mouse.down();
  await page.mouse.move(edge.x+60,edge.y,{steps:4});
  const expanded=await page.locator('#pane-chat').boundingBox();
  const neighbour=await page.locator('#pane-browser').boundingBox();
  check('edge drag resizes in real time before release',expanded.width>resizeStart.width+40,
    JSON.stringify({before:resizeStart.width,during:expanded.width}));
  check('neighbour adapts without overlap while resizing',expanded.x+expanded.width<=neighbour.x+1);
  await page.mouse.move(edge.x-40,edge.y,{steps:4});
  const contracted=await page.locator('#pane-chat').boundingBox();
  check('reversing the drag shrinks without a flex-share jump',contracted.width<resizeStart.width-20);
  await page.mouse.up();
  await page.locator('#pane-chat .pinbtn').click();
  await page.waitForTimeout(500);
  const savedWidth=(await page.locator('#pane-chat').boundingBox()).width;
  await page.reload({waitUntil:'domcontentloaded'});
  await waitFor(async()=>Math.abs((await page.locator('#pane-chat').boundingBox()).width-savedWidth)<3||null,10000,100);
  check('resized pane width survives reload',Math.abs((await page.locator('#pane-chat').boundingBox()).width-savedWidth)<3);
  // ---- Super/Windows key highlight toggle ----
  const unpinnedBeforeSuper = await page.locator('.pane.unpinned').count();
  check('no pane unpinned before Super press', unpinnedBeforeSuper === 0);
  await page.keyboard.press('Meta');
  await page.waitForTimeout(400);
  const unpinnedAfterSuper = await page.locator('.pane.unpinned').count();
  const visiblePaneCount = await page.locator('.canvas > .pane:visible').count();
  check('Super key highlights all visible boxes in adjust mode', unpinnedAfterSuper > 0 && unpinnedAfterSuper === visiblePaneCount,
    JSON.stringify({ unpinned: unpinnedAfterSuper, visible: visiblePaneCount }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const unpinnedAfterKey = await page.locator('.pane.unpinned').count();
  check('next key press turns adjust mode off', unpinnedAfterKey === 0, 'unpinned=' + unpinnedAfterKey);

  // ---- Multi-tab browser pane ----
  const initialTabs = await page.locator('#browserTabsList .browser-tab').count();
  check('browser tab bar has at least one tab', initialTabs >= 1);
  await page.click('#browserTabNew');
  await page.waitForTimeout(400);
  const tabsAfterNew = await page.locator('#browserTabsList .browser-tab').count();
  check('clicking new tab button creates a second tab', tabsAfterNew === initialTabs + 1);
  const activeTabVal = await page.inputValue('#urlInput');
  check('new tab opens with ready/empty address input', activeTabVal === '');
  await page.locator('#browserTabsList .browser-tab.active .browser-tab-close').click();
  await page.waitForTimeout(400);
  const tabsAfterClose = await page.locator('#browserTabsList .browser-tab').count();
  check('closing active tab removes it and switches to remaining tab', tabsAfterClose === initialTabs);

  // Tool receipts alone are not proof: inspect the same actor's actual DOM.
  await post(apiBase, '/api/config', {slot:{agentModel:'lite'}});
  await post(apiBase, '/api/browser/view', {url:apiBase+fixturePath});
  const agentClick = await post(apiBase, '/api/ask', { query: 'click #hit', mode: 'Vibes' });
  const clickedState=await stateOf();
  check('agent click changes the displayed page title',agentClick.json?.ok===true && clickedState.title==='HIT');
  const agentType = await post(apiBase, '/api/ask', { query: 'type "test" into #q', mode: 'Vibes' });
  const agentPress = await post(apiBase, '/api/ask', { query: 'press Enter', mode: 'Vibes' });
  const submittedState=await stateOf();
  check('agent typing and Enter change the actual form state',agentType.json?.ok===true && agentPress.json?.ok===true && submittedState.title==='TYPED:test');
  const missing=await post(apiBase,'/api/ask',{query:'click #does-not-exist',mode:'Vibes'});
  check('missing agent target fails without changing the page',missing.json?.ok===false && (await stateOf()).title==='TYPED:test');

  check('no uncaught page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await shot(page, 'final');
} catch (e) {
  try {
    if (browser) {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages[0]) await shot(pages[0], 'failure').catch(() => {});
    }
  } catch {}
  console.log('HARNESS ERROR - ' + String((e && e.message) || e));
  console.log('Owned server diagnostics:\n' + serverOut.slice(-6000));
  exitCode = 1;
} finally {
  // Owned teardown only: close what this file opened, nothing broader.
  try { await browser?.close(); } catch {}
  try { child?.kill(); } catch {}
  try { await rm(vault, { recursive: true, force: true }); } catch {}
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\nreliability: ${results.length - failed.length}/${results.length} checks passed`);
console.log('report dir (kept): ' + reportDir);
for (const [name] of failed) console.log('FAILED - ' + name);
process.exit(failed.length || exitCode ? 1 : 0);
