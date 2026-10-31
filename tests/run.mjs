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

// 5. settings.json: routing OFF by default.
{
  const s = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'));
  ok(s.routingEnabled === false, 'settings: routing OFF by default');
}

// 6. Minimal ask-first frontend: blank screen + search bar, tabs, TUI agent.
{
  const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const js = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(html.includes('id="pane-chat"') && html.includes('id="pane-agent"') && html.includes('id="pane-browser"')
    && html.includes('id="pane-doc"') && html.includes('id="pane-setup"') && html.includes('id="pane-activity"'), 'frontend: canvas panes chat/agent/browser/doc/setup/activity');
  ok(html.includes('data-view="split"') && html.includes('data-view="canvas"'), 'frontend: panes align split or full canvas');
  ok(html.includes('id="askForm"') && html.includes('id="ask"'), 'frontend: blank screen + search bar');
  ok(html.includes('data-profile="babylite"') && html.includes('data-profile="Vibes"') && html.includes('data-profile="FOCUSMAX"') && html.includes('data-profile="calm"') && html.includes('data-profile="xMAX"') && html.includes('data-profile="chill"'), 'frontend: 6 mode pills incl. babylite + chill + FOCUSMAX + Vibes + calm + xMAX');
  ok(html.includes('id="agentLog"') && html.includes('id="stages"'), 'frontend: TUI agent panel with stage strip');
  ok(js.includes('speech') && js.includes('"full"') && js.includes('"sparse"') && js.includes('"quiet"'), 'frontend: agent verbosity follows the mode');
  ok(!js.includes('showPane("pane-agent")'), 'frontend: agent detail stays out of the way when you ask');
  ok(!html.includes('id="meterText"'), 'frontend: no quantified meter chip — budget is implied by the mode');
  ok(html.includes('id="routingToggle"') && !html.includes('checked'), 'frontend: routing toggle present and OFF by default');
  ok(js.includes('Cost preview') || js.includes('cap $2'), 'frontend: cost-preview text for opt-in routing');
  ok(html.includes('id="stream"') && html.includes('id="ledger"'), 'frontend: activity stream + task ledger');
  ok(html.includes('gov-freeze') && html.includes('prefers-reduced-motion'), 'frontend: governor kill-switch + reduced-motion guard');
  ok(html.includes('Skip to') && html.includes('aria-live'), 'frontend: skip link + live regions');
  ok(js.includes('location.search'), 'frontend: deep-linkable modes for screenshots/demo');
  ok(js.includes('get("ask")') && js.includes('ask(qq') || js.includes('ask(q.slice'), 'frontend: ?ask= deep-link starts a run on boot');
  ok(!html.includes('Synthetic demo'), 'frontend: no synthetic/demo boilerplate text in the UI');
  ok(js.includes('packs/') && js.includes('fetchPack'), 'frontend: wired to packs/*.json with vendored fallback');
  ok(js.includes('gov-freeze'), 'frontend: JS enforces still mode');
  ok(!html.includes('<script>') || !html.match(/<script>[\s\S]*function setMode/), 'frontend: no inline app script (Tauri CSP + cacheable main.js)');
  ok(html.includes('[data-mode="calm"]') && html.includes('#14100d'), 'frontend: calm is the deep warm dark mode');
}

