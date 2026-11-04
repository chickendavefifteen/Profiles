// Independent live documents, not a tab-count or URL-bookmark test.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSoftwareRuntime } from '../../scripts/qa-software-runtime.mjs';
ensureSoftwareRuntime();
const root = fileURLToPath(new URL('../../', import.meta.url));
const state = await mkdtemp('/tmp/profiles-tab-state-');
const evidence = await mkdtemp('/tmp/profiles-tab-evidence-');
const actorState = await mkdtemp('/tmp/profiles-tab-actor-');
const visits = new Map();
const fixture = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  visits.set(path, (visits.get(path) || 0) + 1);
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>${path}</title><body style="min-height:2000px"><h1>${path}</h1>
    <input id="Note" placeholder="Draft"><button id="Tick">Remember</button>
    <button id="Scroll">Scroll down</button><p id="Proof"></p><p id="Cookies"></p>
    <a id="Popup" href="/popup" target="_blank">Open popup tab</a>
    <script>let count=0;const note=document.getElementById('Note'),proof=document.getElementById('Proof');
    function show(){proof.textContent='draft='+note.value+';count='+count+';scroll='+Math.round(scrollY)}
    note.oninput=show;document.getElementById('Tick').onclick=()=>{count++;show()};
    document.getElementById('Scroll').onclick=()=>{scrollTo(0,700);show()};
    if(location.pathname==='/first')document.cookie='tabOwner=personA;path=/';
    document.getElementById('Cookies').textContent='cookies:'+document.cookie;</script>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + fixture.address().port;
