// Day 1 checks — zero deps: node tests/run.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack, normalizePack } from '../engine/profile.mjs';
import { governorApply, still, cssVars } from '../engine/governor.mjs';
import { resolveModel, suggestSwitch, DEFAULT_MODEL } from '../engine/router.mjs';
import { createTask, advance, checkpoint, complete, handoff } from '../engine/ledger.mjs';
import { classifyIntent, pickTier, suggestProfile, TIERS } from '../agent/ladder.mjs';
import { toolsForMode, liveToolsForMode } from '../agent/tools.mjs';
import { makeDraft, draftToMarkdown, draftToDocx, makeScriptDraft } from '../agent/staging.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name} ${extra}`); }
}

// 1. All five packs validate.
for (const f of ['lite.json', 'chill.json', 'focus.json', 'dev.json', 'low-sensory.json']) {
  const pack = JSON.parse(readFileSync(join(root, 'packs', f), 'utf8'));
  const v = validatePack(pack);
  ok(v.ok, `pack validates: ${f}`, JSON.stringify(v.errors));
}

// 2. Governor: low-sensory is still, lite clamps flash to 0.
{
  const low = normalizePack(JSON.parse(readFileSync(join(root, 'packs', 'low-sensory.json'), 'utf8')));
  const eff = governorApply(low);
  ok(still(eff), 'governor: low-sensory is still');
  ok(eff.sensory_budget.max_simultaneous === 0, 'governor: low-sensory zero simultaneous');
  ok(eff.ui.animation_level === 0, 'governor: low-sensory kills animation_level');
  const vars = cssVars(eff);
  ok(vars['--anim'] === '0', 'governor: css var --anim is 0');
  const dev = normalizePack(JSON.parse(readFileSync(join(root, 'packs', 'dev.json'), 'utf8')));
  ok(!still(governorApply(dev)), 'governor: dev is not still');
}

// 3. Router OFF by default: dev preference ignored until opt-in.
{
  const dev = normalizePack(JSON.parse(readFileSync(join(root, 'packs', 'dev.json'), 'utf8')));
  const off = resolveModel(dev, { routingEnabled: false });
  ok(off.model === DEFAULT_MODEL && !off.switched, 'router: OFF keeps fixed model');
  const on = resolveModel({ ...dev, routing: { preferred_model: 'demo-fast-model' } }, { routingEnabled: true });
  ok(on.switched && on.model === 'demo-fast-model' && !!on.costPreview, 'router: ON routes with cost preview');
  const s = suggestSwitch(dev, 'chill', 'you seem tired');
  ok(s.requiresUserYes && s.to === 'chill', 'router: suggestions require user yes');
}

// 4. Ledger round-trip: create -> advance -> checkpoint -> handoff -> complete.
{
  const ledger = [];
  const t = createTask(ledger, { title: 'demo task', device: 'desktop' });
  ok(t.state === 'inbox', 'ledger: starts in inbox');
  advance(ledger, t.id, { nextStep: 'draft note', device: 'desktop' });
  checkpoint(ledger, t.id, 'leaving desktop');
  ok(ledger[0].state === 'checkpointed', 'ledger: checkpointed with note');
  const h = handoff([...ledger, { id: 'x', state: 'done', title: 'old' }]);
  ok(h[0].id === t.id, 'ledger: handoff surfaces checkpointed first');
  complete(ledger, t.id);
  ok(ledger[0].state === 'done', 'ledger: completes');
}