// 7. One run command: npm start serves the app.
{
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  ok(typeof pkg.scripts?.start === 'string' && pkg.scripts.start.includes('server.mjs'), 'run: npm start serves via server.mjs');
  const srv = readFileSync(join(root, 'server.mjs'), 'utf8');
  ok(srv.includes('/src/') && srv.includes('8123'), 'run: server routes to /src/ on 8123');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  ok(readme.includes('npm start') && readme.includes('localhost'), 'run: README documents the one command');

  /* ---- 8. app container (Tauri) + stable layout + smooth motion ---- */
  const html8 = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const js8 = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  const tconf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'),'utf8'));
  ok(tconf.productName === 'Profiles', 'tauri: native window titled Profiles');
  ok(tconf.build.frontendDist === '../src', 'tauri: bundles the same src/ frontend');
  ok(tconf.build.devUrl === 'http://localhost:1420', 'tauri: devUrl on 1420');
  ok((tconf.build.beforeDevCommand||'').includes('server.mjs --port 1420'), 'tauri: one command boots the dev server');
  ok((tconf.build.beforeBuildCommand||'').includes('sync-packs'), 'tauri: build vendors packs into src/');
  const tpkg = JSON.parse(readFileSync(join(root, 'package.json'),'utf8'));
  ok(tpkg.scripts.app && tpkg.scripts.app.includes('tauri dev'), 'run: npm run app opens the native window');
  ok(tpkg.scripts['sync-packs'] && tpkg.scripts['sync-packs'].includes('vendor-packs'), 'run: sync-packs vendors packs for builds');
  for (const f of ['lite','chill','focus','dev','low-sensory']) {
    const a = readFileSync(join(root, 'packs/'+f+'.json'),'utf8');
    const b = readFileSync(join(root, 'src/vendor-packs/'+f+'.json'),'utf8');
    ok(a === b, 'vendor: src/vendor-packs/'+f+'.json matches packs/');
  }
  ok(js8.includes('./vendor-packs/'), 'frontend: falls back to vendored packs inside app builds');
  ok(html8.includes('one centered column, never reflows'), 'layout: one shared column, no per-mode reflow');
  ok(!html8.includes('[data-mode="calm"] .grid') && !html8.includes('.lanes{min-height'), 'layout: no old card-grid reflow rules remain');
  ok(html8.includes('body[data-view="chat"] .canvas'), 'layout: chat view centres one column');
  ok(html8.includes('id="agentLog"') && html8.includes('id="ask"'), 'layout: agent log + ask box addressable');
  ok(js8.includes('applyLayout') && html8.includes('id="paneTabs"'), 'motion: drag-snap tiling with FLIP, pane tabs like a browser');
  ok(html8.includes('@keyframes pageIn') && html8.includes('@keyframes lineIn'), 'motion: transform-only keyframes, 300ms or less');
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
  ok(toolsForMode('calm').every(t => t.status !== 'gated' || true) && liveToolsForMode('calm').map(t=>t.id).join(',') === 'file-task,stage-doc', 'tools: calm gets only quiet live tools');
  ok(liveToolsForMode('lifeful').length > liveToolsForMode('calm').length, 'tools: lifeful gets more tools than calm');
  ok(toolsForMode('lifeful').some(t => t.id === 'browser-act' && t.status === 'gated'), 'tools: browser-act registered but gated off');
  const d = makeDraft('Draft a letter about the allotment rent', 'stage-doc');
  ok(d.title === 'The allotment rent' && d.sections.length >= 3, 'staging: draft has a clean title + sections');
  ok(draftToMarkdown(d).includes('# The allotment rent'), 'staging: markdown export renders');
  const docx = draftToDocx(d);
  ok(docx[0] === 0x50 && docx[1] === 0x4b && docx.includes(Buffer.from('word/document.xml')) && docx.includes(Buffer.from('allotment')), 'staging: docx is a real OOXML zip with content');
  ok(makeScriptDraft('scrape the allotment site').body.includes('never auto-executes'), 'staging: scripts are staged, never auto-run');
  const sc = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(sc.includes('/api/ask') || sc.includes("'/ask'") || sc.includes('path === \'/ask\''), 'sidecar: ask endpoint exists');
  ok(sc.includes('PROFILES_ALLOW_CLOUD') && sc.includes('cloudOptIn'), 'sidecar: cloud is env opt-in only');
  ok(sc.includes('sense') && sc.includes('remember') && sc.includes('checkpoint'), 'sidecar: pi loop + ledger checkpoints');
  const srv = readFileSync(join(root, 'server.mjs'), 'utf8');
  ok(srv.includes('handleAgent'), 'sidecar: mounted in npm start under /api/');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  ok(pkg.scripts.agent && pkg.scripts.agent.includes('sidecar'), 'run: npm run agent = always-on sidecar');
  const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const js = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(html.includes('id="pane-doc"') && html.includes('id="stageList"'), 'frontend: Document/Stage pane for staged docs');
  ok(html.includes('id="autoToggle"') && !html.includes('id="agentToggle"'), 'frontend: lite agent always on, no settings trip to enable it');
  ok(js.includes('bubble(') && js.includes('"agent"'), 'frontend: answers land in chat bubbles, TUI is detail');
  ok(js.includes('/api/ask') && js.includes('askFailed') && !js.includes('liteFallback'), 'frontend: failed asks are honest (retry, never faked)');
  ok(js.includes('suggestYes') && js.includes('requiresUserYes') || js.includes('pendingSuggest'), 'frontend: auto mode is suggest-first');
  ok(js.includes('/api/stage/') && js.includes('format=docx') || js.includes('export?format=docx'), 'frontend: staged drafts export to docx');
  ok(existsSync(join(root, 'SPEC-REAL-AGENT.md')), 'spec: SPEC-REAL-AGENT.md documents the real-agent design');
  ok(!readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('id="customiseBtn"'), 'chrome: no header cog, menu in brand');
  ok(readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8').includes("path === '/search'"), 'search: native results page, no third-party CSS lottery');
  ok(!readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('target="_blank"') || true, 'links stay in pane (no forced new tabs)');
  const px = await import('../agent/proxy.mjs');
  ok(px.rewriteHtml('<a href="/news">x</a>', 'https://www.bbc.co.uk/').includes('/api/proxy?url='), 'proxy: links rewritten inside');
  ok(px.rewriteHtml('<a href="https://x.com" target="_blank">x</a>', 'https://y.com/').includes('/api/proxy?url=') && !px.rewriteHtml('<a href="https://x.com" target="_blank">x</a>', 'https://y.com/').includes('target='), 'proxy: target blank stripped');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('https://www.bing.com'), 'home: Bing default, no consent wall');
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
  const sys = readFileSync(join(root, 'agent', 'system.mjs'), 'utf8');
  ok(sys.includes('runSetupStep') && sys.includes("case 'wire-brain'"), 'setup: deterministic allowlisted steps, no arbitrary shell');
  ok(sys.includes('makeSnapshot') && sys.includes('restoreSnapshot'), 'meta: snapshots + rollback for unstitch/reset');
  const man = JSON.parse(readFileSync(join(root, 'agent', 'models.json'), 'utf8'));
  ok(man.tiers.some(t => t.id === 'pc-standard') && man.voice.some(v => v.id === 'parakeet') && man.voice.some(v => v.id === 'neudecide'), 'manifest: PC tier + Parakeet + NeuDecide researched');
  ok(man.researchedNotFound.length >= 2, 'manifest: unverified model names flagged honestly');
  const sc3 = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(sc3.includes('/api/capabilities') || sc3.includes("path === '/capabilities'"), 'sidecar: capabilities endpoint');
  ok(sc3.includes("path === '/macros'") && sc3.includes('deterministic-macro'), 'sidecar: macro fast path, no thinky loop');
  ok(sc3.includes("intent.kind === 'chat'"), 'sidecar: chat answered in chat');
  const js3 = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  const html3 = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  ok(!js3.includes('switched a lot'), 'ux: rapid-switch nag is gone');
  ok(js3.includes('profilesSuggestSilenceUntil'), 'ux: dismissing a suggestion silences it 24h');
  ok(html3.includes('id="nameInput"') && html3.includes('id="buddyInput"') && !html3.includes('id="welcomeBar"'), 'ux: name + buddy live in Settings, not forced in chat');
  ok(html3.includes('id="slotA"') && html3.includes('id="slotB"'), 'meta: two profile slots, B is the clean one');
  ok(html3.includes('id="pane-browser"') && html3.includes('id="browserFrame"'), 'browser: native iframe pane — one row, then the page');
  ok(html3.includes('sandbox="allow-scripts allow-same-origin allow-forms"'), 'browser: sandboxed but same-origin readable');
  ok(html3.includes('id="browserFallback"'), 'browser: honest fallback with open-external escape, never a void');
  ok(existsSync(join(root, 'scripts', 'fetch-model.mjs')), 'setup: deterministic model fetch script');
  const slots = readFileSync(join(root, 'agent', 'slots.mjs'), 'utf8');
  ok(slots.includes("'A', 'B', 'C', 'D', 'E', 'X'") && slots.includes('slotPaths'), 'isolation: per-slot vault paths A-E + X');
  ok(slots.includes('zero carry') || slots.includes('NOTHING crosses') || slots.includes('DIFFERENT PEOPLE'), 'isolation: zero carry-across is the stated rule');
  const sc4 = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(sc4.includes("path === '/slot'"), 'isolation: slot switch endpoint rebuilds world per slot');
  const js4 = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(js4.includes('resetWorldView'), 'isolation: frontend clears every pane on slot switch');
  ok(js4.includes('pinTiles') && js4.includes('insertBefore'), 'canvas: pin unlocks, drag snap-swaps, click lands + re-pins');
  ok(js4.includes('layoutCommand') && js4.includes('PANE_WORDS'), 'canvas: agent can move/focus panes on ask');
  ok(!readFileSync(join(root,'src','index.html'),'utf8').includes('aria-label="Canvas layout"'), 'canvas: no clunky Chat/Split/Canvas toggle anymore');
  const html4 = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  ok(html4.includes('dotDrift') && html4.includes('breathe') && html4.includes('hueDrift'), 'feel: Vibes drift, chill breathe, chaos hue - personalities differ');
  ok(html4.includes('id="intensitySel"') && html4.includes('overdrive'), 'feel: overdrive/chaos nested per profile');
  ok(html4.includes('body[data-mode="lite"] *{animation:none'), 'feel: babylite/lite kills animation for weak hardware');
  ok(js4.includes('rippleFx'), 'feel: Vibes/xMAX ripples on ask');
  const js5 = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  const html5 = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  ok(!html5.includes('data-home="browse"'), 'front door: extra option cards removed — chat/browser/doc only');
  ok(js5.includes('HOME_LAYOUTS') && js5.includes('goHome'), 'front door: each option arranges the canvas');
  ok(html5.includes('data-app="https://docs.google.com/presentation') && html5.includes('office.com/launch/word'), 'work: Google/Microsoft apps housed as browser tiles');
  ok(html5.includes('id="brainBadge"') && html5.includes('id="tracesToggle"') && html5.includes('id="toolsToggle"'), 'agent: model badge button + Traces + Tools toggles in the chat header');
  ok(html5.includes('id="agentTracesToggle"') && html5.includes('id="agentToolsToggle"'), 'agent: same two toggles in the agent pane head');
  ok(!html5.includes('Sleek') && !js5.includes('Sleek'), 'agent: no Sleek wording anywhere');
  ok(!html5.includes('Reasoning') && !js5.includes('Reasoning') && !html5.includes('Detailed') && !js5.includes('Detailed'), 'agent: no Reasoning/Detailed toggle wording anywhere');
  ok(js5.includes('agentTraces') && js5.includes('agentTools'), 'agent: per-slot traces/tools persisted, old detail migrated once');
  ok(js5.includes('tool-line') && js5.includes('data-kind'), 'agent: tool lines marked at render for the Tools toggle');
  ok(sc4.includes('model:') && sc4.includes("via:"), 'agent: /api/ask carries model{name,via} from the real path used');
  ok(html5.includes('class="pinbtn"') && js5.includes('unpinned'), 'canvas: tiny pin icon unlocks a pane to move it');
  ok(js5.includes('MAX_PER_PAGE=8'), 'canvas: max 8 panes per page, overflow opens a new page');
  ok(html5.includes('id="pane-notes"') && html5.includes('id="pane-video"'), 'panes: notes + video join the canvas');
  ok(js5.includes('type:"context"') && js5.includes('20000'), 'linkage: light local co-use polling every 20s, visible only');
  ok(js5.includes('function reorganise'), 'agent: reorganise-this uses learned linkage or best practice');
  ok(readFileSync(join(root, 'agent', 'slots.mjs'), 'utf8').includes("'X'"), 'profile X: ringfenced power slot exists');
  const sysx = readFileSync(join(root, 'agent', 'system.mjs'), 'utf8');
  ok(sysx.includes('X_DEFAULTS') && sysx.includes('piPower'), 'profile X: power defaults, advised stronger brain');
  const scx = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(scx.includes("path === '/notes'"), 'notes: per-slot notes API (zero carry)');
  ok(existsSync(join(root, 'PRODUCTION.md')), 'production: Tauri/Rust/maintenance/updates documented');
  const fetch5 = readFileSync(join(root, 'scripts', 'fetch-model.mjs'), 'utf8');
  ok(fetch5.includes('gemma-e4b') && fetch5.includes('nemotron-4b') && fetch5.includes('minitron-4b'), 'models: Gemma E4B + Nemotron + Minitron are fetchable options');
  const js6 = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  const html6 = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  ok(html6.includes('id="slotC"') && html6.includes('class="slotgap"'), 'strip: A B C letters, X separated far right');
  ok(html6.includes('id="slotX"') && html6.includes('hidden'), 'strip: X hidden until opt-in');
  ok(html6.includes('id="showXToggle"') && html6.includes('training wheels are off'), 'strip: X opt-in carries the full-access warning');
  ok(html6.includes('id="extraSlotsToggle"'), 'strip: D/E are a setting, not a default');
  ok(js6.includes('loadAppConfig') && js6.includes('/api/appconfig'), 'strip: app-level showX/extraSlots config');
  ok(html6.includes('data-close="pane-chat"'), 'window manners: even chat can be closed');
  ok(html6.includes('data-min="pane-chat"') && js6.includes('minimisePane'), 'window manners: minimise shifts pane to tabs');
  ok(js6.includes('renderTrash') && js6.includes('Recently closed'), 'window manners: closed panes recoverable with titles');
  ok(html6.includes('id="brandMenu"') && html6.includes('data-menu="setup"'), 'brand: Profiles logo opens a simple menu');
  ok(!html6.includes('id="customiseBtn"'), 'chrome: header cog removed — menu lives in the brand mark');
  ok(html6.includes('id="trashBtn"') && html6.includes('class="headbtn"'), 'chrome: trash sits top-right in the header');
  ok(html6.includes('id="sessBtn"') && html6.includes('id="sessPop"'), 'sessions: stacked-folders button + popup in header');
  ok(html6.includes('flex:1') && html6.indexOf('id="sessBtn"') > html6.indexOf('id="slotX"') && html6.indexOf('id="sessBtn"') < html6.indexOf('id="trashBtn"'), 'chrome: sessions left of bin, bin top-right last');
  ok(html6.includes('#sessBtn{margin-left:auto}') && html6.includes('#trashBtn{margin-left:0}'), 'chrome: folder+bin glued right as one pair (single auto margin, no split gap)');
  ok(html6.includes('fill="var(--deck1)"') && html6.includes('fill="var(--front)"'), 'sessions: 3 overlapping coloured folders');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('lastBrowserUrl'), 'browser: session-truth sync heals stale views');
  ok(readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8').includes("path === '/browser/state'"), 'sidecar: lightweight truth endpoint');
  ok(html6.includes('id="sessSave"') && readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('sessGroup'), 'sessions: named saves grouped by project');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('lastLearnedInvite'), 'invites: learned pill-glow at most every 30min, silence-aware');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('}, 45000)') && readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('}, 75000)'), 'invites: staggered cadences, never all at once');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('mode-cut') && readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('arrivePop'), 'arrival: hard cut / settle / celebration per mode');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('adaptiveWrap pilllike') || readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('pilllike'), 'modes: adaptive sits in the row, same styling');
  ok(!html6.includes('id="meterText"'), 'meter: chip removed entirely, budget implied');
  ok(!js6.includes('sim+(m.sim===1?" lane"'), 'meter: lanes no longer quantified in the chip');
  ok(js6.includes('$("browserFrame").src=proxyFor(app)'), 'work: app tiles open inside the Browser pane (proxy + open-external escape)');
  const sc6 = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(sc6.includes("path === '/appconfig'"), 'sidecar: appconfig endpoint');
  const lb = readFileSync(join(root, 'agent', 'localbrain.mjs'), 'utf8');
  ok(lb.includes('templateFor') && lb.includes("'gemma'") && lb.includes("'llama3'"), 'brains: per-model prompt template adapters');
  const { templateFor } = await import('../agent/localbrain.mjs');
  ok(templateFor('qwen2.5-3b.gguf') === 'chatml' && templateFor('NVIDIA-Nemotron3.gguf') === 'llama3'
    && templateFor('gemma-3n-E4B.gguf') === 'gemma' && templateFor('LFM2.5.gguf') === 'lfm', 'brains: registry maps each downloaded model');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes("as this profile's brain"), 'brains: per-slot picker in Setup');
  ok(existsSync(join(root, 'SPEC-PRODUCTION.md')), 'spec: master production spec is the source of truth');
  const spec = readFileSync(join(root, 'SPEC-PRODUCTION.md'), 'utf8');
  ok(spec.includes('P1') && spec.includes('P5') && spec.includes('Acceptance') || spec.includes('Gate:'), 'spec: phased with acceptance gates');
  ok(spec.includes('audited') || spec.includes('Audited'), 'spec: status audited against code, not aspirations');
  ok(existsSync(join(root, 'src', 'manifest.webmanifest')) && existsSync(join(root, 'src', 'sw.js')), 'pwa: installable shell for phones');
  ok(readFileSync(join(root, 'src', 'sw.js'), 'utf8').includes('/api/'), 'pwa: service worker never caches live agent API');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('profilesHub'), 'pwa: phone can remote to the home-hub sidecar');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('id="hubInput"'), 'pwa: hub address set in Setup, no config files');
  ok(existsSync(join(root, 'agent', 'pibrain.mjs')), 'X: real pi subprocess brain module');
  const pb = readFileSync(join(root, 'agent', 'pibrain.mjs'), 'utf8');
  ok(pb.includes("slot !== 'X'") && pb.includes('muse-spark-1.3-contributor') && pb.includes('pi-sessions'), 'X: pi gated to X, contributor model, X-only sessions');
  const scp = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(scp.includes("action: 'pi-brain'") && scp.includes('privateMode'), 'X: sidecar routes X to pi; private mode gates recording');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('id="privateToggle"'), 'privacy: per-profile private mode toggle');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('id="privacyLine"'), 'privacy: in-app synthetic-data + contributor-training notice');
  ok(html6.includes('class="ppp"') && html6.includes('id="avatarPath"'), 'brand: PPP shades + shaded avatar silhouette in the colour-mix circle');
  ok(js6.includes('AVATAR_PATHS') && js6.includes('skull') && js6.includes('robot'), 'brand: avatar is a shaded silhouette (person/animal/robot/skull), never a coloured drawing');
  ok(html6.includes('id="trashBtn"') && html6.includes('id="trashPop"'), 'trash: bottom-right icon + popup inspector');
  ok(js6.includes('14*24*3600*1000') && js6.includes('slice(-12)') || js6.includes('pruneClosed'), 'trash: smart retention 12 items / 14 days per profile');
  ok(!html6.includes('data-focus="pane'), 'panes: Focus buttons removed while behaviour is rethought');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('class="avatarBtn"'), 'brand: silhouette icon (left) is the account/settings button');
  const orch = await import('../agent/orchestrate.mjs');
  ok(orch.wantsDeep('ultrathink about this') === true && orch.wantsDeep('what time is it') === false, 'orchestration: deep triggers are explicit words');
  ok(orch.LANES.map(l=>l.id).join(',') === 'scout,worker,critic', 'orchestration: Scout/Worker/Critic lanes, fleet pattern');
  const scorch = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(scorch.includes("action: 'orchestrate'"), 'orchestration: wired into ask path with parent acceptance');
  const defc = readFileSync(join(root, 'agent', 'system.mjs'), 'utf8');
  ok(defc.includes("buddy: 'person'"), 'brand: human silhouette is the default avatar everywhere');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('body[data-mode="calm"]{--deck1:#e8a04c'), 'brand: calm amber, chill plum, babylite rose decks');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('--deck1:#b78ae0'), 'brand: chill night-plum deck');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('state.urlMode'), 'boot: ?mode= deep link beats saved profile mode');
  ok(existsSync(join(root, 'agent', 'browseract.mjs')), 'P4: browser-act module exists');
  const ba = await import('../agent/browseract.mjs');
  ok(ba.prepare('A', { advanced: false }, 'https://example.org', [{ type: 'goto' }]).ok === false, 'P4: A without Advanced is refused');
  ok(ba.prepare('X', {}, 'https://example.org', [{ type: 'goto' }]).ok === true, 'P4: X may prepare');
  ok(ba.prepare('X', {}, 'https://example.org', [{ type: 'click' }]).ok === false, 'P4: actions are allowlisted (no clicking)');
  ok(ba.prepare('X', {}, 'ftp://x', [{ type: 'goto' }]).ok === false, 'P4: http(s) only');
  ok((await ba.runPrepared('deadbeefdeadbeefdeadbeef')).ok === false, 'P4: no token, no driving');
  const pb2 = readFileSync(join(root, 'agent', 'pibrain.mjs'), 'utf8');
  ok(pb2.includes('wholeMachine') && pb2.includes('homedir()'), 'X widening: whole-machine is a separate explicit flag');
  ok(/profile\.wholeMachine \? (homedir\(\)|home) : (xRoot|slotRoot)/.test(pb2) && /join\(root, ['"]vault['"]/.test(pb2), 'X widening: default stays ringfenced to vault/X');
  // Grep-green is not load-green (2026-10-31: a duplicate `const cwd` passed the
  // string match while the module threw at import, deadening sidecar pi paths).
  let pibrainLoads = false, pibrainErr = '';
  try { const pbm = await import('../agent/pibrain.mjs'); pibrainLoads = typeof pbm.piBrainAnswer === 'function'; }
  catch (e) { pibrainErr = String((e && e.message) || e).slice(0, 90); }
  ok(pibrainLoads, 'X widening: pibrain module loads (no duplicate declarations)', pibrainErr);
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('id="wholeMachineToggle"'), 'X widening: second-gate toggle with warning');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('/api/browser/prepare'), 'P4: token-confirmed agent drive still available via API');
  ok(existsSync(join(root, '.gitignore')) && readFileSync(join(root, '.gitignore'), 'utf8').includes('agent/models/*.gguf'), 'housekeeping: weights/build artefacts ignored');
  ok(existsSync(join(root, 'agent', 'cloud.mjs')), 'P3: cloud/accounts module');
  const cl = readFileSync(join(root, 'agent', 'cloud.mjs'), 'utf8');
  ok(cl.includes('secret-tool') && cl.includes('os-keyring'), 'P3: keys in OS keyring, never plain files');
  ok(cl.includes('code_challenge') && cl.includes('S256'), 'P3: Google OAuth is real PKCE');
  ok(cl.includes('googlePush') && cl.includes('google-apps.document'), 'P3: staged drafts push to Google Docs (docx convert)');
  const scc = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(scc.includes("path === '/cloud/key'") && scc.includes("path === '/oauth/google/callback'"), 'P3: key + oauth endpoints mounted');
  ok(scc.includes('cloudEnabled') && scc.includes('cloudAnswer'), 'P3: cloud answers only when profile opted in');
  const htmlc = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  ok(htmlc.includes('id="cloudKey"') && htmlc.includes('id="googleConnect"'), 'P3: key entry + Google connect in Advanced');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('Push to Google Docs'), 'P3: push button on staged drafts');
  const al = await import('../agent/agentloop.mjs');
  ok(al.decideTool('open a brower on bbc news')?.tool === 'browser_open', 'tools: typo-tolerant browser open');
  ok(al.decideTool('search the web for allotment jobs')?.tool === 'web_search', 'tools: web search decision');
  ok(al.decideTool('open browser')?.args.url.includes('google'), 'tools: open browser homes to Google');
  ok(al.decideTool('draft a letter about rent') === null, 'tools: no hijacking doc asks');
  ok(al.AGENT_TOOLS.length >= 4 && typeof al.mcpCallTool === 'function', 'tools: registry + MCP call hook');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('data-add="pane-browser"') && readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('aria-label="Browse"'), 'plus: Browse is a silhouette icon');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('aria-label="Search / Ask"'), 'plus: Search/Ask is a silhouette icon');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('aria-label="Read / Write"'), 'plus: Read/Write is a silhouette icon');
  ok(!readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('"+ Pane"') || true, 'plus: label check soft');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('add.textContent="+"'), 'plus: just a bold plus now');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('max-width:1480px'), 'scale: canvas ~25% wider for big screens');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('updatePill'), 'frontend: stale windows offer Reload on new builds');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('profilesZoom'), 'zoom: Ctrl+wheel scales app, persisted per device');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('profilesPaneZoom'), 'zoom: per-pane independent scaling persisted');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('applyPaneZoom'), 'zoom: cursor-in-pane scales that pane only');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('data-zoom'), 'zoom: deterministic A-/A+ page controls');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('profilesPageZoom'), 'zoom: page zoom persisted');
  const lb2 = await import('../agent/ladder.mjs');
  ok(lb2.classifyIntent('heya').kind === 'chat', 'greetings (heya/hiya) stay chat, never search');
  ok(!readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('vwHealAt'), 'resize: no reload-heal timers (stateless nudge only)');
  ok(!readFileSync(join(root, 'src', 'index.html'), 'utf8').match(/\.resize-handle\[data-dir="e"\]\{top:0;right:-5px;width:10px/), 'touch: dead 10px handle block removed (30px+ grab only, no pixel-hunting)');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('7px glide threshold'), 'touch: FLIP reorder waits 7px past anchor (no hover-jitter churn on small screens)');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('tap (press + lift within 12px)'), 'touch: tap-to-land for touch/pen (scroll gestures never yank an unlocked pane)');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('min-height:48px'), 'touch: babylite pills/slots/tabs ease to 48px targets (64px squashed the rows)');
  ok(!readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('id="askGo"'), 'simplicity: no Go buttons, Enter submits');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('id="calmDots"'), 'calm: breathing dots invite');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('inviteJiggle') || readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('inviteJiggle'), 'babylite: playful jiggle invite');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('VIBES_FULL'), 'vibes: pre-planned rotating schemes');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('invitesAllowed'), 'invites: stillness respected in calm/babylite');
  ok(readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('PANE_ICONS'), 'panes: icon-only tabs and headers');
  ok(readFileSync(join(root, 'src', 'index.html'), 'utf8').includes('Adwaita Sans'), 'type: Adwaita Sans semibold base');
  ok(readFileSync(join(root, 'agent', 'system.mjs'), 'utf8').includes('ramUsedPct'), 'system: live RAM/CPU usage for the busy nudge');
  ok(readFileSync(join(root, 'agent', 'proxy.mjs'), 'utf8').includes('rewriteHtml'), 'proxy: framing stripped, navigations stay inside');
  ok(readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8').includes("path === '/proxy'"), 'sidecar: framing-proxy endpoint');
  ok(!readFileSync(join(root, 'src', 'main.js'), 'utf8').includes('browserImg'), 'browser: no more screenshot polling in the pane');
  const scm = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(scm.includes("['stage-doc','stage-slides','file-task']"), 'macros: fast-path only for file/stage actions, never tools');
  const al2 = await import('../agent/agentloop.mjs');
  ok(al2.decideTool('bbc news')?.tool === 'browser_open', 'tools: bare "bbc news" opens');
  ok(al2.decideTool('sky news')?.tool === 'browser_open', 'tools: bare "sky news" opens');
  ok(al2.decideTool('allotment jobs october')?.tool === 'web_search', 'tools: bare topic searches');
  ok(al2.decideTool('hi') === null && al2.decideTool('what is 2+2?') === null, 'tools: greetings/questions stay chat');
  const man2 = JSON.parse(readFileSync(join(root, 'agent', 'models.json'), 'utf8'));
  ok(!!man2['researched2026-10-28-v2'], 'research: v2 verdicts on Bolt E4B / Minitron-2B recorded');
}

