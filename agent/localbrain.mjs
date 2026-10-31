// Local-model brain: llama.cpp one-shot against the GGUF in agent/models/.
// Local only, no network. Bounded: 60s, 256-512 output tokens (2048 ctx on
// low-free hosts, else 4096), temp low - a lite agent, not a bonfire.
// Falls back (flagged) if anything is off.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { freemem } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './system.mjs';

const agentDir = dirname(fileURLToPath(import.meta.url));
import { readdirSync } from 'node:fs';
/* Always-on guarantee: every profile answers with SOME local model.
   Preference order is deliberate: configured (retained per slot) >
   PC-standard 2-3B > lite 1.2B > anything present. Never alphabetical —
   that once would have defaulted everyone to the 4.5GB Gemma. */
export function pickDefaultModel() {
  let files = [];
  try { files = readdirSync(join(agentDir, 'models')).filter((f) => f.endsWith('.gguf')); } catch { return null; }
  const pref = ['qwen2.5-3b', 'lfm2.5-1.2b', 'qwen2.5-0.5b', 'nemotron', 'gemma'];
  for (const p of pref) { const hit = files.find((f) => f.toLowerCase().includes(p)); if (hit) return hit; }
  return files[0] ?? null;
}

/* Per-model prompt templates - a GGUF is not its chat format. Wrong
   template = empty/garbled answers (found the hard way with LFM +
   Nemotron). Registry by filename; unknown models fall back to plain. */
export function templateFor(file) {
  const f = String(file || '').toLowerCase();
  if (f.includes('qwen')) return 'chatml';
  if (f.includes('gemma')) return 'gemma';
  if (f.includes('lfm')) return 'lfm';
  if (f.includes('nemotron') || f.includes('minitron') || f.includes('llama')) return 'llama3';
  return 'plain';
}
export function buildPrompt(template, query, modeLabel, instructions, history = []) {
  const sys = instructions || `You are the Profiles agent, running fully locally. Mode: ${modeLabel}. Be helpful, plain-spoken, concise (max ~120 words). Never claim you sent, bought, deleted or published anything.`;
  const messages=history.concat({role:'user',content:String(query).slice(0,6000)});
  switch(template){
    case 'chatml':
    case 'lfm':
      return `<|im_start|>system\n${sys}<|im_end|>\n`
        +messages.map(m=>`<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('')
        +'<|im_start|>assistant\n';
    case 'gemma':
      return messages.map((m,i)=>`<start_of_turn>${m.role==='assistant'?'model':'user'}\n${i===0?sys+'\n\n':''}${m.content}<end_of_turn>\n`).join('')+'<start_of_turn>model\n';
    case 'llama3':
      return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${sys}<|eot_id|>`
        +messages.map(m=>`<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`).join('')
        +'<|start_header_id|>assistant<|end_header_id|>\n\n';
    default:
      return sys+'\n\n'+messages.map(m=>m.role+': '+m.content).join('\n\n')+'\nAnswer:';
  }
}
export function extractAnswer(template, stdout) {
  let text = String(stdout).replace(/<\|im_end\|>|<end_of_turn>|<\|eot_id\|>/g, '');
  const seg = text.split(/\nassistant\n/);
  if (seg.length > 1) text = seg[seg.length - 1];
  if (template === 'gemma') { const g = text.split(/\nmodel\n/); if (g.length > 1) text = g[g.length - 1]; }
  if (template === 'llama3') { const l = text.split(/assistant\n/); if (l.length > 1) text = l[l.length - 1]; }
  text = text.replace(/^model\s*\n/, '').replace(/> EOF by user[\s\S]*$/, '').replace(/\[ Prompt:[^\]]*\]/g, '').replace(/\s*\[end of text\]\s*$/, '').trim();
  return text;
}

/* Conservative CPU memory budget (shared helper): file bytes + >=1GB
   reserve for runtime/KV at 4096 context. Low-free hosts drop to 2048
   context instead of OOMing. No physical-device claim — this is an
   arithmetic gate on current freemem, not a tested-device badge. */
export const LOCAL_RESERVE_BYTES = 1024 * 1024 * 1024;
export function estimateMemoryBytes(fileSizeBytes, ctx = 4096) {
  const size = Number(fileSizeBytes) || 0;
  const context = Number(ctx) === 2048 ? 2048 : 4096;
  return size + LOCAL_RESERVE_BYTES + (context === 4096 ? 256 * 1024 * 1024 : 0);
}
export function chooseContext(fileSizeBytes, freeBytes) {
  const free = Number(freeBytes) || 0;
  // Need file + reserve with headroom; otherwise halve the context.
  if (free < Number(fileSizeBytes) + LOCAL_RESERVE_BYTES + 512 * 1024 * 1024) return 2048;
  return 4096;
}
export function hasEnoughMemory(fileSizeBytes, freeBytes, ctx = 4096) {
  return Number(freeBytes) > estimateMemoryBytes(fileSizeBytes, ctx);
}

export async function localBrainAnswer(query, modeLabel = 'Life-ful', options = {}) {
  const slot = await loadConfig(options.slot);
  const file = options.modelFile || slot.modelFile || pickDefaultModel();
  if (!file) return { ok: false, reason: 'no GGUF in agent/models/' };
  if (file !== file.split(/[\\/]/).pop() || !file.endsWith('.gguf')) return { ok: false, reason: 'invalid model filename' };
  const modelPath = join(agentDir, 'models', file);
  if (!existsSync(modelPath)) return { ok: false, reason: 'model file missing: ' + file };
  let fileSize = 0;
  try { fileSize = statSync(modelPath).size; } catch {}
  const ctx = chooseContext(fileSize, freemem());
  if (!hasEnoughMemory(fileSize, freemem(), ctx)) return { ok: false, reason: 'Not enough free RAM for this model. Choose a smaller installed model or your API model.' };
  const template = templateFor(file);
  const prompt = buildPrompt(template, query, modeLabel, options.instructions, options.history);
  return await new Promise((resolve) => {
    const outTokens = ctx === 2048 ? 256 : 512;
    const args = ['-m', modelPath, '-p', prompt, '-n', String(outTokens), '-c', String(ctx), '-t', '2',
      '--temp', '0.2', '--no-warmup', '--no-display-prompt', '--no-conversation', '--offline',
      '--device', 'none', '-ngl', '0', '--no-op-offload'];
    if (options.schema) args.push('--json-schema', JSON.stringify(options.schema));
    const child = spawn('llama-completion', args, { stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, CUDA_VISIBLE_DEVICES: '', GGML_VK_VISIBLE_DEVICES: '' } });
    let out = '';
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ ok: false, reason: 'local model timed out (60s)' }); }, 60000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, reason: 'llama spawn failed: ' + String(e.message).slice(0, 120) }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      const text = extractAnswer(template, out);
      resolve(code === 0 && text ? { ok: true, text: text.slice(0, 6000), model: file, template } : { ok: false, reason: code ? 'local runtime exited with code ' + code : 'empty model output' });
    });
  });
}