// 9. Real agent: ladder, escalation, tools, staging, sidecar wiring.
{
  ok(TIERS.map(t=>t.id).join(',') === 'bundled-tiny,mobile-local,laptop-local,cloud', 'ladder: tiny -> mobile -> laptop -> cloud');
  ok(classifyIntent('File the dentist letter').kind === 'file-task', 'ladder: file verb files, does not stage a doc');
  ok(classifyIntent('Draft a letter about rent').kind === 'stage-doc', 'ladder: draft-a-letter stages a doc');
  ok(classifyIntent('Slides for the AGM').kind === 'stage-slides', 'ladder: slides stage a deck');
  const irr = classifyIntent('Send an email to the council');
  ok(irr.kind === 'irreversible' && irr.needsConfirm === true, 'ladder: send = irreversible, needs confirm');
  ok(pickTier(irr, {}).action === 'stage-draft-only', 'escalation: irreversible without cloud opt-in is staged, never sent');
  ok(pickTier(irr, { cloudOptIn: true, hasApiKey: true }).tier === 'cloud', 'escalation: irreversible with opt-in goes to cloud review');
  ok(pickTier({ kind: 'question' }, { device: 'phone' }).tier === 'mobile-local', 'ladder: phone questions use mobile tier');
  const sug = suggestProfile({ hour: 22, current: 'lifeful' });
  ok(sug && sug.to === 'chill' && sug.requiresUserYes === true, 'auto: late evening suggests Chill, never silently');
  ok(suggestProfile({ hour: 12, current: 'focus' }) === null, 'auto: no nagging when nothing fits');
  ok(liveToolsForMode('calm').map(t=>t.id).join(',') === 'file-task,stage-doc', 'tools: calm gets only quiet live tools');
  ok(liveToolsForMode('lifeful').length > liveToolsForMode('calm').length, 'tools: lifeful gets more tools than calm');
  ok(toolsForMode('lifeful').some(t => t.id === 'browser-act' && t.status === 'gated'), 'tools: browser-act registered but gated off');
  const d = makeDraft('Draft a letter about the allotment rent', 'stage-doc');
  ok(d.title === 'The allotment rent' && d.sections.length >= 3, 'staging: draft has a clean title + sections');
  ok(draftToMarkdown(d).includes('# The allotment rent'), 'staging: markdown export renders');
  const docx = draftToDocx(d);
  ok(docx[0] === 0x50 && docx[1] === 0x4b && docx.includes(Buffer.from('word/document.xml')) && docx.includes(Buffer.from('allotment')), 'staging: docx is a real OOXML zip with content');
  const px = await import('../agent/proxy.mjs');
  ok(px.rewriteHtml('<a href="/news">x</a>', 'https://www.bbc.co.uk/').includes('/api/proxy?url='), 'proxy: links rewritten inside');
  ok(px.rewriteHtml('<a href="https://x.com" target="_blank">x</a>', 'https://y.com/').includes('/api/proxy?url=') && !px.rewriteHtml('<a href="https://x.com" target="_blank">x</a>', 'https://y.com/').includes('target='), 'proxy: target blank stripped');
}

