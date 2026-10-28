// Local-model brain: llama.cpp one-shot against the GGUF in agent/models/.
// Local only, no network. Bounded: 60s, 220 output tokens, temp low -
// a lite agent, not a bonfire. Falls back (flagged) if anything is off.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './system.mjs';

const agentDir = dirname(fileURLToPath(import.meta.url));

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
export function buildPrompt(template, query, modeLabel) {
  const sys = `You are the Profiles lite agent, running fully locally. Mode: ${modeLabel}. Be helpful, plain-spoken, concise (max ~120 words). Never claim you sent, bought, deleted or published anything.`;
  const q = String(query).slice(0, 800);
  switch (template) {
    case 'chatml': return `<|im_start|>system\n${sys}<|im_end|>\n<|im_start|>user\n${q}<|im_end|>\n<|im_start|>assistant\n`;
    case 'gemma': return `<start_of_turn>user\n${sys}\n\n${q}<end_of_turn>\n<start_of_turn>model\n`;
    case 'lfm': return `<|im_start|>system\n${sys}<|im_end|>\n<|im_start|>user\n${q}<|im_end|>\n<|im_start|>assistant\n`;
    case 'llama3': return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${sys}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${q}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;
    default: return `${sys}\n\nQuestion: ${q}\nAnswer:`;
  }
}
export function extractAnswer(template, stdout) {
  let text = String(stdout).replace(/<\|im_end\|>|<end_of_turn>|<\|eot_id\|>/g, '');
  const seg = text.split(/\nassistant\n/);
  if (seg.length > 1) text = seg[seg.length - 1];
  if (template === 'gemma') { const g = text.split(/\nmodel\n/); if (g.length > 1) text = g[g.length - 1]; }
  if (template === 'llama3') { const l = text.split(/assistant\n/); if (l.length > 1) text = l[l.length - 1]; }
  text = text.replace(/^model\s*\n/, '').replace(/> EOF by user[\s\S]*$/, '').replace(/\[ Prompt:[^\]]*\]/g, '').trim();
  return text;
}

export async function localBrainAnswer(query, modeLabel = 'Life-ful') {
  const slot = await loadConfig();
  const file = slot.modelFile ?? (existsSync(join(agentDir, 'models'))
    ? (await import('node:fs')).readdirSync(join(agentDir, 'models')).find((f) => f.endsWith('.gguf')) : null);
  if (!file) return { ok: false, reason: 'no GGUF in agent/models/' };
  const modelPath = join(agentDir, 'models', file);
  if (!existsSync(modelPath)) return { ok: false, reason: 'model file missing: ' + file };
  const template = templateFor(file);
  const prompt = buildPrompt(template, query, modeLabel);
  return await new Promise((resolve) => {
    const child = spawn('llama-completion', ['-m', modelPath, '-p', prompt, '-n', '220', '--temp', '0.4', '--no-warmup'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ ok: false, reason: 'local model timed out (60s)' }); }, 60000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, reason: 'llama spawn failed: ' + String(e.message).slice(0, 120) }); });
    child.on('close', () => {
      clearTimeout(killer);
      const text = extractAnswer(template, out);
      resolve(text ? { ok: true, text: text.slice(0, 1600), model: file, template } : { ok: false, reason: 'empty model output' });
    });
  });
}
