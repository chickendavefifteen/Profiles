// Deterministic system layer: capabilities, meta-profile config,
// snapshots/rollback, and the scripted "get me a better agent" setup.
// NO LLM anywhere here - same input, same steps, every time. Allowlisted
// actions only; nothing here runs arbitrary shell.
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const run = promisify(execFile);
const agentDir = dirname(fileURLToPath(import.meta.url));
const root = join(agentDir, '..');
import { slotPaths, activeSlot, ensureSlot } from './slots.mjs';

export const DEFAULT_CONFIG = { name: '', buddy: 'person', metaMode: 'lifeful', guided: true, kids: false,
  advanced: false, brain: 'lite', voiceOut: false, intensity: 'full', tier: null, modelFile: null, updated: null };

const X_DEFAULTS = { buddy: 'person', metaMode: 'lifeful', advanced: true, guided: false, intensity: 'overdrive',
  piPower: true, note: 'Profile X: ringfenced power profile - extensible pi + durable, full access where the platform allows. Advised brain: PC-standard tier or better.' };
export async function loadConfig(slot) {
  const sl = slot ?? await activeSlot();
  const p = slotPaths(sl);
  const base = sl === 'X' ? { ...structuredClone(DEFAULT_CONFIG), ...X_DEFAULTS } : structuredClone(DEFAULT_CONFIG);
  try { return { ...base, ...JSON.parse(await readFile(p.config, 'utf8')) }; }
  catch { return base; }
}
export async function saveConfig(cfg, slot) {
  const p = await ensureSlot(slot ?? await activeSlot());
  cfg.updated = new Date().toISOString();
  await writeFile(p.config, JSON.stringify(cfg, null, 2));
  return cfg;
}

export async function capabilities() {
  let gpu = [];
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeout: 4000 });
    gpu = stdout.trim().split('\n').filter(Boolean).map((l) => { const [name, mem] = l.split(', '); return { name: name.trim(), vramMB: parseInt(mem) || 0 }; });
  } catch {}
  const vramMB = gpu.reduce((a, g) => a + g.vramMB, 0);
  const ramGB = Math.round(os.totalmem() / 1e9);
  const modelFiles = existsSync(join(agentDir, 'models'))
    ? (await readdir(join(agentDir, 'models'))).filter((f) => f.endsWith('.gguf')) : [];
  let llama = false;
  try { await run('llama-cli', ['--version'], { timeout: 4000 }); llama = true; } catch {}
  const recommended = vramMB >= 12000 || ramGB >= 32 ? 'pc-standard'
    : ramGB >= 8 ? 'mobile-beefy' : ramGB >= 4 ? 'mobile-lite' : 'bundled-tiny';
  return { platform: process.platform, arch: process.arch, cpus: os.cpus().length, ramGB, gpu, vramMB,
    llamaCpp: llama, modelsPresent: modelFiles, recommendedTier: recommended,
    deviceClass: vramMB >= 12000 ? 'beast-pc' : ramGB >= 16 ? 'pc' : ramGB >= 6 ? 'phone-or-small-laptop' : 'tiny-laptop' };
}

/** Deterministic setup plan - the anti-settings-menu. Steps are data. */
export function setupPlan(caps, slot) {
  return [
    { id: 'scan', label: 'Scan this device (CPU, RAM, GPU)', action: 'capabilities', done: !!caps },
    { id: 'pick-tier', label: `Pick model tier for this device (recommended: ${caps?.recommendedTier ?? 'bundled-tiny'})`, action: 'recommend', done: !!slot.tier },
    { id: 'fetch-model', label: 'Fetch the model file (scripted download, checksumed, only when you say go)', action: 'fetch-script', done: (caps?.modelsPresent ?? []).length > 0 },
    { id: 'wire-brain', label: 'Wire it as my lite brain (llama.cpp, local, no network after download)', action: 'write-config', done: slot.brain === 'local-model' },
    { id: 'verify', label: 'Verify: ask the lite brain one real question', action: 'verify', done: false },
    { id: 'cloud-optional', label: 'Optional: plug in a bigger brain (API key / OAuth login) - skipped unless you ask', action: 'note', done: slot.brain === 'cloud' },
  ];
}

/** Execute ONE allowlisted setup step. Never arbitrary commands. */
export async function runSetupStep(id) {
  const caps = await capabilities();
  const slot = await loadConfig();
  switch (id) {
    case 'scan': return { ok: true, capabilities: caps };
    case 'pick-tier': slot.tier = caps.recommendedTier; await saveConfig(slot); return { ok: true, tier: slot.tier };
    case 'fetch-script': {
      await mkdir(join(root, 'scripts'), { recursive: true });
      const script = join(root, 'scripts', 'fetch-model.mjs');
      return { ok: true, stagedScript: 'scripts/fetch-model.mjs', note: 'Run it yourself: node scripts/fetch-model.mjs --tier ' + (slot.tier ?? caps.recommendedTier) + ' --yes  (deterministic, checksumed, resumable-by-rerun)' };
    }
    case 'wire-brain': {
      if (!caps.modelsPresent.length) return { ok: false, error: 'no model file in agent/models/ yet - run the fetch step first' };
      slot.brain = 'local-model'; slot.modelFile = caps.modelsPresent[0];
      await saveConfig(slot);
      return { ok: true, brain: 'local-model', modelFile: slot.modelFile };
    }
    case 'verify': return { ok: true, note: 'Now ask anything in the box - if the local brain is wired, the answer is signed (local model).' };
    case 'cloud-optional': return { ok: true, note: 'Cloud stays OFF until you set PROFILES_ALLOW_CLOUD=1 + a key, or add an OAuth login. Nothing to click here.' };
    default: return { ok: false, error: 'unknown step (allowlist only)' };
  }
}

/* ---- snapshots: easy unstitch / rollback / debug ---- */
export async function makeSnapshot(label = 'manual', slot) {
  const p = await ensureSlot(slot ?? await activeSlot());
  const snapDir = p.snapshots;
  await mkdir(snapDir, { recursive: true });
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(snapDir, id);
  await mkdir(dir, { recursive: true });
  for (const f of ['config.json', join('tasks', 'ledger.json')]) {
    const src = join(p.root, f);
    if (existsSync(src)) await copyFile(src, join(dir, f.replace(/\//g, '_')));
  }
  await writeFile(join(dir, 'LABEL'), `${label}\n${new Date().toISOString()}\n`);
  return { id, label };
}
export async function listSnapshots(slot) {
  const snapDir = slotPaths(slot ?? await activeSlot()).snapshots;
  if (!existsSync(snapDir)) return [];
  const out = [];
  for (const id of (await readdir(snapDir)).sort().reverse()) {
    let label = ''; try { label = (await readFile(join(snapDir, id, 'LABEL'), 'utf8')).split('\n')[0]; } catch {}
    out.push({ id, label });
  }
  return out;
}
export async function restoreSnapshot(id, slot) {
  const sl = slot ?? await activeSlot();
  const p = await ensureSlot(sl);
  const dir = join(p.snapshots, id);
  if (!existsSync(dir)) return { ok: false, error: 'no such snapshot' };
  await makeSnapshot('pre-restore safety', sl);
  const cfgFile = join(dir, 'config.json');
  if (existsSync(cfgFile)) await copyFile(cfgFile, p.config);
  const ledFile = join(dir, 'tasks_ledger.json');
  if (existsSync(ledFile)) await copyFile(ledFile, p.ledger);
  return { ok: true, restored: id };
}
