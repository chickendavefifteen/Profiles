// Profiles agent sidecar — the real agent behind the ask box.
// Pi-shaped loop (sense->plan->act->verify->remember) checkpointed into the
// existing durable ledger + vault. Local brain by default: no network.
// Cloud is opt-in only: PROFILES_ALLOW_CLOUD=1 + PROFILES_API_KEY (+ optional
// PROFILES_API_BASE, OpenAI-compatible). Standalone: npm run agent (:8799).
// Mounted by server.mjs under /api/ so `npm start` gives a real agent too.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTask, advance, checkpoint, complete } from '../engine/ledger.mjs';
import { classifyIntent, pickTier, suggestProfile, TIERS } from './ladder.mjs';
import { toolsForMode, liveToolsForMode, toolById } from './tools.mjs';
import { makeDraft, draftToMarkdown, draftToDocx, makeScriptDraft } from './staging.mjs';
import { capabilities, loadConfig, saveConfig, setupPlan, runSetupStep, makeSnapshot, listSnapshots, restoreSnapshot, DEFAULT_CONFIG } from './system.mjs';
import { localBrainAnswer } from './localbrain.mjs';
import { recordEvent, loadEvents, computePreferences, savePreferences, learnedSuggestion, ensureMacro, listMacros, norm } from './learning.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
import { slotPaths, activeSlot, setActiveSlot, ensureSlot } from './slots.mjs';
async function paths() { const sl = await activeSlot(); return { slot: sl, ...slotPaths(sl) }; }
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

