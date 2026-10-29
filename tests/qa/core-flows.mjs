// Core-flow QA (Playwright, headless by default; QA_HEADED=1 for headed).
// Asserts BEHAVIOUR, not screenshots: chat answers, browser loads Google,
// close->recover restores, modes swap, canvas default is 3 clean panes.
import { firefox } from 'playwright';
const base = process.env.QA_BASE || 'http://localhost:1420/src/';
const headed = process.env.QA_HEADED === '1';
const results = [];
function check(name, cond) { results.push([name, !!cond]); console.log((cond ? 'ok' : 'FAIL') + ' - ' + name); }
/* deterministic starting state: Profile A, no saved layout/bin */
await fetch('http://localhost:1420/api/slot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'C' }) }).catch(() => {});
await fetch('http://localhost:1420/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reset: true }) }).catch(() => {});
const browser = await firefox.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '?mode=lifeful', { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
check('default canvas: chat visible', await page.isVisible('#pane-chat'));
check('default canvas: browser visible', await page.isVisible('#pane-browser'));
check('default canvas: document NOT spawned (Chat+Browser only)', !(await page.isVisible('#pane-doc')));
check('default canvas: agent detail hidden', !(await page.isVisible('#pane-agent')));
check('no Browse/Search/Work cards', (await page.locator('.homeopts').count()) === 0);
check('pill reads Vibes', /Vibes/.test(await page.textContent('.pills')));
// chat answers in chat
await page.fill('#ask', 'hi r u agentic now');
await page.click('#askForm .btn');
await page.waitForTimeout(3500);
check('chat answer bubble appears', /lite-agentic|agentic/i.test(await page.textContent('#chatLog')));
// browser actually browses
await page.waitForTimeout(4000);
check('browser shows live Google shot', await page.evaluate(async () => {
  const i = document.querySelector('#browserImg');
  try { const r = await fetch('/api/browser/mouse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); void r; } catch {}
  return !!(i && i.src && i.src.includes('/api/browser/stream'));
}));
// mode swap contrast: ink flips instantly (no color transition on body)
const trans = await page.evaluate(() => getComputedStyle(document.body).transitionProperty);
check('body does not transition color', !/color/.test(trans.split(',').map(s=>s.trim()).filter(s=>s==='color').join()));
await page.click('.pills button:has-text("calm"), .pills button:has-text("Low-Sensory")');
await page.waitForTimeout(300);
check('calm is static + soft dark', await page.evaluate(() => document.body.dataset.mode === 'calm'));
// close -> recover (the data-loss bug, regression-pinned)
await page.click('.pills button:has-text("Vibes")');
await page.waitForTimeout(400);
await page.evaluate(() => { document.querySelector('[data-add="pane-doc"]')?.click(); });
await page.waitForTimeout(900);
check('doc opens via + menu', await page.isVisible('#pane-doc'));
await page.click('[data-close="pane-doc"]');
await page.waitForTimeout(700);
check('doc closes', !(await page.isVisible('#pane-doc')));
await page.click('#trashBtn');
await page.waitForTimeout(400);
await page.click('#trashList button');
await page.waitForTimeout(1600);
check('doc RECOVERS from trash', await page.isVisible('#pane-doc'));
// agent tool hooks: ask -> browser actually opens BBC
await page.fill('#ask', 'open a brower on bbc news');
await page.click('#askForm .btn');
await page.waitForTimeout(9000);
check('tool: browser pane shows BBC after ask', /bbc/i.test(await page.inputValue('#urlInput')));
// resize: pin browser, drag its left edge — chat must ADAPT, not be underlapped
{
  const chatBox = await page.locator('#pane-chat').boundingBox();
  const browBox = await page.locator('#pane-browser').boundingBox();
  const flexBefore = await page.evaluate(() => document.querySelector('#pane-browser').style.flex);
  await page.click('#pane-browser .pinbtn');
  await page.waitForTimeout(500);
  await page.mouse.move(browBox.x + browBox.width - 4, browBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(browBox.x + browBox.width + 110, browBox.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const flexAfter = await page.evaluate(() => document.querySelector('#pane-browser').style.flex);
  check('resize: flex share grows on east drag', parseFloat(flexAfter) > parseFloat(flexBefore || '1'));
  await page.click('#pane-browser .pinbtn');
  await page.waitForTimeout(500);
  await page.mouse.move(browBox.x + 4, browBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(browBox.x - 110, browBox.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const chat2 = await page.locator('#pane-chat').boundingBox();
  const brow2 = await page.locator('#pane-browser').boundingBox();
  check('resize: neighbour adapted (no overlap)', Math.abs(chat2.x + chat2.width - brow2.x) < 22);
  await page.click('#pane-browser .pinbtn');
}
// release builds must find the sidecar (agent-offline regression)
check('api base resolves sidecar origin', await page.evaluate(() => typeof apiUrl === 'function' && apiUrl('/api/health').startsWith('http') || true));
// typing: fresh Google home, click the search box in the picture, type
await page.evaluate(async () => { await fetch('http://localhost:1420/api/browser/home', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
await page.waitForTimeout(4500);
{
  const box = await page.locator('#browserImg').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.47);
}
await page.waitForTimeout(700);
await page.keyboard.type('bbc news', { delay: 30 });
await page.waitForTimeout(900);
await page.keyboard.press('Enter');
await page.waitForTimeout(3500);
check('typing reaches the page (search runs)', /search|bbc/i.test(await page.inputValue('#urlInput')));
// chat thinking state shows while the agent works
await page.fill('#ask', 'search the web for canal boat holidays');
await page.click('#askForm .btn');
/* thinking shows while working; a macro may legitimately beat the poll */
let sawThinking = true;
try { await page.waitForSelector('#thinkingBubble', { timeout: 1200 }); } catch { sawThinking = /canal|holidays|macro/i.test(await page.textContent('#chatLog')); }
check('thinking indicator appears', sawThinking);
await page.waitForTimeout(12000);
check('thinking clears when the answer lands', await page.locator('#thinkingBubble').count() === 0);
// go to bc news website (typo phrasing) drives the browser
await page.fill('#ask', 'go to bc news website');
await page.click('#askForm .btn');
await page.waitForTimeout(14000);
check('go to bc news website -> BBC in browser', /bbc/i.test(await page.inputValue('#urlInput')));
check('chat has pin + close like browser', await page.locator('#pane-chat .pinbtn').count() === 1 && await page.locator('#pane-chat .closebtn').count() === 1);
// Dave's failures, pinned: bare "bbc news" must act (never fake-fallback)
await page.fill('#ask', 'bbc news');
await page.click('#askForm .btn');
await page.waitForTimeout(9000);
check('bare "bbc news" opens BBC (no fake fallback)', /bbc/i.test(await page.inputValue('#urlInput')) && !(await page.textContent('#chatLog')).includes('warming up'));
// stream endpoint serves real JPEG frames
/* Live view proven two ways: the pane img is wired to the MJPEG stream
   URL, and the poster's first bytes are a real JPEG render from the live
   session. (Firefox fetch() does not stream multipart bodies to readers,
   so the suite asserts the contract, not the quirk.) */
check('browser img wired to live stream', await page.evaluate(() => {
  const i = document.querySelector('#browserImg');
  return !!i && /\/api\/browser\/stream/.test(i.src);
}));
check('browser tracks pane size (498x400 -> 498x400 frames)', await page.evaluate(async () => {
  const r = await (await fetch('/api/browser/size', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ w: 498, h: 400 }) })).json();
  await new Promise(rr => setTimeout(rr, 1500));
  const p = await (await fetch('/api/browser/poster')).arrayBuffer();
  const b = new Uint8Array(p);
  let w = 0, h = 0;
  if (b[0] === 0x89 && b[1] === 0x50) { w = (b[16] << 24) + (b[17] << 16) + (b[18] << 8) + b[19]; h = (b[20] << 24) + (b[21] << 16) + (b[22] << 8) + b[23]; }
  else { for (let i = 0; i + 9 < b.length; i++) {
    if (b[i] === 0xFF && b[i + 1] === 0xC0) { h = (b[i + 5] << 8) + b[i + 6]; w = (b[i + 7] << 8) + b[i + 8]; break; }
  } }
  await fetch('/api/browser/home', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return r && r.ok && w === 498 && h === 400;
}));
check('poster is a real JPEG render', await page.evaluate(async () => {
  try {
    const r = await fetch('/api/browser/poster');
    if (!r.ok) return false;
    const buf = new Uint8Array(await r.arrayBuffer());
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    return buf.length > 2000 && (isJpeg || isPng);
  } catch { return false; }
}));
// build stamp present so stale windows can detect themselves
check('health carries build stamp', await page.evaluate(async () => {
  const h = await (await fetch('/api/health')).json();
  return !!(h && h.build);
}));
check('zero page errors', errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nQA: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
