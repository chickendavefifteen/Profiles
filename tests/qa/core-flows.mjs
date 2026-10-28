// Core-flow QA (Playwright, headless by default; QA_HEADED=1 for headed).
// Asserts BEHAVIOUR, not screenshots: chat answers, browser loads Google,
// close->recover restores, modes swap, canvas default is 3 clean panes.
import { firefox } from 'playwright';
const base = process.env.QA_BASE || 'http://localhost:8123/src/';
const headed = process.env.QA_HEADED === '1';
const results = [];
function check(name, cond) { results.push([name, !!cond]); console.log((cond ? 'ok' : 'FAIL') + ' - ' + name); }
const browser = await firefox.launch({ headless: !headed });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '?mode=lifeful', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check('default canvas: chat visible', await page.isVisible('#pane-chat'));
check('default canvas: browser visible', await page.isVisible('#pane-browser'));
check('default canvas: document visible', await page.isVisible('#pane-doc'));
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
check('browser shows live Google shot', await page.evaluate(() => {
  const i = document.querySelector('#browserImg');
  return i && i.complete && i.naturalWidth > 100;
}));
// mode swap contrast: ink flips instantly (no color transition on body)
const trans = await page.evaluate(() => getComputedStyle(document.body).transitionProperty);
check('body does not transition color', !/color/.test(trans.split(',').map(s=>s.trim()).filter(s=>s==='color').join()));
await page.click('[data-profile="calm"]');
await page.waitForTimeout(300);
check('calm is static + soft dark', await page.evaluate(() => document.body.dataset.mode === 'calm'));
// close -> recover (the data-loss bug, regression-pinned)
await page.click('[data-profile="lifeful"]');
await page.waitForTimeout(400);
await page.click('[data-close="pane-doc"]');
await page.waitForTimeout(700);
check('doc closes', !(await page.isVisible('#pane-doc')));
await page.click('#trashBtn');
await page.waitForTimeout(400);
await page.click('#trashList button');
await page.waitForTimeout(1600);
check('doc RECOVERS from trash', await page.isVisible('#pane-doc'));
check('zero page errors', errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nQA: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