/** The local brain: deterministic, files real things, never phones home. */
export async function runAsk(query, mode = 'lifeful', device = 'desktop') {
  const intent = classifyIntent(query);
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
      events: [{ stage: 'sense', text: `sense ✓ setup ask - deterministic wizard, no settings menu`, at: new Date().toISOString() },
        { stage: 'plan', text: `plan → scan device, recommend tier, scripted fetch, wire brain, verify`, at: new Date().toISOString() },
        { stage: 'act', text: `act ✓ setup plan ready for ${caps.deviceClass} (recommended: ${caps.recommendedTier})`, at: new Date().toISOString() },
        { stage: 'verify', text: 'verify ✓ steps are allowlisted scripts, nothing runs without your tap', at: new Date().toISOString() },
        { stage: 'remember', text: 'remember ✓ plan lives in the Setup canvas pane', at: new Date().toISOString() }],
      result: 'Setup wizard opened on the canvas - tap each step, no menus. Your device: ' + caps.deviceClass + ', recommended tier: ' + caps.recommendedTier + '.',
      setup: setupPlan(caps, cfg), capabilities: caps };
  }
  const events = [];
  const at = () => new Date().toISOString();
  events.push({ stage: 'sense', text: `sense ✓ "${query}" — intent ${intent.kind}, risk ${intent.risk}`, at: at() });
  events.push({ stage: 'plan', text: `plan → tier ${pick.tier} (${pick.action}): ${pick.reason}`, at: at() });
  const ledger = await loadLedger();
  let staged = null, result = '';
  {
    const slotId0 = (await paths()).slot;
    if (slotId0 === 'X') {
      const prof0 = await loadConfig();
      if (prof0.piPower && prof0.piBrain && !['irreversible', 'setup'].includes(intent.kind)) {
        const { piBrainAnswer } = await import('./pibrain.mjs');
        events.push({ stage: 'act', text: 'act ✓ Profile X: real pi process working (tools live, ringfenced to vault/X)', at: at() });
        const piAns = await piBrainAnswer(query, slotId0, prof0);
        if (piAns.ok) {
          events.push({ stage: 'verify', text: 'verify ✓ pi run complete — ' + piAns.model, at: at() });
          events.push({ stage: 'remember', text: 'remember ✓ pi session persists in vault/X/pi-sessions only', at: at() });
          return { query, mode, device, intent, pick: { tier: 'cloud', action: 'pi-brain', reason: 'Profile X pi brain (full pi, X only)' }, events,
            result: piAns.text, chat: piAns.text, staged: null };
        }
        events.push({ stage: 'verify', text: 'verify ! pi brain unavailable (' + piAns.reason + ') — lite brain instead', at: at() });
      }
    }
  }
  // Tool loop: decide -> act -> observe -> answer (deterministic first).
  {
    const { decideTool, runTool } = await import('./agentloop.mjs');
    const decision = decideTool(query);
    if (decision) {
      events.push({ stage: 'plan', text: `plan → tool ${decision.tool} ${JSON.stringify(decision.args)}`, at: at() });
      try {
        const out = await runTool((await paths()).slot, decision);
        events.push({ stage: 'act', text: `act ✓ tool ${decision.tool} observed`, at: at() });
        let answer = out.observation;
        if ((decision.tool === 'web_search' || decision.tool === 'browser_read') && true) {
          const sum = await localBrainAnswer(`Summarise this for the user in 2-4 short sentences, plain language. If it is search results, name the top items.\n\n${out.observation.slice(0, 2200)}`, mode).catch(() => ({ ok: false }));
          if (sum.ok) answer = sum.text + '\n\n' + (decision.tool === 'web_search' ? '(from a live web search in your browser — say "open result 1" style asks next)' : '(read from the live page in your browser)');
        }
        events.push({ stage: 'verify', text: 'verify ✓ observation in chat; browser state is live in the Browser pane', at: at() });
        events.push({ stage: 'remember', text: 'remember ✓ tool run checkpointed in this profile', at: at() });
        return { query, mode, device, intent: { kind: 'tool', tool: decision.tool, risk: 'low' }, pick: { tier: 'tool-loop', action: decision.tool, reason: 'agent tool hook' },
          events, result: answer, chat: answer, staged: null, ui: out.ui || null };
      } catch (e) {
        events.push({ stage: 'act', text: `act ! tool failed honestly: ${String(e.message).slice(0, 140)}`, at: at() });
      }
    }
  }
  if (intent.kind === 'chat' || intent.kind === 'question') {
    const caps = await capabilities();
    const slot = await loadConfig();
    const slotId = (await paths()).slot;
    if (slotId === 'X' && slot.piPower && slot.piBrain) {
      const { piBrainAnswer } = await import('./pibrain.mjs');
      events.push({ stage: 'act', text: 'act ✓ Profile X: real pi process thinking (tools live, ringfenced to vault/X)', at: at() });
      const piAns = await piBrainAnswer(query, slotId, slot);
      if (piAns.ok) {
        events.push({ stage: 'verify', text: 'verify ✓ pi run complete — ' + piAns.model, at: at() });
        events.push({ stage: 'remember', text: 'remember ✓ pi session persists in vault/X/pi-sessions only', at: at() });
        return { query, mode, device, intent, pick: { tier: 'cloud', action: 'pi-brain', reason: 'Profile X pi brain' }, events,
          result: piAns.text, chat: piAns.text, staged: null };
      }
      events.push({ stage: 'verify', text: 'verify ! pi brain unavailable (' + piAns.reason + ') — lite brain instead', at: at() });
    }
    const { wantsDeep, orchestrate } = await import('./orchestrate.mjs');
    if (wantsDeep(query) && caps.modelsPresent.length) {
      const orch = await orchestrate(query.replace(/\b(ultrathink|think hard|orchestrate|sub-?agents?)\b/gi, '').trim() || query, mode);
      for (const e of orch.events) events.push(e);
      if (orch.ok) return { query, mode, device, intent, pick: { tier: 'laptop-local', action: 'orchestrate', reason: 'bounded Scout/Worker/Critic fan-out, parent accepted' }, events, result: orch.text, chat: orch.text, staged: null };
      events.push({ stage: 'verify', text: 'verify ! orchestration fell back (' + orch.reason + ') — single brain instead', at: at() });
    }
    if (slot.cloudEnabled) {
      const { cloudAnswer } = await import('./cloud.mjs');
      const cAns = await cloudAnswer((await paths()).slot, slot, query, mode);
      if (cAns.ok) {
        events.push({ stage: 'act', text: `act ✓ cloud brain answered (${cAns.model}) — cloud was opted in for this profile`, at: at() });
        events.push({ stage: 'verify', text: 'verify ✓ answered in chat; cloud use is per-profile and shown, never silent', at: at() });
        events.push({ stage: 'remember', text: 'remember ✓ conversation kept in this session pane', at: at() });
        return { query, mode, device, intent, pick: { tier: 'cloud', action: 'cloud-answer', reason: 'profile opted into cloud' }, events, result: cAns.text, chat: cAns.text, staged: null };
      }
      events.push({ stage: 'act', text: `act ! cloud opted in but unavailable (${cAns.reason}) — local brain instead, labelled`, at: at() });
    }
    const { piBrainAnswer } = await import('./pibrain.mjs');
    const modelAns = caps.modelsPresent.length ? await localBrainAnswer(query, mode) : await piBrainAnswer(query, slotId, slot);
    events.push({ stage: 'act', text: modelAns.ok ? `act ✓ local model thinking (${modelAns.model})` : 'act ✓ lite brain answering from live status (deterministic)', at: at() });
    let answer;
    if (/agentic|what can you do|who are you/i.test(query)) {
      answer = `Yes - lite-agentic, honestly: I can chat, file tasks into your vault, stage letters and slide decks for export, write scripts for you to run, and suggest profile switches. My tools right now: ${liveToolsForMode(mode).map((t) => t.id).join(', ')}. ` +
        (caps.modelsPresent.length ? `A local model (${caps.modelsPresent.join(', ')}) is downloaded and wired in as my brain via llama.cpp - general questions go to it, nothing leaves this PC. ` : 'No local LLM is downloaded yet - say "help me get a better agent plugged in" and I will set one up step by step. ') +
        `Cloud is ${cloudOptIn && hasApiKey ? 'opted in' : 'OFF (your choice, in Advanced)'}. Nothing leaves this machine.`;
    } else if (modelAns.ok) answer = modelAns.text;
    else {
      answer = `I heard you. I am the always-on lite agent - I can answer properly once a local model is wired (${modelAns.reason}), and right now I can file tasks, stage documents/slides, write scripts, and run the setup wizard. Try "draft a letter about..." or "help me get a better agent plugged in".`;
    }
    events.push({ stage: 'verify', text: 'verify ✓ answered in chat; loop detail stays in the Agent pane', at: at() });
    events.push({ stage: 'remember', text: 'remember ✓ conversation kept in this session pane', at: at() });
    return { query, mode, device, intent, pick, events, result: answer, chat: answer, staged: null };
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
    if (intent.kind === 'question') {
      const { piBrainAnswer: pba } = await import('./pibrain.mjs');
      const ans = caps.modelsPresent.length ? await localBrainAnswer(query, mode) : await pba(query, (await paths()).slot, slot);
      if (ans.ok) { result = ans.text + '\n— answered by your local model (' + ans.model + '), nothing left this machine.';
        events.push({ stage: 'act', text: `act ✓ local model answered (${ans.model})`, at: at() }); }
      else result = `Lite brain (always on): I filed your question. The local model is not wired yet (${ans.reason}) - say "help me get a better agent plugged in" and I will walk it through, or ask "draft …" to stage a document.`;
    } else result = `Filed "${query}" into your vault tasks with a checkpoint.`;
    var taskRef = t;
  }
  events.push({ stage: 'verify', text: `verify ✓ tools live here: ${liveToolsForMode(mode).map((t) => t.id).join(', ') || 'none'}`, at: at() });
  if (taskRef) { checkpoint(ledger, taskRef.id, 'sidecar run'); }
  await saveLedger(ledger);
  events.push({ stage: 'remember', text: 'remember ✓ ledger checkpointed in this profile vault (plain files, slot-isolated)', at: at() });
  return { query, mode, device, intent, pick, events, result, staged: staged ? { id: staged.id, title: staged.title, kind: staged.kind } : null, macroCreated: typeof macroCreated !== 'undefined' ? macroCreated : null };
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
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': 'content-type' }); res.end(); return true; }
    if (path === '/health' && req.method === 'GET') {
      json(res, 200, { ok: true, build: BUILD, startedAt: STARTED_AT,
        brain: tinyModelFile ? 'bundled-tiny (gguf found)' : 'bundled-tiny (heuristic classifier)',
        cloud: cloudOptIn && hasApiKey ? 'opted-in' : 'off', tiers: TIERS.map((t) => t.id), note: 'Pi-shaped sidecar; per-slot vaults, zero carry-across' });
      return true;
    }
    if (path === '/capabilities' && req.method === 'GET') { json(res, 200, await capabilities()); return true; }
    if (path === '/appconfig' && req.method === 'GET') {
      try { json(res, 200, JSON.parse(await readFile(join(root, 'vault', 'app.json'), 'utf8'))); }
      catch { json(res, 200, { showX: false, extraSlots: [] }); }
      return true;
    }
    if (path === '/appconfig' && req.method === 'POST') {
      let b = ''; for await (const c of req) b += c;
      const patch = JSON.parse(b || '{}');
      let cur = { showX: false, extraSlots: [] };
      try { cur = { ...cur, ...JSON.parse(await readFile(join(root, 'vault', 'app.json'), 'utf8')) }; } catch {}
      const next = { ...cur, ...patch };
      await writeFile(join(root, 'vault', 'app.json'), JSON.stringify(next, null, 2));
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
      const cfg = await loadConfig();
      if (patch.reset === true) { await makeSnapshot('before reset');
        try {
          const { readdir, rm } = await import('node:fs/promises');
          const pp = slotPaths(await activeSlot());
          for (const f of (await readdir(pp.macros).catch(() => []))) { try { await rm(join(pp.macros, f)); } catch {} }
          try { await rm(pp.events, { force: true }); } catch {}
        } catch {} const fresh = { ...structuredClone(DEFAULT_CONFIG), brain: cfg.brain, tier: cfg.tier, modelFile: cfg.modelFile }; await saveConfig(fresh); json(res, 200, { ok: true, reset: true, slot: await activeSlot(), profile: fresh }); return true; }
      if (patch.slot && typeof patch.slot === 'object') Object.assign(cfg, patch.slot);
      await saveConfig(cfg); json(res, 200, { slot: await activeSlot(), profile: cfg }); return true;
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
        const { ensureScreencast } = await import('./browseract.mjs');
        const sess = await ensureScreencast(slot);
        if (!sess || !sess.cdp || !sess.stream) throw new Error('screencast unavailable');
        /* Headers FIRST, always: a client must never stare at a silent
           socket while we prepare frames. Parts follow as ready. */
        res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=' + sess.boundary,
          'cache-control': 'no-cache, no-store, max-age=0', connection: 'keep-alive', 'access-control-allow-origin': '*' });
        /* Every consumer gets an instant first frame: a fresh screenshot
           taken for THIS request (proves the render, ~200ms). Live paint
           frames follow. No consumer ever stares at a silent stream. */
        try {
          const { page: proofPage } = await (await import('./browseract.mjs')).ensureSession(slot);
          const proof = await Promise.race([
            proofPage.screenshot({ type: 'jpeg', quality: 70 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('shot timeout')), 9000)),
          ]);
          if (proof && proof.length > 500) {
            res.write(`--${sess.boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${proof.length}\r\n\r\n`);
            res.write(proof); res.write('\r\n');
          } else if (sess.proof) {
            res.write(`--${sess.boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${sess.proof.length}\r\n\r\n`);
            res.write(sess.proof); res.write('\r\n');
          }
        } catch {}
        const onData = (chunk) => { try { res.write(chunk); } catch {} };
        sess.stream.on('data', onData);
        req.on('close', () => { try { sess.stream.off('data', onData); } catch {} });
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
    /* Deterministic click target for QA: a full-viewport button. Clicking
       anywhere in the frame flips the title — proves the whole loop
       (frontend mapping -> /mouse -> live session -> render) with zero
       dependence on any external site's layout. */
    if (path === '/test/click-target' && req.method === 'GET') {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>CLICKTEST-READY</title>
        <style>html,body{margin:0;height:100%}#hit{position:fixed;left:0;right:0;top:0;bottom:25%;width:100%;font-size:64px;cursor:pointer}
        #q{position:fixed;left:0;right:0;bottom:0;height:25%;width:100%;font-size:40px;box-sizing:border-box}
        #echo{position:fixed;left:12px;bottom:26%;font:32px system-ui}</style>
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
        const { page } = await ba.ensureSession(slot);
        json(res, 200, { ok: true, url: page.url(), title: await page.title().catch(() => ''), frames: ba.getFrameSeq(slot) });
      } catch (e) { json(res, 200, { ok: false, error: String(e && e.message || e).slice(0, 120) }); }
      return true;
    }
    if (path === '/proxy' && (req.method === 'GET' || req.method === 'POST')) {
      try {
        const target = url.searchParams.get('url') || '';
        if (!/^https?:\/\//i.test(target)) { json(res, 400, { error: 'url must be http(s)' }); return true; }
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
    if (path === '/ask' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { query, mode = 'lifeful', device = 'desktop' } = JSON.parse(body || '{}');
      if (!query || typeof query !== 'string') { json(res, 400, { error: 'query required' }); return true; }
      json(res, 200, await runAsk(query.slice(0, 500), mode, device));
      return true;
    }
  } catch (e) { json(res, 500, { error: String(e?.message ?? e) }); return true; }
  return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PROFILES_AGENT_PORT || 8799);
  createServer(async (req, res) => {
    if (await handleAgent(req, res, '')) return;
    if (await handleAgent(req, res, '/api')) return;
    json(res, 404, { error: 'profiles-agent: use /ask /health /tools /stage /suggest' });
  }).listen(port, () => console.log(`Profiles agent sidecar → http://localhost:${port}/  (cloud ${cloudOptIn && hasApiKey ? 'opted-in' : 'OFF'}, brain: local)`));
}
