// Native broker unit behaviour — agent/native-browser.mjs in isolation.
//
// No server, no browser, no vault: the broker is pure in-memory leases.
// Asserts routing behaviour only (queue / complete / reject), never payload
// copy. Covers: same-slot request completes with its result, a wrong token
// cannot poll or complete, unsupported actions fail without queueing, a
// re-register expires the previous lease, and slots stay isolated.
//
// Run: node tests/native-browser.mjs
// Exit: 0 when every check passes, 1 otherwise.
import {
  registerNative,
  pollNative,
  completeNative,
  requestNative,
  hasNative,
} from '../agent/native-browser.mjs';

const results = [];
function check(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log((cond ? 'ok' : 'FAIL') + ' - ' + name + (cond || !extra ? '' : ' :: ' + extra));
}

const isToken = (t) => typeof t === 'string' && t.length > 16;

// ---- same-slot request completes with the native result ----
const regA = registerNative('A');
check('register returns a usable token', isToken(regA.token));
check('fresh lease reports native connected', hasNative('A') === true);
const pendingA = requestNative('A', 'navigate', { url: 'http://127.0.0.1/fixture' });
const pollA = pollNative(regA.token);
check('poll delivers the queued command', !!pollA && pollA.slot === 'A' && pollA.commands.length === 1);
const cmdA = pollA && pollA.commands[0];
check('queued command carries the requested action', !!cmdA && cmdA.action === 'navigate');
const doneA = cmdA && completeNative(regA.token, cmdA.id, { ok: true, url: 'http://127.0.0.1/fixture', title: 'fixture', text: 'hello' });
check('matching token completes the job', doneA === true);
const outA = await pendingA;
check('request resolves ok with native flag', !!outA && outA.ok === true && outA.native === true);
check('completed result carries the navigated location', !!outA && outA.url.includes('127.0.0.1'));
check('queue drains after completion', (() => { const p = pollNative(regA.token); return !!p && p.commands.length === 0; })());

// ---- wrong tokens cannot poll or complete ----
check('unknown token polls nothing', pollNative('not-a-real-token') === null);
const pendingB = requestNative('A', 'current');
const pollB = pollNative(regA.token);
const cmdB = pollB && pollB.commands[0];
check('second command queues on the same lease', !!cmdB && cmdB.action === 'current');
check('wrong token cannot complete the job', completeNative('not-a-real-token', cmdB.id, { ok: true }) === false);
const regC = registerNative('C');
check('other slot cannot complete the job', completeNative(regC.token, cmdB.id, { ok: true }) === false);
check('right token still completes after rejections', completeNative(regA.token, cmdB.id, { ok: true, url: 'u', title: 't', text: 'x' }) === true);
const outB = await pendingB;

// ---- re-register expires the previous lease ----
const regOld = registerNative('B');
const pendingOld = requestNative('B', 'read');
registerNative('B'); // reconnect: old lease must die loudly, not linger
check('old token polls nothing after reconnect', pollNative(regOld.token) === null);
check('old token completes nothing after reconnect', completeNative(regOld.token, 'whatever', { ok: true }) === false);
const outOld = await pendingOld;
check('in-flight request fails honestly on reconnect', !!outOld && outOld.ok === false);

// ---- slots stay isolated ----
const regA2 = registerNative('A');
const regB2 = registerNative('B');
const reqA2 = requestNative('A', 'back');
const reqB2 = requestNative('B', 'back');
const pollA2 = pollNative(regA2.token);
const pollB2 = pollNative(regB2.token);
check('slot A poll sees only slot A work', !!pollA2 && pollA2.slot === 'A' && pollA2.commands.length === 1);
check('slot B poll sees only slot B work', !!pollB2 && pollB2.slot === 'B' && pollB2.commands.length === 1);
for (const [tok, pl] of [[regA2.token, pollA2], [regB2.token, pollB2]])
  for (const c of (pl && pl.commands) || []) completeNative(tok, c.id, { ok: true });
check('isolated slot A work completes', (await reqA2).ok === true);
check('isolated slot B work completes', (await reqB2).ok === true);

// ---- unsupported actions fail without queueing ----
const regD = registerNative('D');
const badAct = await requestNative('D', 'evil-action');
check('unsupported action fails honestly', !!badAct && badAct.ok === false);
const pollD = pollNative(regD.token);
check('unsupported action queues nothing', !!pollD && pollD.commands.length === 0);

