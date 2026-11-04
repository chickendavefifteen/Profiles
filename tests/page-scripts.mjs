// Page-script checks — zero deps beyond local playwright: the exact JS the
// native shell injects (dark + cursor + click echo) runs in a real engine.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src-tauri/src/browser-actions.js'), 'utf8');
const run = (action, args) => '(' + src + ')(' + JSON.stringify(action) + ',' + JSON.stringify(args) + ')';
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name} ${extra}`); }
}
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.setContent('<div id="pad" style="position:absolute;inset:0"></div><button id="go" style="position:absolute;left:100px;top:200px;width:120px;height:40px">Search</button>');

// Dark: on/on/off idempotent, single style tag, class flips.
ok(JSON.parse(await page.evaluate(run('dark', { on: true }))).dark === true, 'page: dark on returns true');
ok(JSON.parse(await page.evaluate(run('dark', { on: true }))).dark === true, 'page: dark on twice stays true');
ok(await page.evaluate('document.querySelectorAll("#profiles-web-dark").length') === 1, 'page: exactly one dark style tag');
ok(await page.evaluate('document.documentElement.classList.contains("profiles-webdark")') === true, 'page: dark class applied');
ok(JSON.parse(await page.evaluate(run('dark', { on: false }))).dark === false, 'page: dark off returns false');
ok(await page.evaluate('document.querySelectorAll("#profiles-web-dark").length') === 0, 'page: dark tag removed');

// Click: selector click reports the element center as fx/fy fractions.
const clicked = JSON.parse(await page.evaluate(run('click', { selector: '#go' })));
ok(clicked.ok === true, 'page: selector click ok');
const vp = page.viewportSize() || { width: 1280, height: 800 };
ok(Math.abs(clicked.fx - (100 + 60) / vp.width) < 0.02 && Math.abs(clicked.fy - (200 + 20) / vp.height) < 0.02,
  `page: click echoes element center (fx=${clicked.fx} fy=${clicked.fy})`);
// Click: explicit coordinates echo back clamped.
const coord = JSON.parse(await page.evaluate(run('click', { fx: 0.25, fy: 0.75 })));
ok(coord.ok === true && coord.fx === 0.25 && coord.fy === 0.75, 'page: coordinate click echoes fractions');

// Cursor: show/move/hide, single ring, positioned by fraction.
ok(JSON.parse(await page.evaluate(run('cursor', { show: true, fx: 0.1, fy: 0.2 }))).cursor === true, 'page: cursor shows');
ok(await page.evaluate('document.querySelectorAll("#profiles-cursor").length') === 1, 'page: single cursor ring');
ok(await page.evaluate('document.getElementById("profiles-cursor").style.left') === '10%', 'page: cursor left follows fx');
await page.evaluate(run('cursor', { show: true, fx: 0.5, fy: 0.5 }));
ok(await page.evaluate('document.getElementById("profiles-cursor").style.left') === '50%', 'page: cursor moves');
ok(JSON.parse(await page.evaluate(run('cursor', { show: false }))).cursor === false, 'page: cursor hides');
ok(await page.evaluate('document.querySelectorAll("#profiles-cursor").length') === 0, 'page: cursor removed');
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