// 10. V3: chat semantics, quiet learning, deterministic macros, system layer.
{
  ok(classifyIntent('hi r u agentic now').kind === 'chat', 'chat: greeting/about-the-agent is conversation, never filed');
  ok(classifyIntent('spin me up a blank google slides').kind === 'stage-slides', 'chat: spin-up-slides stages a deck');
  ok(classifyIntent('what time is it?').kind === 'question', 'chat: questions are questions');
  const { computePreferences, learnedSuggestion } = await import('../agent/learning.mjs').catch(() => ({}));
  const evs = [];
  for (let i = 0; i < 5; i++) evs.push({ type: 'mode-stay', mode: 'calm', dwellSec: 300, at: new Date(Date.now() - i * 864e5).setHours(22, 0, 0, 0) && new Date(new Date().setHours(22,0,0,0) - i*864e5).toISOString() });
  const prefs = computePreferences ? computePreferences(evs) : {};
  ok(prefs.preferredMode && prefs.preferredMode.evening === 'calm', 'learning: dwell (not clicks) teaches evening preference');
  ok(learnedSuggestion && learnedSuggestion(prefs, 'evening', 'lifeful')?.to === 'calm', 'learning: suggestion comes from learned pattern');
  ok(learnedSuggestion && learnedSuggestion(prefs, 'evening', 'calm') === null, 'learning: silent when already where you settle');
  const { templateFor } = await import('../agent/localbrain.mjs');
  ok(templateFor('qwen2.5-3b.gguf') === 'chatml' && templateFor('NVIDIA-Nemotron3.gguf') === 'llama3'
    && templateFor('gemma-3n-E4B.gguf') === 'gemma' && templateFor('LFM2.5.gguf') === 'lfm', 'local model prompt formats match their families');
  const ba = await import('../agent/browseract.mjs');
  ok(ba.prepare('A', { advanced: false }, 'https://example.org', [{ type: 'goto' }]).ok === false, 'P4: A without Advanced is refused');
  ok(ba.prepare('X', {}, 'https://example.org', [{ type: 'goto' }]).ok === true, 'P4: X may prepare');
  ok(ba.prepare('X', {}, 'https://example.org', [{ type: 'click' }]).ok === false, 'P4: actions are allowlisted (no clicking)');
  ok(ba.prepare('X', {}, 'ftp://x', [{ type: 'goto' }]).ok === false, 'P4: http(s) only');
  ok((await ba.runPrepared('deadbeefdeadbeefdeadbeef')).ok === false, 'P4: no token, no driving');
  const al = await import('../src/agent-routing.mjs');
  ok(al.decideTool('open a brower on bbc news')?.tool === 'browser_open', 'tools: typo-tolerant browser open');
  ok(al.decideTool('search the web for allotment jobs')?.tool === 'web_search', 'tools: web search decision');
  { const b = al.decideTool('open browser'); ok(b?.tool === 'browser_open' && /^https:\/\//.test(b?.args?.url || ''), 'tools: open browser opens a browser https target (no source pinned)'); }
  ok(al.decideTool('draft a letter about rent') === null, 'tools: no hijacking doc asks');
  const lb2 = await import('../agent/ladder.mjs');
  ok(lb2.classifyIntent('heya').kind === 'chat', 'greetings (heya/hiya) stay chat, never search');
  ok(al.decideTool('allotment jobs october')?.tool === 'web_search', 'tools: bare topic searches');
}

/* ---- 11. Profile X: gated opt-in, disclaimer, all-on, git rollback, sandbox ---- */


// 11. Modes nomenclature + Adaptive switcher (2026-10-29 overnight spec, worker-2).
{
  const modes = await import('../engine/modes.mjs');
  ok(modes.MODE_ORDER.join(',') === 'babylite,chill,FOCUSMAX,Vibes,calm,xMAX', 'modes: 6 canonical modes in order');
  ok(modes.canonicalMode('lite') === 'babylite' && modes.canonicalMode('focus') === 'FOCUSMAX'
    && modes.canonicalMode('lifeful') === 'Vibes' && modes.canonicalMode('low-sensory') === 'calm'
    && modes.canonicalMode('xmax') === 'xMAX', 'modes: legacy IDs resolve to canonical');
  ok(modes.canonicalMode('FOCUSMAX') === 'FOCUSMAX' && modes.canonicalMode('Vibes') === 'Vibes', 'modes: canonical IDs stable');
  ok(modes.HOTKEY_TO_MODE['1'] === 'babylite' && modes.HOTKEY_TO_MODE['6'] === 'xMAX', 'modes: hotkeys 1-6 map to modes');
  ok(modes.HOTKEY_TO_SLOT.a === 'A' && modes.HOTKEY_TO_SLOT.c === 'C' && modes.HOTKEY_TO_SLOT.x === 'X', 'modes: hotkeys a/b/c/x map to slots');
  ok(modes.isModeVisible('xMAX', { profileXOn: false }) === false && modes.isModeVisible('xMAX', { profileXOn: true }) === true, 'modes: xMAX visible only when Profile X is ON');
  ok(modes.isModeVisible('Vibes', {}) === true && modes.isModeVisible('calm', {}) === true, 'modes: base modes always visible');
  const idle = modes.decideAdaptive({ idleSec: 120, current: 'Vibes' });
  ok(idle && idle.to === 'chill', 'adaptive: AFK/idle segways to chill');
  const foc = modes.decideAdaptive({ focusedSinglePane: true, current: 'Vibes' });
  ok(foc && foc.to === 'FOCUSMAX', 'adaptive: sustained focus segways to FOCUSMAX');
  const swap = modes.decideAdaptive({ swapRate: 7, current: 'FOCUSMAX' });
  ok(swap && swap.to === 'Vibes', 'adaptive: task swapping segways to Vibes');
  const press = modes.decideAdaptive({ cpuLoad: 0.95, current: 'Vibes' });
  ok(press && press.to === 'babylite', 'adaptive: resource pressure downshifts to babylite');
  ok(modes.decideAdaptive({ idleSec: 500, current: 'calm' }) === null, 'adaptive: never pulls out of calm automatically');
  ok(modes.decideAdaptive({ focusedSinglePane: true, current: 'calm' }) === null, 'adaptive: calm is sticky for focus too');
  for (const f of ['babylite.json', 'FOCUSMAX.json', 'Vibes.json', 'xmax.json']) {
    const pack = JSON.parse(readFileSync(join(root, 'packs', f), 'utf8'));
    const v = validatePack(pack);
    ok(v.ok, `pack validates (new nomenclature): ${f}`, JSON.stringify(v.errors));
  }
  ok(toolsForMode('babylite').some(t => t.id === 'file-task'), 'tools: babylite has live tools');
  ok(toolsForMode('FOCUSMAX').some(t => t.id === 'write-script'), 'tools: FOCUSMAX keeps power tools');
  ok(liveToolsForMode('xMAX').length >= liveToolsForMode('calm').length, 'tools: xMAX gets at least as much as calm');
  ok(toolsForMode('lifeful').some(t => t.id === 'file-task'), 'tools: legacy lifeful alias still resolves');
}
{
  const bpx = await import('../agent/proxy.mjs');
  const bst = await import('../agent/staging.mjs');
  const blp = await import('../src/agent-routing.mjs');
  // Doc kinds: text renders inline, heavy binaries get the honest fallback.
  ok(bpx.docKindForUrl('https://x.org/notes.md') === 'text', 'docs: .md classifies text');
  ok(bpx.docKindForUrl('https://x.org/a.PDF?x=1') === 'binary', 'docs: .pdf classifies binary');
  ok(bpx.docKindForUrl('https://x.org/') === 'other', 'docs: bare page classifies other');
  // Sanitize: scripts/styles/handlers/frames/javascript: links never reach the preview.
  const dirty = '<p>hi</p><script>alert(1)</script><style>x{}</style><a href="javascript:evil()" onclick="x()">c</a><iframe src="x"></iframe>';
  const clean = bpx.sanitizeDocHtml(dirty);
  ok(clean.includes('<p>hi</p>') && !/script|onclick|iframe|javascript:/i.test(clean), 'docs: pasted HTML sanitizes to inert preview');
  // Markdown: headings/bold/lists/links render, raw HTML escapes.
  const mhtml = bst.markdownToHtml('# T\n\n**b** and <b>raw</b>\n\n- a\n- b\n\n[l](https://x.org/)');
  ok(mhtml.includes('<h1>T</h1>') && mhtml.includes('<strong>b</strong>') && mhtml.includes('&lt;b&gt;raw&lt;/b&gt;')
    && mhtml.includes('<ul>') && mhtml.includes('href="https://x.org/"'), 'docs: markdown renders, raw HTML escapes');
  // Pasted-doc roundtrip: stage-shaped, markdown + real .docx export carry the content.
  const pd = bst.makePastedDoc({ title: 'Hello World', markdown: '# Hi\nbody here', sourceUrl: 'https://x.org/h.md' });
  ok(pd.kind === 'stage-doc' && pd.sections.length === 1 && pd.sourceUrl === 'https://x.org/h.md', 'docs: pasted doc stages with source');
  ok(bst.draftToMarkdown(pd).includes('# Hello World') && bst.draftToMarkdown(pd).includes('body here'), 'docs: .md export carries pasted content');
  const pdocx = bst.draftToDocx(pd);
  ok(pdocx[0] === 0x50 && pdocx[1] === 0x4b && pdocx.includes(Buffer.from('body here')), 'docs: .docx export carries pasted content');
  // Agent wiring: doc links -> Document pane, browser stays the browser pane, paste-with-no-url -> honest hint.
  ok(blp.isDocUrl('https://x.org/notes.txt') && !blp.isDocUrl('https://www.bbc.co.uk/news'), 'agent: doc urls detected, pages are not');
  ok(blp.decideTool('open this doc https://example.com/notes.md').tool === 'doc_open', 'agent: open this doc routes to doc pane');
  ok(blp.decideTool('paste this doc').tool === 'doc_paste_hint', 'agent: paste with no url is an honest pointer');
  ok(blp.decideTool('open example.com/notes.txt').tool === 'doc_open', 'agent: bare doc url routes to doc pane');
  ok(blp.decideTool('open bbc news').tool === 'browser_open', 'agent: browser_open unchanged for sites');
  ok(blp.decideTool('bbc news').tool === 'browser_open', 'agent: bare site names stay browser opens');
}
// Open-intent auto-open: channel 4 + family (2026-10-31, OpenRouterFix lane). Appended, never rewritten.
{
  const al3 = await import('../src/agent-routing.mjs');
  // Known-site phrase opens channel4.com first try, no follow-up (SITES hit beats the search fallback).
  const d = al3.decideTool('open channel 4 website');
  ok(d && d.tool === 'browser_open' && d.args.url === 'https://www.channel4.com', 'sites: "open channel 4 website" opens channel4.com first try');
  ok(al3.decideTool('open itvx')?.tool === 'browser_open', 'sites: bare "open itvx" opens directly');
  ok(al3.decideTool('open film4')?.tool === 'browser_open', 'sites: bare "open film4" opens directly');
  const plainSearch = al3.decideTool('search the web for allotment jobs');
  ok(plainSearch?.tool === 'web_search' && !('openTop' in (plainSearch.args || {})), 'open-top: plain searches stay manual (no openTop)');
  ok(al3.decideTool('open bbc news').tool === 'browser_open', 'open-top: existing bbc pin still green');
  ok(al3.decideTool('open sky news').tool === 'browser_open', 'open-top: existing sky pin still green');
}
// Universal web dark (webdark): pure rules + injected stylesheet contract.
{
  const wd = await import('../engine/webdark.mjs');
  ok(wd.hostOf('https://www.bing.com/search?q=x') === 'www.bing.com', 'webdark: host extracted');
  ok(wd.hostOf('not a url') === '' && wd.hostOf('about:blank') === '', 'webdark: garbage/about yield no host');
  ok(wd.effectiveDark('https://a.com/', true, {}) === true, 'webdark: global on wins without override');
  ok(wd.effectiveDark('https://a.com/', true, { 'a.com': false }) === false, 'webdark: site override beats global');
  const t1 = wd.toggleSite('https://a.com/', true, {});
  ok(t1.dark === false && t1.sites['a.com'] === false, 'webdark: site toggle flips effective, stores override');
  const t2 = wd.toggleGlobal(true);
  ok(t2.dark === false && t2.globalOn === false && Object.keys(t2.sites).length === 0, 'webdark: global flip clears overrides');
  const actions = readFileSync(join(root, 'src-tauri/src/browser-actions.js'), 'utf8');
  ok(actions.includes("action === 'dark'") && actions.includes('profiles-web-dark'), 'webdark: page script carries the dark action');
  ok(actions.includes('invert(1) hue-rotate(180deg)'), 'webdark: dark stylesheet inverts with hue preservation');
  const before = (actions.match(/profiles-webdark/g) || []).length;
  ok(before >= 4 && actions.includes('old.remove()') && actions.includes("classList.add") && actions.includes("classList.remove"), 'webdark: style tag id is created, removed and idempotent');
  const pane = readFileSync(join(root, 'src/browser-pane.js'), 'utf8');
  ok(pane.includes('setDark') && pane.includes("kind === 'dark'"), 'webdark: pane routes dark to the native bridge');
  const bridge = readFileSync(join(root, 'src/native-browser.js'), 'utf8');
  ok(bridge.includes('browser_dark'), 'webdark: bridge exposes browser_dark');
  const rust = readFileSync(join(root, 'src-tauri/src/browser.rs'), 'utf8');
  ok(rust.includes('pub async fn browser_dark'), 'webdark: rust command exists');
  const rs = readFileSync(join(root, 'src-tauri/src/main.rs'), 'utf8');
  ok(rs.includes('browser::browser_dark'), 'webdark: rust command is registered');
  const app = readFileSync(join(root, 'src/main.js'), 'utf8');
  const markup = readFileSync(join(root, 'src/index.html'), 'utf8');
  ok(markup.includes('id="darkBtn"') && markup.indexOf('id="darkBtn"') < markup.indexOf('id="sessBtn"'), 'webdark: header toggle sits left of the folder icon');
  ok(app.includes('$("darkBtn")'), 'webdark: app wires the header toggle');
  ok(app.includes('Super+F1') || app.includes('key==="f1"'), 'webdark: Super+F1 chord is bound');
}
// Headed search engine: Google default for the user, Bing-first kept headless.
{
  const se = await import('../engine/searcheng.mjs');
  ok(se.parseEngine('Google') === 'google' && se.parseEngine('nope') === 'google', 'searcheng: pref parses, garbage falls back to google');
  ok(se.buildSearchUrl('google', 'a b') === 'https://www.google.com/search?q=a%20b', 'searcheng: google url builds');
  ok(se.buildSearchUrl('bing', 'a') === 'https://www.bing.com/search?q=a', 'searcheng: bing url builds');
  ok(se.buildSearchUrl('duckduckgo', 'a') === 'https://html.duckduckgo.com/html/?q=a', 'searcheng: ddg url builds');
  const app2 = readFileSync(join(root, 'src/main.js'), 'utf8');
  ok(app2.includes('function searchUrl(q)') && app2.includes('profiles.searchEngine'), 'searcheng: app honors stored engine pref');
  ok(app2.includes('searchUrl(decision.args.query)'), 'searcheng: headed web_search uses the pref');
  const start = readFileSync(join(root, 'src/start.html'), 'utf8');
  ok(start.indexOf('google.com/search?q=') !== -1 && start.indexOf('>Google</a>') < start.indexOf('>Bing</a>'), 'searcheng: start page leads with google');
  const headless = readFileSync(join(root, 'agent/browseract.mjs'), 'utf8');
  ok(headless.includes('Headed user search') && headless.includes('bing.com/search?q='), 'searcheng: headless passes stay bing-first with the reason on record');
}
// Scaling: one path per gesture, clamped, synced, badged — the regression net.
{
  const app3 = readFileSync(join(root, 'src/main.js'), 'utf8');
  const pane = readFileSync(join(root, 'src/browser-pane.js'), 'utf8');
  ok(app3.includes('function clampZoom(z){ return Math.min(2,Math.max(0.5,Math.round(z*10)/10)); }'), 'scale: clamp is 0.5..2 rounded to a tenth');
  ok(app3.includes('pageZoom=reset?1:clampZoom(pageZoom+step)') && app3.includes('paneZoom[id]=reset?1') && app3.includes('appZoom=reset?1'), 'scale: all three scopes reset to exactly 1');
  ok((app3.match(/addEventListener\("wheel"/g) || []).length === 1, 'scale: exactly one app-level wheel handler');
  ok(app3.includes('if(e.defaultPrevented || !(e.ctrlKey||e.metaKey) || !e.deltaY) return;'), 'scale: wheel handler yields when already handled');
  ok(pane.includes("e.preventDefault();") && pane.includes('profiles-browser-zoom-step'), 'scale: fallback stream consumes wheel and emits single steps');
  ok(app3.includes('if(e.detail===0.1||e.detail===-0.1) stepZoom("pane-browser",e.detail,false);'), 'scale: zoom steps accept exactly +-0.1');
  ok(app3.includes('profiles-browser-zoom",function(e)') && app3.includes('pageZoom=clampZoom(value); paneZoom["pane-browser"]=pageZoom;'), 'scale: native zoom reports sync back into state + storage');
  ok(app3.includes('"Browser "+Math.round(pageZoom*100)+"%"') && app3.includes('"App "+Math.round(appZoom*100)+"%"'), 'scale: badges show rounded percent');
  ok(app3.includes('if(d.key==="F1"){ toggleWebDark(false); return; }'), 'scale: F1 typed in a page toggles web dark via the input bridge');
}
// Macro graduation: repeated all-ok tool sequences become replayable scripts.
{
  const lg = await import('../agent/learning.mjs');
  const slim = lg.slimArgs({ selector: '#go', text: 'x'.repeat(600), n: 3, b: true, nested: { a: 1 }, list: [1] });
  ok(slim.selector === '#go' && slim.n === 3 && slim.b === true, 'macros: slim keeps scalars');
  ok(slim.text.length === 500 && !('nested' in slim) && !('list' in slim), 'macros: slim caps strings, drops depth');
  const evs = [
    { type: 'ask' },
    { type: 'macro-trace', query: 'open channel 4', steps: [{ tool: 'browser_open', args: { url: 'https://x' }, ok: true }] },
    { type: 'macro-trace', query: 'open channel 4', steps: [{ tool: 'browser_open', args: { url: 'https://x' }, ok: true }] },
    { type: 'macro-trace', query: 'open channel 4', steps: [{ tool: 'browser_open', args: { url: 'https://x' }, ok: false }] },
    { type: 'macro-trace', query: 'open channel 4', steps: [{ tool: 'browser_open', args: { url: 'https://x' }, ok: true }] },
    { type: 'macro-trace', query: 'other', steps: [{ tool: 'browser_open', args: { url: 'https://x' }, ok: true }] },
  ];
  const groups = lg.groupMacroTraces(evs);
  ok(groups['open channel 4'].length === 4 && !groups['ask'], 'macros: traces group by query, noise ignored');
  const replay = lg.macroReplayFor(evs, 'Open Channel 4');
  ok(!replay, 'macros: one failed run blocks replay');
  const good = evs.filter((e) => !(e.type === 'macro-trace' && e.steps[0].ok === false));
  const replay2 = lg.macroReplayFor(good, 'open channel 4');
  ok(replay2 && replay2.steps[0].tool === 'browser_open', 'macros: 3 identical all-ok runs replay');
  ok(!lg.macroReplayFor(good.slice(0, 2), 'open channel 4'), 'macros: fewer than 3 runs never replay');
  const multi = good.concat([{ type: 'macro-trace', query: 'open channel 4', steps: [{ tool: 'a', args: {}, ok: true }, { tool: 'b', args: {}, ok: true }] }]);
  ok(!lg.macroReplayFor(multi, 'open channel 4'), 'macros: mixed sequences never replay');
  const diff = good.slice(0, 2).concat([{ type: 'macro-trace', query: 'open channel 4', steps: [{ tool: 'browser_open', args: { url: 'https://y' }, ok: true }] }]);
  ok(!lg.macroReplayFor(diff, 'open channel 4'), 'macros: differing args never replay');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