// ---- result boundaries: oversized fields truncate, unsafe links drop ----
const regE = registerNative('E');
const reqE = requestNative('E', 'read');
const pollE = pollNative(regE.token);
const cmdE = pollE && pollE.commands[0];
check('boundary job queues', !!cmdE);
const bigUrl = 'https://example.com/' + 'a'.repeat(9000);
const bigTitle = 't'.repeat(2000);
const bigText = 'x'.repeat(20000);
const bigError = 'e'.repeat(1000);
completeNative(regE.token, cmdE.id, { ok: true, url: bigUrl, title: bigTitle, text: bigText, error: bigError,
  links: [
    { title: 'good', href: 'https://example.com/Path/CaseSensitive' },
    { title: '  spaced  ', href: 'https://example.com/ok' },
    { title: '', href: 'https://example.com/empty-title' },
    { title: 'js', href: 'javascript:alert(1)' },
    { title: 'data', href: 'data:text/plain,hi' },
    { title: 'relative', href: '/just/a/path' },
    { title: 'http ok', href: 'http://example.com/plain' },
  ] });
const outE = await reqE;
check('boundary result stays ok with native flag', !!outE && outE.ok === true && outE.native === true);
check('oversized url truncates to bound', typeof outE.url === 'string' && outE.url.length <= 8192);
check('oversized title truncates to bound', typeof outE.title === 'string' && outE.title.length <= 1000);
check('oversized text truncates to bound', typeof outE.text === 'string' && outE.text.length <= 12000);
check('oversized error truncates to bound', typeof outE.error === 'string' && outE.error.length <= 500);
check('safe links survive with titles', Array.isArray(outE.links) && outE.links.some((l) => l.href === 'https://example.com/Path/CaseSensitive' && l.title === 'good'));
check('unsafe schemes never survive', Array.isArray(outE.links) && outE.links.every((l) => /^https?:\/\//i.test(l.href)));
check('empty-title links drop', Array.isArray(outE.links) && outE.links.every((l) => String(l.title || '').trim().length > 0));

// ---- direct navigation preserves original URL path case ----
const regF = registerNative('F');
const caseUrl = 'https://example.com/Path/CaseSensitive?Q=AbC&x=MiXeD';
const reqF = requestNative('F', 'navigate', { url: caseUrl });
const pollF = pollNative(regF.token);
const cmdF = pollF && pollF.commands[0];
check('navigate queues with exact-case url', !!cmdF && cmdF.args && cmdF.args.url === caseUrl);
completeNative(regF.token, cmdF.id, { ok: true, url: caseUrl, title: 'Case Page', text: 'hello' });
const outF = await reqF;
check('navigate result preserves exact-case url', !!outF && outF.url === caseUrl);

// ---- invalid native payloads fail honestly, never throw ----
const regG = registerNative('G');
const reqG = requestNative('G', 'read');
const pollG = pollNative(regG.token);
const cmdG = pollG && pollG.commands[0];
completeNative(regG.token, cmdG.id, null);
const outG = await reqG;
check('null payload resolves honest failure', !!outG && outG.ok === false && outG.native === true);

// ---- TTL expiry disconnects loudly and deterministically ----
const regH = registerNative('H');
check('fresh H lease connected', hasNative('H') === true);
const reqH = requestNative('H', 'read');
const realNow = Date.now;
Date.now = () => realNow() + 60000;
let expiredPoll = null, expiredHas = true, freshReq = null;
try {
  expiredHas = hasNative('H');
  expiredPoll = pollNative(regH.token);
  freshReq = await requestNative('H', 'read');
} finally { Date.now = realNow; }
const outH = await reqH;
check('expired lease reports disconnected', expiredHas === false);
check('expired token polls nothing', expiredPoll === null);
check('in-flight read fails honestly on TTL expiry', !!outH && outH.ok === false);
check('post-expiry request fails without queueing', !!freshReq && freshReq.ok === false);
check('post-expiry unknown token still rejected', completeNative(regH.token, 'nope', { ok: true }) === false);

const failed = results.filter(([, ok]) => !ok);
console.log(`\nnative-browser: ${results.length - failed.length}/${results.length} checks passed`);
for (const [name] of failed) console.log('FAILED - ' + name);
process.exit(failed.length ? 1 : 0);
