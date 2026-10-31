// Profiles agent sidecar — the real agent behind the ask box.
// Pi-shaped loop (sense->plan->act->verify->remember) checkpointed into the
// existing durable ledger + vault. Local brain by default: no network.
// Cloud is opt-in only: PROFILES_ALLOW_CLOUD=1 + PROFILES_API_KEY (+ optional
// PROFILES_API_BASE, OpenAI-compatible). Standalone: npm run agent (:8799).
// Mounted by server.mjs under /api/ so `npm start` gives a real agent too.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { freemem } from 'node:os';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTask, advance, checkpoint, complete } from '../engine/ledger.mjs';
import { classifyIntent, pickTier, suggestProfile, TIERS } from './ladder.mjs';
import { toolsForMode, liveToolsForMode, toolById } from './tools.mjs';
import { makeDraft, draftToMarkdown, draftToDocx, makeScriptDraft } from './staging.mjs';
import { capabilities, loadConfig, saveConfig, setupPlan, runSetupStep, makeSnapshot, listSnapshots, restoreSnapshot, DEFAULT_CONFIG } from './system.mjs';
import { recordEvent, loadEvents, computePreferences, savePreferences, learnedSuggestion, ensureMacro, listMacros, norm } from './learning.mjs';

import { slotPaths, activeSlot, withSlot, setActiveSlot, ensureSlot, SLOTS } from './slots.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot = process.env.PROFILES_VAULT_DIR || join(root, 'vault');
async function paths() { const sl = await activeSlot(); return { slot: sl, ...slotPaths(sl) }; }
let configQueue = Promise.resolve();
// Per-slot conversation generation: config reset or privateMode-on bumps
// the epoch and clears the slot. In-flight turns capture the epoch first
// and never write back after a reset/private switch (no resurrection).
const convEpoch = new Map();
function bumpConvEpoch(slot) { convEpoch.set(slot, (convEpoch.get(slot) || 0) + 1); conversations.delete(slot); }
/* Build stamp: frontend polls this to detect stale windows. Any code
   change -> new stamp -> window offers Reload. Stale-window bugs die. */
import { execSync } from 'node:child_process';
export const BUILD = (() => {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: root, timeout: 3000 }).toString().trim();
    const dirty = execSync('git status --porcelain -- src agent server.mjs', { cwd: root, timeout: 3000 }).toString().trim();
    return sha + (dirty ? '-dirty' : '');
  } catch { return 'dev-' + Date.now(); }
})();
const STARTED_AT = new Date().toISOString();
const tinyModelFile = existsSync(join(dirname(fileURLToPath(import.meta.url)), 'models'))
  && (await readdir(join(dirname(fileURLToPath(import.meta.url)), 'models')).catch(() => [])).some((f) => f.endsWith('.gguf'));

const cloudOptIn = process.env.PROFILES_ALLOW_CLOUD === '1';
const hasApiKey = !!process.env.PROFILES_API_KEY;