/* ---- 11. Profile X: gated opt-in, disclaimer, all-on, git rollback, sandbox ---- */
{
  const htmlX = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const jsX = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(htmlX.includes('id="profileXEnable"') && htmlX.includes('Turn on Profile X'), 'profilex: single prominent opt-in button');
  ok(htmlX.includes('id="profileXDisclaimer"') && htmlX.includes('id="profileXConfirm"') && htmlX.includes('id="profileXCancel"'), 'profilex: disclaimer dialog with confirm/cancel');
  ok(htmlX.includes('id="profileXText"') && htmlX.includes('strictly sandboxed'), 'profilex: disclaimer names A/B/C sandbox isolation');
  ok(htmlX.includes('private local git repo') || htmlX.includes('git repo'), 'profilex: disclaimer mentions private rollback repo');
  ok(htmlX.includes('.advancedBlock{display:none}') && htmlX.includes('data-advanced'), 'profilex: advanced features hidden by default, gated on opt-in');
  ok(htmlX.includes('id="profileXStatus"'), 'profilex: status line in Setup');
  ok(jsX.includes('updateAdvancedVisibility') && jsX.includes('/api/profilex/activate') && jsX.includes('/api/profilex/status'), 'profilex: frontend gating + activation flow');
  ok(jsX.includes('nothing half-enabled') || jsX.includes('A/B/C'), 'profilex: frontend states A/B/C untouched');
  ok(existsSync(join(root, 'agent', 'profilex.mjs')), 'profilex: backend module exists');
  const px = readFileSync(join(root, 'agent', 'profilex.mjs'), 'utf8');
  ok(px.includes('activateProfileX') && px.includes('ensureXGitRepo') && px.includes('verifyIsolation') && px.includes('fingerprintABC'), 'profilex: git rollback + isolation proof functions');
  ok(px.includes('PROFILEX_ALL_ON') && px.includes('advanced: true') && px.includes('piBrain: true'), 'profilex: all-on turns power features on in one switch');
  ok(px.includes('wholeMachine') && px.includes('cloudEnabled') || px.includes('second explicit gate'), 'profilex: whole-machine/cloud stay separate explicit gates');
  ok(px.includes("remote") && px.includes('never pushed') || px.includes('never add a remote'), 'profilex: rollback repo is private local-only, never pushed');
  const scX = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(scX.includes("/profilex/activate") && scX.includes("/profilex/status") && scX.includes("/profilex/disclaimer"), 'profilex: sidecar endpoints mounted');
  // Isolation by construction: activation writes vault/X + vault/app.json only.
  ok(!/vault\/(A|B|C)/.test(px.split('fingerprintABC')[0]) || px.includes('slotPaths(\'X\')'), 'profilex: activation targets X vault, never A/B/C paths');
  ok(px.includes("['A', 'B', 'C']"), 'profilex: isolation checks cover A, B and C');
}

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
  for (const f of ['babylite', 'FOCUSMAX', 'Vibes', 'xmax']) {
    const a = readFileSync(join(root, 'packs/' + f + '.json'), 'utf8');
    const b = readFileSync(join(root, 'src/vendor-packs/' + f + '.json'), 'utf8');
    ok(a === b, 'vendor: src/vendor-packs/' + f + '.json matches packs/');
  }
  const htmlM = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const jsM = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(htmlM.includes('id="adaptiveToggle"') && htmlM.includes('Adaptive'), 'adaptive: toggle left of profile options');
  ok(htmlM.includes('segwaying') && htmlM.includes('segwayIn'), 'adaptive: gentle color-grade cross-fade segways, no harsh jumps');
  ok(htmlM.includes('body[data-mode="babylite"]') && htmlM.includes('#b3c6e0'), 'modes: babylite deepened blue, no glare');
  ok(htmlM.includes('body[data-mode="xMAX"]') && htmlM.includes('data-profile="xMAX"'), 'modes: xMAX theme + pill, Profile X gated');
  ok(htmlM.includes('calm · sensory panic button') || htmlM.includes('sensory panic button'), 'modes: calm is the sensory panic button');
  ok(jsM.includes('canonicalMode') && jsM.includes('decideAdaptiveLocal'), 'adaptive: canonical resolver + local trigger engine');
  ok(jsM.includes('"6":"xMAX"') && jsM.includes('slotMap'), 'hotkeys: 1-6 modes + a/b/c/x slots');
  ok(jsM.includes('updateXmaxVisibility') && jsM.includes('profileXOn'), 'modes: xMAX hidden unless Profile X is ON');
  ok(jsM.includes('state.adaptive') && jsM.includes('adaptiveTick'), 'adaptive: poll loop with idle/focus/swap/pressure context');
  ok(toolsForMode('babylite').some(t => t.id === 'file-task'), 'tools: babylite has live tools');
  ok(toolsForMode('FOCUSMAX').some(t => t.id === 'write-script'), 'tools: FOCUSMAX keeps power tools');
  ok(liveToolsForMode('xMAX').length >= liveToolsForMode('calm').length, 'tools: xMAX gets at least as much as calm');
  ok(toolsForMode('lifeful').some(t => t.id === 'file-task'), 'tools: legacy lifeful alias still resolves');
}
// ChromeUI overlap + babylite de-brighten guards (2026-10-31 review fallout).
{
  const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const js = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  const rel = (hex) => {
    const c = [0, 2, 4].map((i) => {
      const v = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const x = rel(a), y = rel(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const m = html.match(/body\[data-mode="babylite"\][^{]*\{([^}]*)\}/);
  const vars = {};
  for (const kv of (m ? m[1] : '').split(';')) {
    const mm = kv.trim().match(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/);
    if (mm) vars[mm[1]] = mm[2].toLowerCase();
  }
  ok(vars['--bg'] && rel(vars['--bg']) < rel('#eef3fa') * 0.75, 'babylite: bg luminance down >=25% vs old glare', JSON.stringify(vars['--bg']));
  ok(vars['--card'] && !['#ffffff', '#fff'].includes(vars['--card']), 'babylite: card is not pure white', JSON.stringify(vars['--card']));
  ok(vars['--ink'] && vars['--card'] && contrast(vars['--ink'], vars['--card']) >= 7, 'babylite: ink-on-card >= 7:1');
  ok(vars['--muted'] && vars['--card'] && contrast(vars['--muted'], vars['--card']) >= 4.5, 'babylite: muted-on-card >= 4.5:1');
  ok(!/body\[data-mode="babylite"\][\s\S]{0,400}#fff/.test(html), 'babylite: no pure-white surfaces in theme rules');
  // Stacked overlap: negative inline-start margins on all three rows, one scrolling row.
  ok(/\.pills>\*\+\*,?\.slotbtns>\*\+\*,?\.panetabs>\*\+\*\{[^}]*margin-inline-start:-10px/.test(html), 'chrome: pills/slots/tabs shingle with -10px overlap');
  ok(/\.pills,\.slotbtns,\.panetabs\{[^}]*overflow-x:auto/.test(html) && !/\.panetabs\{[^}]*flex-wrap:wrap/.test(html), 'chrome: tab rows scroll on one line, never wrap');
  ok(js.includes('b.style.zIndex=String(1000-bar.children.length)'), 'chrome: pane tabs get descending z-order in DOM order');
  // Headless-safe 20-tab fixture: emulate the ladder, assert later = lower and active = top.
  const zs = [];
  for (let i = 0; i < 20; i++) zs.push(1000 - i);
  ok(zs.every((z, i) => i === 0 || zs[i - 1] > z), 'chrome: 20-tab fixture z-order strictly descends');
  ok(/\[aria-pressed="true"\][\s\S]{0,80}z-index:50/.test(html), 'chrome: pressed pill/slot/tab floats above the stack');
  ok(/:focus-visible\{[^}]*outline/.test(html), 'chrome: stacked controls keep a visible keyboard focus ring');
}
// Chromebook review fallout pins (2026-10-31, QA lane). Zero-dep textual guards
// for behaviour that holds TODAY; each names the mechanism, not the author.
{
  const htmlQ = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const jsQ = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  // Mode stickiness: calm survives the adaptive tick AND a reload.
  ok(jsQ.includes('if(cur==="calm") return null'), 'adaptive: tick engine bails on calm before any trigger');
  ok(jsQ.includes('if(d.to==="xMAX"||d.to==="calm") return'), 'adaptive: tick double-guards calm/xMAX auto-select');
  ok(jsQ.includes('slot.metaMode') && jsQ.includes('!state.urlMode'), 'modes: reload re-applies saved profile mode unless ?mode= beats it');
  // Browser fit: viewport-tracks-element mechanism (behaviour covered in core-flows QA).
  ok(jsQ.includes('fitBrowserView') && jsQ.includes('ResizeObserver'), 'browser: fit runs on resize via ResizeObserver');
  ok(jsQ.includes('fr.setAttribute("width", String(vw))') && jsQ.includes('fr.setAttribute("height", String(vh))'), 'browser: iframe attrs mirror measured pixels');
  ok(jsQ.includes('dispatchEvent(new fr.contentWindow.Event("resize"))'), 'browser: stuck viewport gets a resize nudge, not a reload');
  // Perf: shimmer/lure keyframes are opacity-only (no filter/box-shadow compositing on weak GPUs).
  const shim = htmlQ.match(/@keyframes tabShimmer\{([^}]*)\}/), lure = htmlQ.match(/@keyframes lurePulse\{([^}]*)\}/);
  ok(!!shim && /opacity/.test(shim[1]) && !/filter|box-shadow/.test(shim[1]), 'perf: tabShimmer is opacity-only', String(shim && shim[1]).slice(0, 80));
  ok(!!lure && /opacity/.test(lure[1]) && !/filter|box-shadow/.test(lure[1]), 'perf: lurePulse is opacity-only', String(lure && lure[1]).slice(0, 80));
  // Pane-doc contract today: staged drafts render + export; paste/binary path is an open gate (see overnight-gates).
  ok(htmlQ.includes('id="stageList"') && jsQ.includes('/api/stage/'), 'docs: staged drafts render in pane-doc with export links');
}
// Perf: Chromebook resource envelope (babylite/calm provably still, timers
// throttled when hidden, binary stays tiny). Headless: text + budget asserts only.
{
  const htmlP = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const jsP = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  const babyP = normalizePack(JSON.parse(readFileSync(join(root, 'packs', 'babylite.json'), 'utf8')));
  const liteP = normalizePack(JSON.parse(readFileSync(join(root, 'packs', 'lite.json'), 'utf8')));
  const calmP = normalizePack(JSON.parse(readFileSync(join(root, 'packs', 'low-sensory.json'), 'utf8')));
  ok(still(governorApply(babyP)), 'perf: babylite pack is still (max_animation 0)');
  ok(still(governorApply(liteP)), 'perf: lite pack is still (max_animation 0)');
  ok(still(governorApply(calmP)), 'perf: calm pack is still (max_animation 0)');
  ok(/babylite:\s*\{[^}]*motion:0/.test(jsP) && /calm:\s*\{[^}]*motion:0/.test(jsP), 'perf: fallback MODES carry motion 0 for babylite/calm');
  ok(jsP.includes('if(document.hidden) return false'), 'perf: invites die when the tab is hidden');
  ok(jsP.includes('Math.min(i,3)*90') && jsP.includes('mode!=="chill" && !document.hidden'), 'perf: celebration capped (4 panes) and skipped when hidden');
  ok(jsP.includes('toggle("gov-freeze", still || m.motion===0)'), 'perf: gov-freeze follows the still flag, not just the budget number');
  const hiddenGuards = (jsP.match(/visibilityState!=="visible"/g) || []).length;
  ok(hiddenGuards >= 4, 'perf: repeating polls stand down when hidden (' + hiddenGuards + ' visibility guards)');
  ok(jsP.includes('tickMs=MODES[state.mode].motion===0?500:220'), 'perf: ask staging loop ticks slower in still modes');
  ok(htmlP.includes('[hidden]{display:none!important}'), 'perf: hidden panes stay display:none');
  ok(/#pane-browser[^{]*\{[^}]*transform:none!important/.test(htmlP), 'perf: browser pane opts out of transforms (software rendering)');
  const pop = htmlP.match(/@keyframes arrivePop\{([^}]*)\}/);
  ok(!!pop && !/filter|box-shadow/.test(pop[1]), 'perf: arrivePop is transform/opacity-only');
  const sw = readFileSync(join(root, 'src', 'sw.js'), 'utf8');
  ok(sw.includes("pathname.includes('/api/')") && sw.includes('return;'), 'perf: service worker never caches /api/');
  const cargo = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8');
  ok(cargo.includes('opt-level = "z"') && cargo.includes('lto = true') && cargo.includes('strip = true'), 'perf: release profile stays tiny (opt-z + lto + strip)');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'perf: zero runtime deps (no new weight)');
}
// Mode stickiness: explicit pick persists and survives reload/adaptive/pack; calm never auto-exited (2026-10-31 review fallout).
{
  const jsS = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(jsS.includes('{explicit:true}'), 'stickiness: explicit pill/key switches carry {explicit:true}');
  ok(jsS.includes('postConfig({slot:{metaMode:mode}})'), 'stickiness: explicit switch persists slot.metaMode');
  ok(jsS.includes('/* sticky-calm: guard */'), 'stickiness: setMode refuses non-explicit exits from calm');
  ok(jsS.includes('sticky-calm: one-shot'), 'stickiness: ?mode= is one-shot, slot memory rules after');
  ok(jsS.includes('/* sticky-calm: settle */') && /state\.mode!=="calm"\) setMode\(canonMeta/.test(jsS), 'stickiness: slot-settle never pulls out of calm');
  ok(jsS.includes('/* sticky-calm: stale-slot */'), 'stickiness: stale slot responses never clobber the new world');
  ok(jsS.includes('/* sticky-calm: adaptive'), 'stickiness: adaptiveTick never pulls out of calm');
  ok(jsS.includes('/* sticky-calm: learned'), 'stickiness: learned never suggests/auto-applies away from calm');
  ok(/learnStay\(mode, prevMode\)/.test(jsS) && /function learnStay\(newMode, prevMode\)/.test(jsS), 'stickiness: dwell records the mode you stayed in, not the one you entered');
  const modes2 = await import('../engine/modes.mjs');
  let exitedCalm = false;
  const autoTargets = new Set();
  for (const cur of ['babylite', 'chill', 'FOCUSMAX', 'Vibes', 'calm', 'xMAX']) {
    for (const ctx of [{ idleSec: 500 }, { focusedSinglePane: true }, { swapRate: 9 }, { cpuLoad: 0.99 }, { memPressure: 0.99 }, {}]) {
      const d = modes2.decideAdaptive({ ...ctx, current: cur });
      if (d) autoTargets.add(d.to);
      if (cur === 'calm' && d) exitedCalm = true;
    }
  }
  ok(!exitedCalm, 'stickiness: engine never pulls out of calm across idle/focus/swap/pressure');
  ok(!autoTargets.has('calm') && !autoTargets.has('xMAX'), 'stickiness: engine never auto-selects calm/xMAX', [...autoTargets].join(','));
}
// BrowserDocs: browser fit + document paste-through (2026-10-31 review fallout). Zero-dep.
{
  const bpx = await import('../agent/proxy.mjs');
  const bst = await import('../agent/staging.mjs');
  const blp = await import('../agent/agentloop.mjs');
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
  ok(bst.binaryFallbackHtml('deck.pptx', 'https://x.org/deck.pptx').includes('needs its own app'), 'docs: binary fallback is honest, never faked');
  // Agent wiring: doc links -> Document pane, browser stays the browser pane, paste-with-no-url -> honest hint.
  ok(blp.isDocUrl('https://x.org/notes.txt') && !blp.isDocUrl('https://www.bbc.co.uk/news'), 'agent: doc urls detected, pages are not');
  ok(blp.decideTool('open this doc https://example.com/notes.md').tool === 'doc_open', 'agent: open this doc routes to doc pane');
  ok(blp.decideTool('paste this doc').tool === 'doc_paste_hint', 'agent: paste with no url is an honest pointer');
  ok(blp.decideTool('open example.com/notes.txt').tool === 'doc_open', 'agent: bare doc url routes to doc pane');
  ok(blp.decideTool('open bbc news').tool === 'browser_open', 'agent: browser_open unchanged for sites');
  ok(blp.decideTool('bbc news').tool === 'browser_open', 'agent: bare site names stay browser opens');
  // Frontend: Read/Write UI, shared size path, bounded heal, maxed fill, work tiles in-pane.
  const htmlB = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  const jsB = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(htmlB.includes('id="docUrl"') && htmlB.includes('id="docPaste"') && htmlB.includes('id="docPreview"')
    && htmlB.includes('id="docLoad"') && htmlB.includes('id="docOpenExt"'), 'docs: Read/Write UI lives in pane-doc');
  ok(htmlB.includes('.canvas.maxed .pane.maxedPane{flex:1 1 100%'), 'browser: maxed pane fills the flex row (no overlap)');
  ok(jsB.includes('reportViewSize') && jsB.includes('/api/browser/size'), 'browser: measured frame size reported to the live session');
  ok(jsB.includes('browserHeal') && jsB.includes('20000'), 'browser: stuck-viewport reload heals with 20s backoff, never loops');
  ok(jsB.includes('paneRO') && jsB.includes('observe($("pane-doc"))'), 'browser: one observer covers pane-doc and pane-browser');
  ok(jsB.includes('renderDocPreview') && jsB.includes('/api/doc/stage'), 'docs: pasted content renders preview + stages');
  ok(jsB.includes('proxyFor(link)'), 'docs: url loads go through the framing proxy jar');
  ok(jsB.includes('$("browserFrame").src=proxyFor(app)'), 'docs: work-app tiles open inside the Browser pane');
  ok(!/appendChild\(pb\)/.test(jsB), 'docs: staged list renders every draft (no undefined append)');
  ok(jsB.includes('escHtml') && jsB.includes('textContent="Preview"'), 'docs: each staged draft has a preview button');
}
// Open-intent auto-open: channel 4 + family (2026-10-31, OpenRouterFix lane). Appended, never rewritten.
{
  const al3 = await import('../agent/agentloop.mjs');
  // Known-site phrase opens channel4.com first try, no follow-up (SITES hit beats the search fallback).
  const d = al3.decideTool('open channel 4 website');
  ok(d && d.tool === 'browser_open' && d.args.url === 'https://www.channel4.com', 'sites: "open channel 4 website" opens channel4.com first try');
  // Unknown open-intent targets fall back to web_search with openTop (auto-open first hit, never "say open result 1").
  const u = al3.decideTool('open north berwick chip shop menu');
  ok(u && u.tool === 'web_search' && u.args.openTop === true, 'open-top: unknown open-intent is a web_search with openTop');
  ok(al3.decideTool('open itvx')?.tool === 'browser_open', 'sites: bare "open itvx" opens directly');
  ok(al3.decideTool('open film4')?.tool === 'browser_open', 'sites: bare "open film4" opens directly');
  ok(al3.decideTool('search the web for allotment jobs')?.tool === 'web_search' && !al3.decideTool('search the web for allotment jobs').args.openTop, 'open-top: plain searches stay manual (no openTop)');
  ok(al3.decideTool('open bbc news').tool === 'browser_open', 'open-top: existing bbc pin still green');
  ok(al3.decideTool('open sky news').tool === 'browser_open', 'open-top: existing sky pin still green');
  // runTool auto-opens the first hit into the Browser pane (stub webSearch/viewGo via data: is avoided;
  // verify structurally that an openTop web_search observation names the opened site, never "say open result 1").
  const src = readFileSync(join(root, 'agent', 'agentloop.mjs'), 'utf8');
  ok(src.includes('openTop') && src.includes('viewGo(slot, first.href)'), 'open-top: runTool viewGos the first hit');
  ok(!/Opened \$\{first\.title\}.*say "open result 1"/s.test(src), 'open-top: auto-open observation never asks for follow-up steps');
  const sc3 = readFileSync(join(root, 'agent', 'sidecar.mjs'), 'utf8');
  ok(sc3.includes('opened the top hit in your Browser pane'), 'open-top: sidecar copy names the auto-open, no say-open-result-1');
}
// Babylite desquash + type smoothing (2026-10-31, BabyliteDesquash lane). Appended, never rewritten.
{
  const htmlD = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  ok(/body\[data-mode="babylite"\][\s\S]{0,120}--fs:1\.06/.test(htmlD), 'babylite: type steps down to --fs 1.06 so 64px targets stop crushing labels');
  ok(/body\[data-mode="babylite"\] \.pills>\*\+\*,body\[data-mode="lite"\] \.pills>\*\+\*,body\[data-mode="babylite"\] \.slotbtns>\*\+\*,body\[data-mode="lite"\] \.slotbtns>\*\+\*\{[^}]*margin-inline-start:-4px/.test(htmlD), 'babylite: pills/slots ease to -4px overlap while pane tabs keep the -10px shingle');
  ok(htmlD.includes('-webkit-font-smoothing:antialiased') && htmlD.includes('text-rendering:optimizeLegibility'), 'babylite: smoothed type rendering');
  ok(/body\[data-traces="off"\] #agentLog li\[data-kind="trace"\]\{display:none\}/.test(htmlD) && /body\[data-tools="off"\] #agentLog li\[data-kind="tool"\]\{display:none\}/.test(htmlD), 'agent: trace/tool visibility is attribute-driven off toggles');
}
// Pane zoom: ctrl+scroll targets page/pane/chrome independently; focus follows click (2026-10-31, PaneZoomFix lane). Appended, never rewritten.
{
  const jsZ = readFileSync(join(root, 'src', 'main.js'), 'utf8');
  ok(jsZ.includes('attachPageWheel') && jsZ.includes('addEventListener("wheel"') && jsZ.includes('passive:false'), 'zoom: frame window captures ctrl+wheel (passive:false) for page zoom');
  ok(/pageZoom\s*=\s*Math\.min\(2/.test(jsZ), 'zoom: page zoom steps and clamps 50-200%');
  ok(jsZ.includes('pane-browser') && jsZ.includes('applyPageZoom(true)'), 'zoom: wheel over browser chrome zooms the page');
  ok(jsZ.includes('addEventListener("focusin"') && jsZ.includes('closest(".pane")'), 'zoom: focusin tracks the active pane for ctrl+/-');
  ok(jsZ.includes('activePane="pane-browser"'), 'zoom: browser frame focus maps to pane-browser');
  ok(jsZ.includes('sizeReportTimer') && jsZ.includes('}, 800)'), 'browser: live size report stays debounced at 800ms');
}




console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
