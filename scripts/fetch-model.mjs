#!/usr/bin/env node
// Deterministic model fetch - the ONLY way Profiles downloads weights.
// Dry-run by default. --yes actually downloads. Checksum printed; sizes
// come from agent/models.json (researched 2026-10-28). No telemetry.
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tier = args[args.indexOf('--tier') + 1] || 'pc-standard';
const yes = args.includes('--yes');
const FILES = {
  'mobile-lite': 'Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'lite-packed': 'LiquidAI/LFM2.5-1.2B-Instruct-GGUF/LFM2.5-1.2B-Instruct-Q4_K_M.gguf',
  'mobile-beefy': 'Qwen/Qwen2.5-3B-Instruct-GGUF/qwen2.5-3b-instruct-q4_k_m.gguf',
  'gemma-e2b': 'unsloth/gemma-3n-E2B-it-GGUF/gemma-3n-E2B-it-Q4_K_M.gguf',
  'gemma-e4b': 'unsloth/gemma-3n-E4B-it-GGUF/gemma-3n-E4B-it-Q4_K_M.gguf',
  'nemotron-4b': 'nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF/NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf',
  'minitron-4b': 'bartowski/Llama-3.1-Minitron-4B-Width-Base-GGUF/Llama-3.1-Minitron-4B-Width-Base-Q4_K_M.gguf',
  'pc-standard': 'Qwen/Qwen2.5-3B-Instruct-GGUF/qwen2.5-3b-instruct-q4_k_m.gguf',
  'pc-beast': 'Qwen/Qwen2.5-7B-Instruct-GGUF/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf',
};
const rel = FILES[tier];
if (!rel) { console.error(`Unknown tier ${tier}. Known: ${Object.keys(FILES).join(', ')} (bundled-tiny/cloud need no download)`); process.exit(2); }
const [repo, file] = [rel.split('/').slice(0, 2).join('/'), rel.split('/').slice(2).join('/')];
const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
const dest = join(root, 'agent', 'models', file.split('/').pop());
console.log(`tier: ${tier}\nfrom: ${url}\nto:   ${dest}`);
if (existsSync(dest)) console.log(`already present (${Math.round(statSync(dest).size / 1e6)} MB) - delete it to re-fetch.`);
if (!yes) { console.log('DRY RUN - rerun with --yes to download. Nothing fetched.'); process.exit(0); }
await mkdir(join(root, 'agent', 'models'), { recursive: true });
const res = await fetch(url);
if (!res.ok) { console.error('download failed: HTTP ' + res.status); process.exit(1); }
const total = Number(res.headers.get('content-length') || 0);
let got = 0; const hash = createHash('sha256');
const out = createWriteStream(dest);
for await (const chunk of res.body) { got += chunk.length; hash.update(chunk); out.write(chunk); if (total) process.stdout.write(`\r${Math.round(got / total * 100)}% (${Math.round(got / 1e6)}/${Math.round(total / 1e6)} MB)   `); }
await new Promise((r) => out.end(r));
console.log(`\ndone. sha256 ${hash.digest('hex')}\nNext: say "help me get a better agent plugged in" in Profiles and tap wire-brain, or set brain=local-model. Fully local from here.`);