async function loadLedger() {
  const p = await paths();
  try { return JSON.parse(await readFile(p.ledger, 'utf8')); }
  catch { return []; }
}
async function saveLedger(l) {
  const p = await paths();
  await mkdir(join(p.root, 'tasks'), { recursive: true });
  await writeFile(p.ledger, JSON.stringify(l, null, 2));
}
async function saveStage(draft) {
  const p = await paths();
  await mkdir(join(p.staging, 'scripts'), { recursive: true });
  const ext = draft.kind === 'write-script' ? 'mjs.txt' : 'json';
  const name = draft.kind === 'write-script' ? join('scripts', draft.id + '.mjs.txt') : draft.id + '.' + ext;
  await writeFile(join(p.staging, name), draft.kind === 'write-script' ? draft.body : JSON.stringify(draft, null, 2));
  return name;
}
async function listStaged() {
  const p = await paths();
  await mkdir(p.staging, { recursive: true });
  const files = (await readdir(p.staging)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) { try { out.push(JSON.parse(await readFile(join(p.staging, f), 'utf8'))); } catch {} }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function liteModel(){ return { name: "Basic tools (no model)", via: "lite" }; }
const conversations = new Map();

/** The local brain: deterministic, files real things, never phones home. */
export async function runAsk(query, mode = 'lifeful', device = 'desktop', onEvent = null) {
  const { decideTool } = await import('../src/agent-routing.mjs');
  const { runTool } = await import('./agentloop.mjs');
  const decision = decideTool(query);
  const intent = decision ? {kind:'tool',tool:decision.tool,risk:'low',needsConfirm:false} : classifyIntent(query);
  // Quiet learning: remember the ask, grow deterministic macros from repeats.
  // Private mode (per slot): nothing is recorded, full stop.
  const profEarly = await loadConfig();
  if (!profEarly.privateMode) await recordEvent({ type: 'ask', query, mode });
  {
    const evs = await loadEvents();
    const prefs = computePreferences(evs);
    await savePreferences(prefs);
    const cand = ['stage-doc','stage-slides','file-task'].includes(intent.kind) ? prefs.macroCandidates.find((c) => c.phrase === norm(query)) : null;
    var macro = null;
    if (cand) macro = await ensureMacro(cand.phrase, query);
    if (macro && cand.count > 3) {
      // Fast path: same ask, 4th+ time - deterministic, no thinky loop.
      const stagedM = intent.kind === 'stage-slides' || intent.kind === 'stage-doc' ? makeDraft(query, intent.kind) : null;
      if (stagedM) await saveStage(stagedM);
      return { query, mode, device, intent, pick: { tier: 'macro', action: 'deterministic-macro', reason: 'asked ' + cand.count + ' times - scripted now' },
        model: liteModel(),
        events: [{ stage: 'act', text: `act ✓ macro "${macro.id}" ran deterministically (no model loop)`, at: new Date().toISOString() },
          { stage: 'remember', text: 'remember ✓ macro lives in vault/macros/ - delete the file to unlearn', at: new Date().toISOString() }],
        result: `Done — ran your "${macro.id}" macro (asked ${cand.count}×, so it is scripted now, instant every time).` + (stagedM ? ` Staged "${stagedM.title}" in the Document pane.` : ''),
        chat: `Done — ran your "${macro.id}" macro (asked ${cand.count}×, so it is scripted now, instant every time).` + (stagedM ? ` Staged "${stagedM.title}" in the Document pane.` : ''),
        staged: stagedM ? { id: stagedM.id, title: stagedM.title, kind: stagedM.kind } : null, macro };
    }
    if (macro && cand.count === 3) var macroCreated = macro;
  }
  const pick = pickTier(intent, { device, cloudOptIn, hasApiKey, tinyModelFile });
  if (intent.kind === 'setup') {
    const caps = await capabilities();
    const cfg = await loadConfig();
    return { query, mode, device, intent, pick: { tier: 'bundled-tiny', action: 'setup-wizard', reason: 'deterministic setup, no LLM' },
      model: liteModel(),
      events: [{ stage: 'sense', text: `sense ✓ setup ask - deterministic wizard, no settings menu`, at: new Date().toISOString() },
        { stage: 'plan', text: `plan → scan device, recommend tier, scripted fetch, wire brain, verify`, at: new Date().toISOString() },
        { stage: 'act', text: `act ✓ setup plan ready for ${caps.deviceClass} (recommended: ${caps.recommendedTier})`, at: new Date().toISOString() },
        { stage: 'verify', text: 'verify ✓ steps are allowlisted scripts, nothing runs without your tap', at: new Date().toISOString() },
        { stage: 'remember', text: 'remember ✓ plan lives in the Setup canvas pane', at: new Date().toISOString() }],
      result: 'Setup wizard opened on the canvas - tap each step, no menus. Your device: ' + caps.deviceClass + ', recommended tier: ' + caps.recommendedTier + '.',
      setup: setupPlan(caps, cfg), capabilities: caps };
  }
  const events = [];
  if (onEvent) events.push = function(...items) {
    for (const event of items) onEvent(event);
    return Array.prototype.push.apply(this, items);
  };
  const at = () => new Date().toISOString();
  events.push({ stage:'sense', kind:'trace', text:'Request received · '+(decision?decision.tool:intent.kind), at:at() });
  const ledger = await loadLedger();
  let staged = null, result = '';
  const { runModelTurn, resolveSelection } = await import('./model-agent.mjs');
  const selection = resolveSelection(profEarly).selection;
  const direct = decision && decision.tool !== 'web_search';
  if (!direct && ['cloud', 'local'].includes(selection) && intent.risk !== 'high' && intent.kind !== 'irreversible') {
    const runSlot = (await paths()).slot;
    const startEpoch = convEpoch.get(runSlot) || 0;
    const history = profEarly.privateMode ? [] : (conversations.get(runSlot) || []);
    const answer = await runModelTurn({ slot: runSlot, profile: profEarly, query, modeLabel: mode, events, history });
    if (answer.ok && !profEarly.privateMode && (convEpoch.get(runSlot) || 0) === startEpoch) conversations.set(runSlot, history.concat(
      { role: 'user', content: String(query).slice(0,6000) },
      { role: 'assistant', content: answer.text.slice(0,6000) }).slice(-10));
    if (!answer.ok) {
      // Keep the selected route visible; never substitute another answer.
      const text = 'The selected model could not answer: ' + answer.error;
      return { query, mode, device, intent, pick: { tier: selection, action: 'model-tools' }, events,
        model: liteModel(), selectedModel: { name: selection === 'cloud' ? (profEarly.cloudModel || 'muse-spark-1.3-contributor') : (profEarly.localModel || profEarly.modelFile || 'Local model'), via: selection },
        result: text, chat: text, ui: answer.ui || null, ok: false };
    }
    const text = answer.text;
    return { query, mode, device, intent, pick: { tier: selection, action: 'model-tools' }, events,
      model: answer.model || liteModel(),
      result: text, chat: text, ui: answer.ui || null, ok: true };
  }
  // Tool loop: decide -> act -> observe -> answer (deterministic first).
  {
    if (decision) {
      events.push({ stage: 'plan', text: `plan → tool ${decision.tool} ${JSON.stringify(decision.args)}`, at: at() });
      try {
        const out = await runTool((await paths()).slot, decision);
        events.push({ stage: 'act', kind: 'tool', text: `Tool ${decision.tool} ${out.ok ? 'completed' : 'failed'}`, at: at() });
        let answer = out.observation;
        events.push({ stage: 'verify', kind: 'tool', text: out.ok ? 'Browser action completed on the active page.' : 'Browser action failed: ' + out.observation, at: at() });
        return { query, mode, device, intent: { kind: 'tool', tool: decision.tool, risk: 'low' }, pick: { tier: 'tool-loop', action: decision.tool, reason: 'agent tool hook' },
          model: liteModel(), selectedModel: { name: selection === 'cloud' ? (profEarly.cloudModel || 'muse-spark-1.3-contributor') : selection === 'local' ? (profEarly.localModel || profEarly.modelFile || 'Local model') : 'Basic tools (no model)', via: selection === 'cloud' ? 'cloud' : selection === 'local' ? 'local' : 'lite' },
          events, result: answer, chat: answer, staged: null, ui: out.ui || null };
      } catch (e) {
        events.push({ stage: 'act', text: `act ! tool failed honestly: ${String(e.message).slice(0, 140)}`, at: at() });
        const failure = 'That action failed: ' + String(e.message || e).slice(0,180);
        return { ok:false, query, mode, events, model:liteModel(), result:failure, chat:failure };
      }
    }
  }
  if (intent.kind === 'chat' || intent.kind === 'question') {
    const answer = 'Basic tools are ready: I can open websites, search, read the current page and stage documents. For conversation and multi-step requests, choose your model using the button at the top of this pane.';
    return { query, mode, device, intent, pick: { tier: 'basic', action: 'capabilities' }, events,
      model: { name: 'Basic tools (no model)', via: 'lite' }, result: answer, chat: answer };
  }
  if (pick.action === 'stage-draft-only') {
    staged = makeDraft(query, 'stage-doc');
    await saveStage(staged);
    result = `Irreversible ask staged as a draft ("${staged.title}") — nothing sent. Cloud review is opt-in and OFF.`;
    events.push({ stage: 'act', text: `act ✓ staged draft → staging/${staged.id}.json (not sent)`, at: at() });
  } else if (intent.kind === 'stage-doc' || intent.kind === 'stage-slides') {
    staged = makeDraft(query, intent.kind);
    await saveStage(staged);
    result = `Staged "${staged.title}" — preview it in the Stage tab, export .md or .docx when happy.`;
    events.push({ stage: 'act', text: `act ✓ staged ${intent.kind} → staging/${staged.id}.json`, at: at() });
  } else if (intent.kind === 'write-script') {
    staged = makeScriptDraft(query);
    await saveStage(staged);
    result = `Wrote a script draft to staging/scripts/ — review and run it yourself; Profiles never auto-runs scripts.`;
    events.push({ stage: 'act', text: `act ✓ script staged → staging/scripts/${staged.id}.mjs.txt`, at: at() });
  } else {
    const t = createTask(ledger, { title: query, device });
    advance(ledger, t.id, { nextStep: 'review staged work', device });
    events.push({ stage: 'act', text: `act ✓ filed → tasks/ledger.json (${t.id})`, at: at() });
    result = `Filed "${query}" into your vault tasks with a checkpoint.`;
    var taskRef = t;
  }
  events.push({ stage: 'verify', text: `verify ✓ tools live here: ${liveToolsForMode(mode).map((t) => t.id).join(', ') || 'none'}`, at: at() });
  if (taskRef) { checkpoint(ledger, taskRef.id, 'sidecar run'); }
  await saveLedger(ledger);
  events.push({ stage: 'remember', text: 'remember ✓ ledger checkpointed in this profile vault (plain files, slot-isolated)', at: at() });
  return { query, mode, device, intent, pick, events, model: liteModel(), result, staged: staged ? { id: staged.id, title: staged.title, kind: staged.kind } : null, macroCreated: typeof macroCreated !== 'undefined' ? macroCreated : null };
}

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'content-length': body.length });
  res.end(body);
}