const portSocket = createServer(); await new Promise(resolve => portSocket.listen(0, '127.0.0.1', resolve));
const port = portSocket.address().port; await new Promise(resolve => portSocket.close(resolve));
const base = 'http://127.0.0.1:' + port;
let browser, actor, logs = '';
const server = spawn(process.execPath, ['server.mjs', '--port', String(port)], { cwd: root,
  env: { ...process.env, PROFILES_VAULT_DIR: state, PROFILES_DISABLE_KEYRING: '1', PROFILES_DEMO_MODE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = once(server, 'exit');
server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
async function until(fn, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn().catch(() => null); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('Timed out waiting for tab outcome');
}
async function api(path, body, person = 'A', tabId) {
  const response = await fetch(base + '/api/' + path + '?profileSlot=' + person + (tabId ? '&tabId=' + tabId : ''), {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return response.json();
}
let scenarios = 0;
function pass(name) { scenarios++; console.log('ok - ' + name); }
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function browserReceipts(vault) {
  return (await readdir(vault, { recursive: true })).filter(path => /(?:^|[\\/])staging[\\/]browser[\\/].*\.(?:png|json)$/i.test(path));
}
try {
  await until(async () => (await api('health')).pid === server.pid);
  browser = await chromium.launch({ headless: true,
    env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent', PULSE_SERVER: 'unix:/nonexistent' },
    args: ['--disable-gpu', '--mute-audio', '--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/src/', { waitUntil: 'domcontentloaded' });
  await until(async () => (await api('browser/tabs')).activeTabId === 'tab-1');
  await page.evaluate(url => window.ProfilesBrowserPane.navigate(url), origin + '/first');
  const first = (await api('browser/tabs')).activeTabId;
  assert.equal((await api('browser/type', { selector: '#Note', text: 'unsaved first', clear: true }, 'A', first)).ok, true);
  assert.equal((await api('browser/click', { selector: '#Tick' }, 'A', first)).ok, true);
  assert.equal((await api('browser/click', { selector: '#Scroll' }, 'A', first)).ok, true);
  const firstBefore = await api('browser/read', {}, 'A', first);
  assert.match(firstBefore.text, /draft=unsaved first;count=1;scroll=700/);
  const firstVisits = visits.get('/first');
  await page.keyboard.press('Control+t');
  await until(async () => (await api('browser/tabs')).activeTabId !== first);
  const second = (await api('browser/tabs')).activeTabId;
  assert.equal(await page.inputValue('#urlInput'), '');
  assert.equal(await page.locator('#browserSurface img').count(), 0, 'blank tab cannot show the previous stream');
  await page.evaluate(url => window.ProfilesBrowserPane.navigate(url), origin + '/second');
  assert.equal((await api('browser/type', { selector: '#Note', text: 'second draft', clear: true }, 'A', second)).ok, true);
  assert.match((await api('browser/read', {}, 'A', second)).text, /cookies:tabOwner=personA/);
  pass('new tabs are truly blank and share cookies only within their person');
  await page.locator('[data-tab-id="' + first + '"]').click();
  await until(async () => (await api('browser/tabs')).activeTabId === first);
  const retained = await api('browser/read', {}, 'A', first);
  assert.match(retained.text, /draft=unsaved first;count=1;scroll=700/);
  assert.equal(visits.get('/first'), firstVisits, 'switching back must not request the document again');
  assert.equal(retained.tabId, first);
  pass('tab switch preserves unsaved input, JS memory and scroll without reloading');
  await page.keyboard.press('Control+Tab');
  await until(async () => (await api('browser/tabs')).activeTabId === second);
  assert.match((await api('browser/read', {}, 'A', second)).text, /draft=second draft;count=0/);
  await page.evaluate(url => window.ProfilesBrowserPane.navigate(url), origin + '/next');
  await page.locator('#browserBack').click();
  await until(async () => (await api('browser/view', {}, 'A', second)).url === origin + '/second');
  await page.locator('#browserForward').click();
  await until(async () => (await api('browser/view', {}, 'A', second)).url === origin + '/next');
  assert.equal((await api('browser/view', {}, 'A', first)).url, origin + '/first');
  pass('back/forward history belongs to each tab, not the person-wide view');
  const click = await api('ask', { query: 'click #Tick', mode: 'Vibes' }, 'A', second);
  assert.equal(click.ok, true);
  assert.match((await api('browser/read', {}, 'A', second)).text, /count=1/);
  assert.match((await api('browser/read', {}, 'A', first)).text, /draft=unsaved first;count=1/);
  const screenshot = await api('browser/screenshot', {}, 'A', second);
  assert.equal(screenshot.tabId, second); assert.match(screenshot.dataUrl, /^data:image\/png;base64,iVBOR/);
  const pixels = Buffer.from(screenshot.dataUrl.split(',')[1], 'base64');
  assert.equal(screenshot.bytes, pixels.length);
  assert.equal(screenshot.width, pixels.readUInt32BE(16));
  assert.equal(screenshot.height, pixels.readUInt32BE(20));
  assert.ok(pixels.length <= 4 * 1024 * 1024);
  for (const key of ['file', 'path', 'receipt']) assert.equal(key in screenshot, false, 'ordinary screenshots are transient: ' + key);
  assert.deepEqual(await browserReceipts(state), [], 'ordinary current/action/screenshot calls must not save browser pixels or JSON');
  pass('agent click/read and real screenshot use the displayed selected tab');
  await api('browser/tabs', {}, 'B');
  await api('browser/view', { url: origin + '/other-person' }, 'B', 'tab-1');
  const otherPerson = await api('browser/read', {}, 'B', 'tab-1');
  assert.ok(!otherPerson.text.includes('tabOwner='), 'another person must not receive the first person’s cookie');
  assert.match((await api('browser/read', {}, 'A', first)).text, /unsaved first/);
  pass('another person has separate cookies and cannot replace the first person’s documents');
  await page.evaluate(id => window.ProfilesBrowserPane.switchTab(id), second);
  assert.equal((await api('browser/click', { selector: '#Popup' }, 'A', second)).ok, true);
  const popup = await until(async () => { const tabs = await api('browser/tabs'); return tabs.tabs.find(t => t.url === origin + '/popup'); });
  await until(async () => await page.locator('[data-tab-id="' + popup.id + '"].active').count());
  assert.equal((await api('browser/view', {}, 'A', second)).url, origin + '/next');
  await page.keyboard.press('Control+w');
  await until(async () => !(await api('browser/tabs')).tabs.some(t => t.id === popup.id));
  const closed = await api('browser/click', { selector: '#Tick' }, 'A', popup.id);
  assert.equal(closed.ok, false, 'closed tab must not redirect an old click into its neighbour');
  pass('target blank opens an independent tab; close disposes it and rejects stale actions');
  await page.keyboard.press('Meta');
  assert.equal(await page.evaluate(() => window.isAdjustMode()), true);
  assert.equal(await page.locator('.pane.unpinned:visible').count(), await page.locator('.canvas>.pane:visible').count());
  await page.keyboard.press('Meta');
  assert.equal(await page.evaluate(() => window.isAdjustMode()), false, 'second Meta tap must not reopen on release');
  await page.keyboard.press('Meta');
  await page.click('#urlInput');
  assert.equal(await page.evaluate(() => window.isAdjustMode()), false);
  await page.keyboard.press('Meta+2');
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'chill');
  assert.equal(await page.evaluate(() => window.isAdjustMode()), false);
  pass('lone Super highlights all boxes; next key/click dismisses; held combinations stay intact');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('profiles-browser-shortcut',{detail:{key:'Meta',phase:'down',slot:'A--tab-1'}}));
    window.dispatchEvent(new CustomEvent('profiles-browser-shortcut',{detail:{key:'Meta',phase:'up',slot:'A--tab-1'}}));
  });
  assert.equal(await page.evaluate(() => window.isAdjustMode()), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('profiles-browser-input',{detail:{kind:'key',key:'q',slot:'A--tab-1'}})));
  assert.equal(await page.evaluate(() => window.isAdjustMode()), false);
  pass('native event phases reach the real frontend adjust and dismissal handlers (not GTK certification)');
  await page.keyboard.press('Meta');
  const beforeResize = await page.locator('#pane-chat').boundingBox();
  await page.mouse.move(beforeResize.x+beforeResize.width-3,beforeResize.y+150);
  await page.mouse.down();
  await page.mouse.move(beforeResize.x+beforeResize.width+40,beforeResize.y+150,{steps:6});
  const resizedBox=await page.locator('#pane-chat').boundingBox();
  if(resizedBox.width<=beforeResize.width+20) await page.screenshot({path:join(evidence,'resize-failure.png')});
  assert.ok(resizedBox.width>beforeResize.width+20, JSON.stringify({beforeResize,resizedBox,adjusting:await page.evaluate(()=>window.isAdjustMode()),evidence}));
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.isAdjustMode()), false, 'completing a resize locks the all-box adjustment');
  pass('Super-unlocked boxes really resize while held and lock on release');
  await page.evaluate(async ({ first, second }) => {
    const pane = window.ProfilesBrowserPane;
    await Promise.all([pane.switchTab(first), pane.switchTab(second), pane.switchTab(first), pane.switchTab(second)]);
  }, { first, second });
  await until(async () => (await api('browser/tabs')).activeTabId === second &&
    await page.evaluate(id => window.ProfilesBrowserPane.getActiveTab()?.id === id, second));
  await page.waitForTimeout(1200);
  assert.equal((await api('browser/tabs')).activeTabId, second);
  assert.equal(await page.evaluate(() => window.ProfilesBrowserPane.getActiveTab()?.id), second);
  assert.equal(await page.inputValue('#urlInput'), origin + '/next');
  assert.match((await api('browser/read', {}, 'A', first)).text, /draft=unsaved first;count=1/);
  pass('rapid overlapping switches settle on the last selected tab across polling without altering background state');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(evidence, 'independent-tabs.png') });
  await page.evaluate(id => window.ProfilesBrowserPane.closeTab(id), first);
  assert.equal((await api('browser/view', {}, 'A', second)).url, origin+'/next');
  await page.evaluate(id => window.ProfilesBrowserPane.closeTab(id), second);
  const replacement = await api('browser/tabs');
  assert.equal(replacement.tabs.length,1);
  assert.ok(![first,second].includes(replacement.activeTabId));
  assert.equal(replacement.tabs[0].url,'about:blank');
  assert.equal(await page.inputValue('#urlInput'),'');
  assert.equal(await page.locator('#browserSurface img').count(),0);
  pass('closing the final tab creates a clean new document without retaining the old stream');

  // A separate temporary vault exercises leases across awaits inside the real
  // actor, without exposing the server or the owner's persistent browser data.
  process.env.PROFILES_VAULT_DIR = actorState;
  process.env.PROFILES_NATIVE_SHELL = '0';
  actor = await import('../../agent/browseract.mjs');
  let coldRan = false;
  await actor.withBrowserTab('A', undefined, () => { coldRan = true; });
  assert.equal(coldRan, true);
  assert.deepEqual(await readdir(actorState), [], 'a text-only cold ask cannot create a browser profile');
  await actor.viewGo('A', origin + '/lease-first');
  const original = await actor.ensureSession('A');
  await original.ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await actor.viewType('A', 'lease draft', '#Note');
  await actor.viewClick('A', undefined, undefined, '#Tick');
  const queued = gate(), released = gate();
  const delayed = actor.withBrowserTab('A', undefined, async () => {
    queued.resolve();
    await released.promise;
    const actions = [
      () => actor.viewType('A', 'hidden replacement', '#Note', 'Enter'),
      () => actor.viewClick('A', undefined, undefined, '#Tick'),
      () => actor.mouseAct('A', 'click', 0.1, 0.1),
      () => actor.keysAct('A', 'type', null, 'hidden keys'),
      () => actor.viewPress('A', 'Enter'),
      () => actor.viewGo('A', origin + '/must-not-visit'),
      () => actor.viewBack('A'), () => actor.viewForward('A'), () => actor.viewReload('A'),
      () => actor.viewZoom('A', 1.5), () => actor.viewSize('A', 640, 480),
      () => actor.webSearch('A', 'must not navigate a hidden tab')
    ];
    for (const action of actions) assert.equal((await action()).ok, false, 'stale lease must reject every input/navigation mutation');
    return actor.viewRead('A');
  });
  await queued.promise;
  const next = await actor.createBrowserTab('A', { url: origin + '/lease-second' });
  released.resolve();
  assert.match((await delayed).text, /draft=lease draft;count=1/, 'explicit pinned read can still inspect a background document');
  assert.equal(original.page.url(), origin + '/lease-first');
  assert.equal(original.page.viewportSize().width, 1280);
  assert.equal(original.tab.zoom, 1);
  assert.equal(visits.get('/must-not-visit'), undefined);
  assert.equal((await actor.viewCurrent('A')).tabId, next.activeTabId);
  pass('warm optional ask leases reject delayed hidden input/navigation but retain read-only access');

  await actor.selectBrowserTab('A', original.tabId);
  const oldLocator = original.page.locator;
  for (const operation of ['type', 'click']) {
    const lookup = gate(), resume = gate();
    original.page.locator = function(selector, ...args) {
      const locator = oldLocator.call(this, selector, ...args).first();
      locator.first = () => locator;
      if (selector === (operation === 'type' ? '#Note' : '#Tick')) {
        const count = locator.count.bind(locator);
        locator.count = async () => {
          const value = await count();
          lookup.resolve(); await resume.promise;
          return value;
        };
      }
      return locator;
    };
    const mutation = operation === 'type' ? actor.viewType('A', 'late fill', '#Note') : actor.viewClick('A', undefined, undefined, '#Tick');
    await lookup.promise;
    original.page.locator = oldLocator;
    await actor.selectBrowserTab('A', next.activeTabId);
    resume.resolve();
    assert.equal((await mutation).ok, false, 'selection changed during real selector lookup: ' + operation);
    await actor.selectBrowserTab('A', original.tabId);
    assert.match((await actor.viewRead('A')).text, /draft=lease draft;count=1/);
  }
  pass('selector lookup rechecks ownership before either fill or click can affect the old document');

  const oldFillLocator = original.page.locator;
  const filled = gate(), finishFill = gate();
  await original.page.evaluate(() => document.querySelector('#Note').addEventListener('keydown', event => {
    if (event.key === 'Enter') document.querySelector('#Tick').click();
  }));
  original.page.locator = function(selector, ...args) {
    const locator = oldFillLocator.call(this, selector, ...args).first();
    locator.first = () => locator;
    if (selector === '#Note') {
      const fill = locator.fill.bind(locator);
      locator.fill = async (...values) => { await fill(...values); filled.resolve(); await finishFill.promise; };
    }
    return locator;
  };
  const fillAndPress = actor.viewType('A', 'filled before switch', '#Note', 'Enter');
  await filled.promise;
  original.page.locator = oldFillLocator;
  await actor.selectBrowserTab('A', next.activeTabId);
  finishFill.resolve();
  assert.equal((await fillAndPress).ok, false);
  assert.match((await actor.withBrowserTab('A', original.tabId, () => actor.viewRead('A'))).text, /draft=filled before switch;count=1/);
  pass('multi-step typing rechecks the selected generation before its follow-on Enter');

  await actor.selectBrowserTab('A', original.tabId);
  await original.page.locator('#Tick').evaluate(button => { button.disabled = true; });
  const waitingClick = actor.viewClick('A', undefined, undefined, '#Tick');
  await original.page.waitForTimeout(100);
  await actor.selectBrowserTab('A', next.activeTabId);
  await original.page.locator('#Tick').evaluate(button => { button.disabled = false; });
  assert.equal((await waitingClick).ok, false);
  assert.match((await actor.withBrowserTab('A', original.tabId, () => actor.viewRead('A'))).text, /count=1/);
  pass('an actionability-waiting click cannot fire later in a hidden tab');

  await actor.selectBrowserTab('A', original.tabId);
  const returned = gate(), returnRelease = gate();
  const staleGeneration = actor.withBrowserTab('A', undefined, async () => {
    returned.resolve(); await returnRelease.promise;
    return actor.viewType('A', 'stale after round trip', '#Note');
  });
  await returned.promise;
  await actor.selectBrowserTab('A', next.activeTabId);
  await actor.selectBrowserTab('A', original.tabId);
  returnRelease.resolve();
  assert.equal((await staleGeneration).ok, false, 'switching away and back must not revive a queued action');
  const realType = original.page.keyboard.type;
  for (const kind of ['focused', 'keys']) {
    await actor.selectBrowserTab('A', original.tabId);
    await original.page.locator('#Note').fill('');
    const character = gate(), continueTyping = gate();
    original.page.keyboard.type = async function(text, ...args) {
      await realType.call(this, text, ...args);
      character.resolve(); await continueTyping.promise;
    };
    const typing = kind === 'focused' ? actor.viewType('A', 'abc') : actor.keysAct('A', 'type', null, 'abc');
    await character.promise;
    original.page.keyboard.type = realType;
    await actor.selectBrowserTab('A', next.activeTabId);
    continueTyping.resolve();
    assert.equal((await typing).ok, false);
    assert.equal(await original.page.locator('#Note').inputValue(), 'a', 'remaining characters cannot be queued into a hidden input: ' + kind);
  }
  pass('focused and low-level typing stop before the next character when selection changes');
  await actor.selectBrowserTab('A', original.tabId);
  const transient = await actor.viewScreenshot('A');
  assert.equal(transient.ok, true);
  assert.equal(transient.bytes, Buffer.from(transient.dataUrl.split(',')[1], 'base64').length);
  assert.deepEqual(await browserReceipts(actorState), []);
  const closing = gate(), closedRelease = gate();
  const closedRead = actor.withBrowserTab('A', original.tabId, async () => {
    closing.resolve(); await closedRelease.promise;
    return actor.viewRead('A');
  });
  await closing.promise;
  await actor.closeBrowserTab('A', original.tabId);
  closedRelease.resolve();
  assert.equal((await closedRead).ok, false, 'even read-only leases fail when the pinned tab closes');
  const sessionQueued = gate(), sessionRelease = gate();
  const replacedRead = actor.withBrowserTab('A', undefined, async () => {
    sessionQueued.resolve(); await sessionRelease.promise;
    return actor.viewRead('A');
  });
  await sessionQueued.promise;
  await actor.closeAllSessions();
  await actor.browserTabs('A');
  sessionRelease.resolve();
  assert.equal((await replacedRead).ok, false, 'a replacement session cannot inherit an old read lease');
  pass('generation round trips, closed tabs and replacement sessions invalidate queued leases; screenshots stay transient');
  assert.deepEqual(errors, []);
  console.log('browser tabs: ' + scenarios + ' real scenarios passed; screenshot ' + join(evidence, 'independent-tabs.png'));
} catch (error) {
  console.error(logs.slice(-4000)); throw error;
} finally {
  await actor?.closeAllSessions();
  await browser?.close(); server.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(state, { recursive: true, force: true });
  await rm(actorState, { recursive: true, force: true });
}
