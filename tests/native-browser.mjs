// Native broker unit behaviour — agent/native-browser.mjs in isolation.
//
// No server, no browser, no vault: the broker is pure in-memory leases.
// Asserts routing behaviour only (queue / complete / reject), never payload
// copy. Covers: same-slot request completes with its result, a wrong token
// cannot poll or complete, unsupported actions fail without queueing, a
// re-register expires the previous lease, scoped awaits cannot adopt a new
// lease, tab results refresh selection, and slots stay isolated.
//
// Run: node tests/native-browser.mjs
// Exit: 0 when every check passes, 1 otherwise.
import {
  registerNative,
  pollNative,
  completeNative,
  requestNative,
  hasNative,
  withNativeTab,
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

// ---- reconnect rejects delivered and queued old work, not replacement work ----
const regOld = registerNative('B');
const pendingOld = requestNative('B', 'navigate', { url: 'https://example.org/old' });
const deliveredOld = pollNative(regOld.token).commands[0];
const queuedOld = requestNative('B', 'read');
const regNew = registerNative('B');
check('old token polls nothing after reconnect', pollNative(regOld.token) === null);
check('delivered old navigation fails honestly on reconnect', (await pendingOld).ok === false);
check('undelivered old read fails honestly on reconnect', (await queuedOld).ok === false);
check('replacement lease does not inherit stale queued work', pollNative(regNew.token).commands.length === 0);
const pendingNew = requestNative('B', 'navigate', { url: 'https://example.org/new' });
const deliveredNew = pollNative(regNew.token).commands[0];
check('old completion is rejected after reconnect',
  completeNative(regOld.token, deliveredOld.id, { ok: true, url: 'https://example.org/old' }) === false);
check('old token cannot settle replacement navigation',
  completeNative(regOld.token, deliveredNew.id, { ok: true, url: 'https://example.org/old' }) === false);
check('replacement token cannot resurrect expired navigation',
  completeNative(regNew.token, deliveredOld.id, { ok: true, url: 'https://example.org/old' }) === false);
check('replacement navigation remains completable',
  completeNative(regNew.token, deliveredNew.id, { ok: true, url: 'https://example.org/new', title: 'New document' }) === true);
const replacement = await pendingNew;
check('consumer sees only the replacement navigation document',
  replacement.ok === true && replacement.slot === 'B' && replacement.url === 'https://example.org/new' && replacement.title === 'New document');
check('late duplicate result cannot overwrite a completed navigation',
  completeNative(regNew.token, deliveredNew.id, { ok: false, error: 'Late cancellation' }) === false);

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

// A queued click is bound before the next poll changes the displayed tab.
const tabLease = registerNative('T', 'tab-1');
const oldClick = requestNative('T', 'click', {selector:'#hit'});
const switchedPoll = pollNative(tabLease.token, 'tab-2');
const queuedClick = switchedPoll.commands[0];
completeNative(tabLease.token, queuedClick.id, {ok:true,tabId:'tab-2',title:'WRONG DOCUMENT'});
check('tab switch rejects a result from a different displayed document', (await oldClick).ok === false);
const selectedRead = requestNative('T', 'read');
const selectedCommand = pollNative(tabLease.token).commands[0];
completeNative(tabLease.token, selectedCommand.id, {ok:true,tabId:'tab-2',text:'SECOND DOCUMENT'});
check('subsequent actions observe the newly selected live document', (await selectedRead).text === 'SECOND DOCUMENT');
const pinnedRead = withNativeTab('T','tab-1',()=>requestNative('T','read'));
const pinnedCommand = pollNative(tabLease.token).commands[0];
completeNative(tabLease.token,pinnedCommand.id,{ok:true,tabId:'tab-1',text:'ORIGINAL DOCUMENT'});
check('multi-step task keeps its originating tab instead of adopting a new selection', (await pinnedRead).text === 'ORIGINAL DOCUMENT');
check('invalid tab capability fails without an action', (await withNativeTab('T','../tab-2',()=>requestNative('T','click',{}))).ok === false);

// Provider waits must retain the exact app lease, even when a reconnect
// reuses both the profile and tab id. No timers or provider/browser needed.
for (const tabId of ['tab-1', undefined]) {
  const slot = tabId ? 'await-explicit' : 'await-selected';
  registerNative(slot, 'tab-1');
  let resume;
  const providerWait = new Promise(resolve => { resume = resolve; });
  const staleTurn = withNativeTab(slot, tabId, async () => {
    await providerWait;
    return requestNative(slot, 'click', { selector: '#replacement-must-not-receive-this' });
  });
  const nextLease = registerNative(slot, 'tab-1');
  resume();
  await Promise.resolve();
  const unexpected = pollNative(nextLease.token).commands;
  check(`${slot}: old scope never queues into a replacement lease`, unexpected.length === 0);
  // Settle any wrongly queued work so a regression reports instead of timing out.
  for (const command of unexpected) completeNative(nextLease.token, command.id, { ok: true, tabId: 'tab-1' });
  const staleResult = await staleTurn;
  check(`${slot}: old scope fails honestly after its provider wait`, staleResult.ok === false && /changed|disconnect/i.test(staleResult.error));
  const freshTurn = withNativeTab(slot, tabId, () => requestNative(slot, 'read'));
  const freshCommand = pollNative(nextLease.token).commands[0];
  check(`${slot}: fresh scope still queues on the replacement`, freshCommand?.tabId === 'tab-1');
  if (freshCommand) completeNative(nextLease.token, freshCommand.id, { ok: true, tabId: 'tab-1', text: 'fresh lease' });
  check(`${slot}: fresh same-lease command completes`, (await freshTurn).text === 'fresh lease');
}

// Optional-tab scopes capture selection at entry, not after a provider wait.
const selectedLease = registerNative('await-same', 'tab-1');
let resumeSame;
const sameWait = new Promise(resolve => { resumeSame = resolve; });
const sameTurn = withNativeTab('await-same', undefined, async () => {
  await sameWait;
  return requestNative('await-same', 'read');
});
pollNative(selectedLease.token, 'tab-2');
resumeSame();
await Promise.resolve();
const sameCommand = pollNative(selectedLease.token).commands[0];
check('same-lease awaited ask retains its originally displayed tab', sameCommand?.tabId === 'tab-1');
if (sameCommand) completeNative(selectedLease.token, sameCommand.id, { ok: true, tabId: 'tab-1', text: 'same lease' });
check('same-lease awaited command still completes', (await sameTurn).text === 'same lease');

// Text-only native asks need no connected browser. A browser connected later
// must not become a capability of the already-running no-browser ask.
check('no-browser scope can run a text-only ask', await withNativeTab('await-cold', undefined, () => 'text only') === 'text only');
let resumeCold;
const coldWait = new Promise(resolve => { resumeCold = resolve; });
const coldTurn = withNativeTab('await-cold', undefined, async () => {
  await coldWait;
  return requestNative('await-cold', 'read');
});
const coldLease = registerNative('await-cold');
resumeCold();
await Promise.resolve();
const coldCommands = pollNative(coldLease.token).commands;
check('no-browser scope cannot adopt a later app connection', coldCommands.length === 0);
for (const command of coldCommands) completeNative(coldLease.token, command.id, { ok: true, tabId: 'tab-1' });
check('no-browser scope rejects later browser work honestly', (await coldTurn).ok === false);

// Tab operations report the new selection before the next UI poll. That
// result must immediately become the default for following unscoped tools.
const tabsLease = registerNative('tabs-result', 'tab-1');
const switchTabs = requestNative('tabs-result', 'tabs', { action: 'switch', tabId: 'tab-2' });
const switchCommand = pollNative(tabsLease.token).commands[0];
completeNative(tabsLease.token, switchCommand.id, { ok: true, tabId: 'tab-2', activeTabId: 'tab-2', tabs: [{ id: 'tab-1' }, { id: 'tab-2' }] });
check('successful tabs result completes', (await switchTabs).ok === true);
const afterSwitch = requestNative('tabs-result', 'read');
const afterSwitchCommand = pollNative(tabsLease.token).commands[0];
check('successful tabs result refreshes default tab without another selection poll', afterSwitchCommand?.tabId === 'tab-2');
completeNative(tabsLease.token, afterSwitchCommand.id, { ok: true, tabId: 'tab-2' });
await afterSwitch;
const failedSwitch = requestNative('tabs-result', 'tabs', { action: 'switch', tabId: 'tab-3' });
const failedSwitchCommand = pollNative(tabsLease.token).commands[0];
completeNative(tabsLease.token, failedSwitchCommand.id, { ok: false, tabId: 'tab-3', activeTabId: 'tab-3' });
await failedSwitch;
const afterFailure = requestNative('tabs-result', 'read');
const afterFailureCommand = pollNative(tabsLease.token).commands[0];
check('failed tabs result cannot change the default tab', afterFailureCommand?.tabId === 'tab-2');
completeNative(tabsLease.token, afterFailureCommand.id, { ok: true, tabId: 'tab-2' });
await afterFailure;

const failed = results.filter(([, ok]) => !ok);
console.log(`\nnative-browser: ${results.length - failed.length}/${results.length} checks passed`);
for (const [name] of failed) console.log('FAILED - ' + name);
process.exit(failed.length ? 1 : 0);