/** Handles /api/* (or /* when standalone). Returns true if handled. */
export async function handleAgent(req, res, prefix = '/api') {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(prefix)) return false;
  const path = url.pathname.slice(prefix.length);
  try {
    const requestOrigin = req.headers.origin;
    const ownOrigins = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost',
      `http://${req.headers.host}`, `https://${req.headers.host}`]);
    if (requestOrigin && !ownOrigins.has(requestOrigin)) {
      json(res, 403, { error: 'This origin is not allowed to control Profiles' }); return true;
    }
    if (path.startsWith('/browser/native/')) {
      const origin = req.headers.origin;
      const allowed = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost',
        `http://localhost:${process.env.PROFILES_SERVER_PORT || 1420}`, `http://127.0.0.1:${process.env.PROFILES_SERVER_PORT || 1420}`]);
      if (!origin || !allowed.has(origin)) { json(res, 403, { error: 'Native bridge is restricted to the Profiles shell' }); return true; }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type' }); res.end(); return true;
      }
      if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return true; }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 65536) break; }
      if (raw.length > 65536) { json(res, 413, { error: 'Bridge payload too large' }); return true; }
      const body = JSON.parse(raw || '{}');
      const bridge = await import('./native-browser.mjs');
      if (path === '/browser/native/register') { json(res, 200, { ok: true, ...bridge.registerNative((await paths()).slot) }); return true; }
      if (path === '/browser/native/poll') {
        const out = bridge.pollNative(body.token);
        json(res, out ? 200 : 401, out || { error: 'Native session expired' }); return true;
      }
      if (path === '/browser/native/result') {
        const ok = bridge.completeNative(body.token, body.id, body.result);
        json(res, ok ? 200 : 409, { ok }); return true;
      }
      json(res, 404, { error: 'Unknown bridge operation' }); return true;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': 'content-type' }); res.end(); return true; }
    if (path === '/health' && req.method === 'GET') {
      const profile=await loadConfig();
      const {resolveSelection}=await import('./model-agent.mjs');
      const selected=resolveSelection(profile).selection;
      const {hasNative}=await import('./native-browser.mjs');
      const nativeBrowserReady=process.env.PROFILES_NATIVE_SHELL!=='1' || hasNative((await paths()).slot);
      json(res, 200, { ok: true, pid:process.pid, build: BUILD, startedAt: STARTED_AT,
        nativeBrowserReady,
        brain:selected==='cloud'?(profile.cloudModel||'muse-spark-1.3-contributor'):selected==='local'?(profile.localModel||profile.modelFile||'Local endpoint'):'Basic tools (no model)',
        cloud:profile.cloudEnabled?'selected':'off', tiers:TIERS.map(t=>t.id), note:'Bounded tool loop · isolated per-profile state' });
      return true;
    }
    if (path === '/capabilities' && req.method === 'GET') { json(res, 200, await capabilities()); return true; }
    if (path === '/agent/models' && req.method === 'GET') {
      const profile = await loadConfig(), { cloudStatus } = await import('./cloud.mjs');
      const { resolveSelection, resolveCloudTarget, resolveLocalTarget } = await import('./model-agent.mjs');
      const cloud = await cloudStatus((await paths()).slot, profile), target = resolveCloudTarget(profile);
      const local = resolveLocalTarget(profile);
      const files = await readdir(join(root,'agent','models')).catch(()=>[]);
      const { chooseContext: pickCtx, hasEnoughMemory: fitsMem } = await import('./localbrain.mjs');
      const freeNow = freemem();
      const installed = await Promise.all(files.filter(f=>/^[\w.-]+\.gguf$/i.test(f)).map(async modelFile=>{
        const info=await stat(join(root,'agent','models',modelFile));
        const fits=fitsMem(info.size, freeNow, pickCtx(info.size, freeNow));
        return {id:'local',modelFile,name:modelFile.replace(/\.gguf$/i,''),available:fits,
          detail:fits?'Installed file · CPU only · loaded on your next ask.':'Not enough free memory for this model.'};
      }));
      json(res, 200, { selected: resolveSelection(profile).selection, selectedFile:(profile.localSource==='file'||local.error)?profile.modelFile||null:null, choices: [
        { id: 'lite', name: 'Basic tools (no model)', available: true, detail: 'Offline navigation and document commands. No model calls.' },
        { id: 'cloud', name: target.model || 'muse-spark-1.3-contributor', available: cloud.hasKey && !target.error,
          detail: target.error || (cloud.hasKey ? 'Contributor API — prompts may be used for training.' : 'Add your API key in Setup first.') },
        ...(!local.error ? [{ id:'local', name:profile.localModel||'Local endpoint', available:true, detail:'Already configured loopback endpoint; no cloud substitution.' }] : []),
        ...installed
      ] }); return true;
    }
    if (path === '/appconfig' && req.method === 'GET') {
      try { json(res, 200, JSON.parse(await readFile(join(vaultRoot, 'app.json'), 'utf8'))); }
      catch { json(res, 200, { showX: false, extraSlots: [] }); }
      return true;
    }
    if (path === '/appconfig' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const patch = JSON.parse(b || '{}');
      let cur = { showX: false, extraSlots: [] };
      try { cur = { ...cur, ...JSON.parse(await readFile(join(vaultRoot, 'app.json'), 'utf8')) }; } catch {}
      const next = { ...cur, ...patch };
      await mkdir(vaultRoot,{recursive:true});
      await writeFile(join(vaultRoot, 'app.json'), JSON.stringify(next, null, 2));
      json(res, 200, next); return true;
    }
    if (path === '/profilex/disclaimer' && req.method === 'GET') {
      const { profileXStatus } = await import('./profilex.mjs');
      const st = await profileXStatus();
      json(res, 200, { disclaimer: st.disclaimer, gated: st.gated, showX: st.showX }); return true;
    }
    if (path === '/profilex/status' && req.method === 'GET') {
      const { profileXStatus } = await import('./profilex.mjs');
      json(res, 200, await profileXStatus()); return true;
    }
    if (path === '/profilex/activate' && req.method === 'POST') {
      const { activateProfileX } = await import('./profilex.mjs');
      json(res, 200, await activateProfileX()); return true;
    }
    if (path === '/slot' && req.method === 'GET') { json(res, 200, { active: await activeSlot() }); return true; }
    if (path === '/slot' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const { slot } = JSON.parse(b || '{}');
      json(res, 200, await setActiveSlot(slot)); return true;
    }
    if (path === '/config' && req.method === 'GET') { json(res, 200, { slot: await activeSlot(), profile: await loadConfig() }); return true; }
    if (path === '/config' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const patch = JSON.parse(b || '{}');
      const slotId = patch.slotId || await activeSlot();
      if (!SLOTS.includes(slotId)) { json(res, 400, { error: 'Unknown profile' }); return true; }
      const update = configQueue.catch(() => {}).then(async () => {
        const cfg = await loadConfig(slotId);
        if (patch.reset === true) {
          await makeSnapshot('before reset', slotId);
          const { rm } = await import('node:fs/promises'), pp = slotPaths(slotId);
          for (const f of await readdir(pp.macros).catch(() => [])) await rm(join(pp.macros, f)).catch(() => {});
          await rm(pp.events, { force: true }).catch(() => {});
          bumpConvEpoch(slotId);
          const fresh = { ...structuredClone(DEFAULT_CONFIG), brain: cfg.brain, tier: cfg.tier, modelFile: cfg.modelFile };
          await saveConfig(fresh, slotId);
          return { ok: true, reset: true, slot: slotId, profile: fresh };
        }
        if (patch.slot && typeof patch.slot === 'object') Object.assign(cfg, patch.slot);
        if (patch.slot && patch.slot.privateMode) bumpConvEpoch(slotId);
        await saveConfig(cfg, slotId);
        return { slot: slotId, profile: cfg };
      });
      configQueue = update;
      json(res, 200, await update); return true;
    }
    if (path === '/snapshots' && req.method === 'GET') { json(res, 200, { snapshots: await listSnapshots() }); return true; }
    if (path === '/snapshots' && req.method === 'POST') {
      let sb = ''; for await (const cc of req) sb += cc;
      let label = 'manual';
      try { const jb = JSON.parse(sb || '{}'); if (jb.label) label = String(jb.label).slice(0, 80); } catch {}
      json(res, 200, await makeSnapshot(label)); return true;
    }
    const snapRestore = path.match(/^\/snapshots\/([\w-]+)\/restore$/);
    if (snapRestore && req.method === 'POST') { json(res, 200, await restoreSnapshot(snapRestore[1])); return true; }
    if (path === '/setup/plan' && req.method === 'GET') { const caps = await capabilities(); json(res, 200, { plan: setupPlan(caps, await loadConfig()), capabilities: caps }); return true; }
    const setupRun = path.match(/^\/setup\/run\/([\w-]+)$/);
    if (setupRun && req.method === 'POST') { json(res, 200, await runSetupStep(setupRun[1])); return true; }
    if (path === '/models' && req.method === 'GET') {
      try { json(res, 200, JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'models.json'), 'utf8'))); }
      catch { json(res, 200, { tiers: [] }); }
      return true;
    }
    if (path === '/notes' && req.method === 'GET') {
      const p = await paths();
      try { json(res, 200, { text: await readFile(join(p.notes, 'scratch.md'), 'utf8') }); }
      catch { json(res, 200, { text: '' }); }
      return true;
    }
    if (path === '/notes' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const { text } = JSON.parse(b || '{}');
      const p = await paths();
      await mkdir(p.notes, { recursive: true });
      await writeFile(join(p.notes, 'scratch.md'), String(text ?? '').slice(0, 20000));
      json(res, 200, { ok: true }); return true;
    }
    if (path === '/browser/prepare' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const { url, actions } = JSON.parse(b || '{}');
      const { prepare } = await import('./browseract.mjs');
      json(res, 200, prepare((await paths()).slot, await loadConfig(), url, actions ?? [{ type: 'goto' }, { type: 'title' }, { type: 'screenshot' }]));
      return true;
    }
    if (path === '/browser/run' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const { token } = JSON.parse(b || '{}');
      const { runPrepared } = await import('./browseract.mjs');
      const out = await runPrepared(token);
      if (out.ok) await recordEvent({ type: 'browser-act', url: out.url, slot: out.slot });
      json(res, 200, out); return true;
    }
    if (path === '/cloud/status' && req.method === 'GET') {
      const { cloudStatus } = await import('./cloud.mjs');
      json(res, 200, await cloudStatus((await paths()).slot, await loadConfig())); return true;
    }
    if (path === '/cloud/key' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const { key } = JSON.parse(b || '{}');
      if (!key || typeof key !== 'string' || key.length < 8) { json(res, 400, { error: 'key looks too short' }); return true; }
      const { storeSecret } = await import('./cloud.mjs');
      json(res, 200, await storeSecret((await paths()).slot, 'cloud-api-key', key.trim())); return true;
    }
    if (path === '/oauth/google/start' && req.method === 'GET') {
      const { googleStart } = await import('./cloud.mjs');
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const redirectUri = `${proto}://${req.headers.host}/api/oauth/google/callback`;
      json(res, 200, googleStart((await paths()).slot, redirectUri)); return true;
    }
    if (path === '/oauth/google/callback' && req.method === 'GET') {
      const { googleCallback } = await import('./cloud.mjs');
      const out = await googleCallback(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><title>Profiles</title><p style="font-family:system-ui;padding:2rem">${out.ok ? 'Google connected for this profile. You can close this tab and go back to Profiles.' : 'Connection failed: ' + out.error}</p>`);
      return true;
    }
    if (path === '/oauth/google/status' && req.method === 'GET') {
      const { googleStatus } = await import('./cloud.mjs');
      json(res, 200, await googleStatus((await paths()).slot)); return true;
    }
    if (path === '/google/push' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const { stagedId } = JSON.parse(b || '{}');
      const { googlePush } = await import('./cloud.mjs');
      json(res, 200, await googlePush((await paths()).slot, stagedId, draftToDocx)); return true;
    }
    const viewMatch = path.match(/^\/browser\/(view|home|click|type|back)$/);
    if (viewMatch && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const body = JSON.parse(b || '{}');
      const slot = (await paths()).slot;
      const ba = await import('./browseract.mjs');
      const fn = { view: () => body.url ? ba.viewGo(slot, body.url) : ba.viewCurrent(slot), home: () => ba.viewHome(slot),
        click: () => ba.viewClick(slot, body.fx, body.fy), type: () => ba.viewType(slot, body.text, body.enter, body.backspace), back: () => ba.viewBack(slot) }[viewMatch[1]];
      json(res, 200, await fn()); return true;
    }
    const shotMatch = path.match(/^\/browser\/shot\/([\w.-]+)$/);
    if (shotMatch && req.method === 'GET') {
      /* stills live on as the fallback/poster behind the stream: if the
         stream drops, the pane shows the last good frame, never a void */
      const slot = (await paths()).slot;
      const file = join(slotPaths(slot).staging, 'browser', shotMatch[1]);
      try { const buf = await readFile(file); res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length }); res.end(buf); }
      catch { json(res, 404, { error: 'no shot yet' }); }
      return true;
    }
    if (path === '/browser/poster' && req.method === 'GET') {
      const slot = (await paths()).slot;
      const file = join(slotPaths(slot).staging, 'browser', `view-${slot}.png`);
      try {
        const buf = await readFile(file);
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length });
        res.end(buf);
      } catch { json(res, 404, { error: 'no frame yet' }); }
      return true;
    }
    const streamMatch = path.match(/^\/browser\/stream$/);
    if (streamMatch && req.method === 'GET') {
      const slot = (await paths()).slot;
      try {
        const { ensureScreencast, stopScreencast } = await import('./browseract.mjs');
        const sess = await ensureScreencast(slot);
        if (!sess || !sess.cdp || !sess.stream) throw new Error('screencast unavailable');
        res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=' + sess.boundary,
          'cache-control': 'no-cache, no-store, max-age=0', connection: 'keep-alive' });
        if (sess.proof) {
          res.write(`--${sess.boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${sess.proof.length}\r\n\r\n`);
          res.write(sess.proof); res.write('\r\n');
        }
        const onData = (chunk) => { try { res.write(chunk); } catch {} };
        sess.stream.on('data', onData);
        res.on('close', () => {
          sess.stream.off('data', onData);
          if (!sess.stream.listenerCount('data')) stopScreencast(slot).catch(()=>{});
        });
        return true;
      } catch (e) { json(res, 503, { error: 'live view unavailable: ' + String(e && e.message || e).slice(0, 140) }); return true; }
    }
    const mouseMatch = path.match(/^\/browser\/mouse$/);
    if (mouseMatch && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const body = JSON.parse(b || '{}');
      const { page } = await (await import('./browseract.mjs')).ensureSession((await paths()).slot);
      const vp = page.viewportSize() || { width: 1280, height: 800 };
      const { mouseAct } = await import('./browseract.mjs');
      json(res, 200, await mouseAct((await paths()).slot, body.kind || 'click', body.fx ?? 0.5, body.fy ?? 0.5, vp.width, vp.height));
      return true;
    }
    const keysMatch = path.match(/^\/browser\/keys$/);
    if (keysMatch && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const body = JSON.parse(b || '{}');
      const { keysAct } = await import('./browseract.mjs');
      json(res, 200, await keysAct((await paths()).slot, body.kind, body.key, body.text));
      return true;
    }
    if (path === '/browser/size' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const body = JSON.parse(b || '{}');
      const { viewSize } = await import('./browseract.mjs');
      json(res, 200, await viewSize((await paths()).slot, body.w, body.h)); return true;
    }
    if (path === '/browser/zoom' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const { viewZoom } = await import('./browseract.mjs');
      json(res, 200, await viewZoom((await paths()).slot, JSON.parse(raw || '{}').zoom)); return true;
    }
    /* Deterministic click target for QA: a full-viewport button. Clicking
       anywhere in the frame flips the title — proves the whole loop
       (frontend mapping -> /mouse -> live session -> render) with zero
       dependence on any external site's layout. */
    if (path === '/test/click-target' && req.method === 'GET') {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>CLICKTEST-READY</title>
        <style>html,body{margin:0;height:100%}#hit{position:fixed;left:0;right:0;top:0;height:45%;width:100%;font-size:64px;cursor:pointer}
        #q{position:fixed;left:0;right:0;top:45%;height:45%;width:100%;font-size:40px;box-sizing:border-box}
        #echo{position:fixed;left:12px;top:92%;font:32px system-ui}</style>
        <script>function go(){document.title='TYPED:'+document.getElementById('q').value;}</script></head><body>
        <button id="hit" onclick="document.title='HIT';document.getElementById('echo').textContent='HIT-'+Date.now()">TAP ANYWHERE</button>
        <input id="q" onkeydown="if(event.key==='Enter')go()" placeholder="type here, Enter submits">
        <div id="echo"></div></body></html>`;
      const buf = Buffer.from(html);
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': buf.length });
      res.end(buf);
      return true;
    }
    if (path === '/browser/state' && req.method === 'GET') {
      try {
        const ba = await import('./browseract.mjs');
        const slot = (await paths()).slot;
        const { hasNative } = await import('./native-browser.mjs');
        if (hasNative(slot)) json(res, 200, await ba.viewCurrent(slot));
        else {
          const { page } = await ba.ensureSession(slot);
          json(res, 200, { ok: true, url: page.url(), title: await page.title().catch(() => ''), frames: ba.getFrameSeq(slot) });
        }
      } catch (e) { json(res, 200, { ok: false, error: String(e && e.message || e).slice(0, 120) }); }
      return true;
    }
    if (path === '/proxy' && (req.method === 'GET' || req.method === 'POST')) {
      try {
        let target = url.searchParams.get('url') || '';
        if (!target && url.searchParams.has('__proxy_target')) {
          target = decodeURIComponent(url.searchParams.get('__proxy_target') || '');
        }
        if (!target && req.headers['referer']) {
          try {
            const refUrl = new URL(req.headers['referer']);
            const refTarget = refUrl.searchParams.get('url') || refUrl.searchParams.get('__proxy_target');
            if (refTarget) target = refTarget;
          } catch {}
        }
        if (!/^https?:\/\//i.test(target)) { json(res, 400, { error: 'url must be http(s)' }); return true; }
        if (req.method === 'GET') {
          try {
            const parsedTarget = new URL(target);
            for (const [k, v] of url.searchParams.entries()) {
              if (k !== 'url' && k !== '__proxy_target' && !parsedTarget.searchParams.has(k)) {
                parsedTarget.searchParams.set(k, v);
              }
            }
            target = parsedTarget.toString();
          } catch {}
        }
        const { fetchUpstream, rewriteHtml } = await import('./proxy.mjs');
        let body = null, ct = '';
        if (req.method === 'POST') {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          body = Buffer.concat(chunks);
          ct = req.headers['content-type'] || '';
        }
        const up = await fetchUpstream(target, (await paths()).slot, req.method, body, ct);
        const ctype = String(up.headers.get?.('content-type') || up.headers['content-type'] || '').toLowerCase();
        if (ctype.includes('text/html')) {
          const html = rewriteHtml(up.body.toString('utf8'), up.url);
          const buf = Buffer.from(html);
          res.writeHead(up.status === 200 ? 200 : up.status, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
          res.end(buf);
        } else {
          const keep = {};
          for (const [k, v] of (up.headers.entries ? up.headers.entries() : Object.entries(up.headers))) {
            if (['content-type', 'content-length'].includes(String(k).toLowerCase())) keep[k] = v;
          }
          keep['cache-control'] = 'no-store';
          res.writeHead(up.status, keep);
          res.end(up.body);
        }
      } catch (e) { json(res, 502, { error: 'proxy failed: ' + String(e && e.message || e).slice(0, 140) }); }
      return true;
    }
    if (path === '/home' && req.method === 'GET') {
      /* Start page with the correct API origin baked in (works under
         http:// dev servers AND tauri:// bundled windows). */
      try {
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const origin = `${proto}://${req.headers.host}`;
        let html = await readFile(join(root, 'src', 'start.html'), 'utf8').catch(() => '');
        if (!html) html = '<!doctype html><body style="background:#14101d;color:#ece4f8;font-family:system-ui"><form method="get" action="__API__/api/proxy"><input name="url" style="width:80%"></form>';
        html = html.split('__API__').join(origin);
        const buf = Buffer.from(html);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
        res.end(buf);
      } catch { json(res, 500, { error: 'home failed' }); }
      return true;
    }
    if (path === '/search' && req.method === 'GET') {
      /* Feeling-lucky first: an obvious destination goes straight there
         (this is what "bbc news" means); anything else gets the clean
         native results list. */
      try {
        const q = (url.searchParams.get('q') || '').slice(0, 200);
        /* When a user queries /search, always perform the web search and show results. */
        const { webSearch } = await import('./browseract.mjs');
        const slot = (await paths()).slot;
        const out = await webSearch(slot, q);
        const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const items = (out.results || []).map((r, i) => `
          <a class="hit" href="/api/proxy?url=${encodeURIComponent(r.href)}">
            <span class="n">${i + 1}</span>
            <div class="meta">
              <b>${esc(r.title)}</b>
              <small>${esc(r.href)}</small>
              <p>${esc(r.snippet)}</p>
            </div>
          </a>`).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(q)} — results</title>
          <style>
          *{box-sizing:border-box}
          body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#101022;color:#f0efff;padding:24px 20px 60px;line-height:1.5}
          .wrap{max-width:960px;margin:0 auto;width:100%}
          .searchform{display:flex;gap:10px;margin-bottom:24px}
          .searchform input{flex:1;font:inherit;font-size:1rem;color:#f0efff;background:#181830;border:1.5px solid #2c2c52;border-radius:12px;padding:12px 16px;min-height:48px}
          .searchform input:focus{border-color:#22d3ee;outline:none}
          .searchform button{font:inherit;font-weight:600;font-size:.9rem;background:#ff3ea5;color:#fff;border:none;border-radius:12px;padding:0 22px;cursor:pointer;min-height:48px}
          h1{font-size:1.15rem;font-weight:700;color:#9d9bd0;margin:0 0 16px}
          .hit{display:flex;gap:14px;text-decoration:none;color:inherit;background:#181830;border:1.5px solid #2c2c52;border-radius:14px;padding:16px 18px;margin-bottom:12px;transition:border-color .2s,background .2s}
          .hit:hover{border-color:#22d3ee;background:#202042}
          .n{color:#22d3ee;font-weight:800;font-size:1.1rem;min-width:24px;line-height:1.3}
          .meta{flex:1;min-width:0}
          .hit b{display:block;font-size:1.05rem;color:#fff;margin-bottom:4px;word-break:break-word}
          .hit small{color:#22d3ee;font-size:.8rem;word-break:break-all;display:block;margin-bottom:6px}
          .hit p{margin:0;font-size:.9rem;color:#cfc6e4;line-height:1.55}
          .empty{color:#9d9bd0;font-size:1rem;padding:30px 0}
          </style></head><body>
          <div class="wrap">
            <form class="searchform" action="/api/search" method="get">
              <input name="q" type="text" value="${esc(q)}" placeholder="Search the web…" autocomplete="off">
              <button type="submit">Search</button>
            </form>
            <h1>Results for &ldquo;${esc(q)}&rdquo;</h1>
            ${items || '<p class="empty">Nothing came back — try different words.</p>'}
          </div>
          </body></html>`;
        const buf = Buffer.from(html);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
        res.end(buf);
      } catch (e) { json(res, 502, { error: 'search failed' }); }
      return true;
    }
    if (path === '/browser/stop' && req.method === 'POST') {
      try { const { stopScreencast } = await import('./browseract.mjs'); await stopScreencast((await paths()).slot); } catch {}
      json(res, 200, { ok: true }); return true;
    }
    if (path === '/learn' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const ev = JSON.parse(b || '{}');
      const profL = await loadConfig();
      if (!profL.privateMode && ev && typeof ev.type === 'string') await recordEvent(ev);
      json(res, 200, { ok: true }); return true;
    }
    if (path === '/preferences' && req.method === 'GET') {
      const prefs = computePreferences(await loadEvents());
      const h = Number(url.searchParams.get('hour') ?? new Date().getHours());
      const bucket = h >= 21 || h < 6 ? 'evening' : h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : 'late-afternoon';
      json(res, 200, { preferences: prefs, suggestion: learnedSuggestion(prefs, bucket, url.searchParams.get('current') ?? ''), bucket });
      return true;
    }
    if (path === '/macros' && req.method === 'GET') { json(res, 200, { macros: await listMacros() }); return true; }
    if (path === '/tools' && req.method === 'GET') { json(res, 200, { tools: toolsForMode(url.searchParams.get('mode') ?? 'lifeful') }); return true; }
    if (path === '/suggest' && req.method === 'GET') {
      json(res, 200, { suggestion: suggestProfile({ hour: Number(url.searchParams.get('hour') ?? 12),
        current: url.searchParams.get('current') ?? 'lifeful', rapidSwitches: Number(url.searchParams.get('rapid') ?? 0),
        device: url.searchParams.get('device') ?? 'desktop' }) });
      return true;
    }
    if (path === '/stage' && req.method === 'GET') { json(res, 200, { staged: await listStaged() }); return true; }
    const exp = path.match(/^\/stage\/([\w-]+)\/export$/);
    if (exp && req.method === 'GET') {
      const draft = (await listStaged()).find((d) => d.id === exp[1]);
      if (!draft) { json(res, 404, { error: 'no such staged draft' }); return true; }
      const format = url.searchParams.get('format') ?? 'md';
      if (format === 'docx') {
        const buf = draftToDocx(draft);
        res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': `attachment; filename="${draft.id}.docx"`, 'content-length': buf.length });
        res.end(buf);
      } else {
        const md = draftToMarkdown(draft);
        res.writeHead(200, { 'content-type': 'text/markdown', 'content-disposition': `attachment; filename="${draft.id}.md"` });
        res.end(md);
      }
      return true;
    }
    if(path==='/doc/source' && req.method==='GET'){
      try{
        const {fetchDocumentSource}=await import('./document-source.mjs');
        const source=await fetchDocumentSource(url.searchParams.get('url')||'');
        const type=source.contentType.split(';')[0].toLowerCase();
        res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="document"',
          'content-length':source.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff',
          'access-control-allow-origin':requestOrigin || `http://${req.headers.host}`,'vary':'Origin',
          'x-profiles-document-type':/^[\w.+/-]+$/.test(type)?type:'application/octet-stream'});
        res.end(source.bytes);
      }catch(error){json(res,error.status||502,{ok:false,error:String(error.message||error)});}
      return true;
    }
    // Editable pasted text is staged separately from binary document viewing.
    if (path === '/doc/stage' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      let body = {};
      try { body = JSON.parse(b || '{}'); } catch { json(res, 400, { error: 'bad json' }); return true; }
      const { makePastedDoc, markdownToHtml } = await import('./staging.mjs');
      const { sanitizeDocHtml } = await import('./proxy.mjs');
      if(body.binary){json(res,415,{ok:false,error:'Binary files belong in the Document reader, not an editable text draft.'});return true;}
      const text = String(body.text || '').slice(0, 60000);
      if (!text.trim()) { json(res, 400, { error: 'nothing to stage — paste text or a link first' }); return true; }
      const fmt = body.format === 'html' || body.format === 'markdown' ? body.format
        : (/<\s*(html|body|h[1-4]|p|ul|ol|div|article|section)[\s>]/.test(text) ? 'html' : 'markdown');
      const title = String(body.title || (body.sourceUrl || '').split('/').filter(Boolean).pop() || 'Pasted document').slice(0, 120);
      const draft = makePastedDoc({ title, markdown: text, sourceUrl: body.sourceUrl || null });
      await saveStage(draft);
      const html = fmt === 'html' ? sanitizeDocHtml(text) : sanitizeDocHtml(markdownToHtml(text));
      json(res, 200, { ok: true, staged: { id: draft.id, title: draft.title, kind: draft.kind }, html });
      return true;
    }
    if (path === '/ask/stream' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { query, mode = 'Vibes', device = 'desktop' } = JSON.parse(body || '{}');
      if (!query || typeof query !== 'string') { json(res, 400, { error: 'query required' }); return true; }
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store',
        'access-control-allow-origin': '*' });
      const send = value => { if (!res.destroyed) res.write(JSON.stringify(value) + '\n'); };
      try {
        const out = await runAsk(query.slice(0, 2000), mode, device, event => send({ type: 'event', event }));
        send({ type: 'result', result: out });
      } catch (error) { send({ type: 'error', error: String(error.message || error) }); }
      res.end(); return true;
    }
    if (path === '/ask' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { query, mode = 'lifeful', device = 'desktop' } = JSON.parse(body || '{}');
      if (!query || typeof query !== 'string') { json(res, 400, { error: 'query required' }); return true; }
      const out = await runAsk(query.slice(0, 500), mode, device);
      if (!out.model) out.model = liteModel();
      json(res, 200, out);
      return true;
    }
  } catch (e) { json(res, 500, { error: String(e?.message ?? e) }); return true; }
  return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PROFILES_AGENT_PORT || 8799);
  createServer(async (req, res) => {
    const requested=new URL(req.url,'http://localhost').searchParams.get('profileSlot');
    if(requested && !SLOTS.includes(requested)){json(res,400,{ok:false,error:'Unknown profile'});return;}
    const slot=requested || await activeSlot();
    if (await withSlot(slot, () => handleAgent(req, res, ''))) return;
    if (await withSlot(slot, () => handleAgent(req, res, '/api'))) return;
    json(res, 404, { error: 'profiles-agent: use /ask /health /tools /stage /suggest' });
  }).listen(port, process.env.PROFILES_BIND || '127.0.0.1', () => console.log(`Profiles agent sidecar → http://localhost:${port}/ (explicit model selection)`));
}
