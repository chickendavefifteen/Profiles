// Meta-profile slots: A and B are DIFFERENT PEOPLE in different apps.
// vault/A/... and vault/B/... - config, ledger, memory, macros, staging,
// snapshots all live per-slot. vault/active-slot.json is just a pointer.
// NOTHING crosses. Switching slot = switching the whole world.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const requestSlot = new AsyncLocalStorage();
export function withSlot(slot, run) { return requestSlot.run(slot, run); }

export const SLOTS = ['A', 'B', 'C', 'D', 'E', 'X'];
const vaultRoot = process.env.PROFILES_VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'vault');
const pointerPath = join(vaultRoot, 'active-slot.json');

export function slotRoot(slot) { return join(vaultRoot, slot); }
export function slotPaths(slot) {
  const r = slotRoot(slot);
  return {
    root: r,
    config: join(r, 'config.json'),
    ledger: join(r, 'tasks', 'ledger.json'),
    memory: join(r, 'memory'),
    events: join(r, 'memory', 'events.jsonl'),
    preferences: join(r, 'memory', 'preferences.json'),
    macros: join(r, 'macros'),
    staging: join(r, 'staging'),
    snapshots: join(r, 'snapshots'),
    notes: join(r, 'notes'),
  };
}
export async function activeSlot() {
  if (requestSlot.getStore()) return requestSlot.getStore();
  try { const p = JSON.parse(await readFile(pointerPath, 'utf8')); return SLOTS.includes(p.active) ? p.active : 'A'; }
  catch { return 'A'; }
}
export async function setActiveSlot(slot) {
  if (!SLOTS.includes(slot)) return { ok: false, error: 'unknown slot' };
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(pointerPath, JSON.stringify({ active: slot, at: new Date().toISOString() }, null, 2));
  await ensureSlot(slot);
  return { ok: true, active: slot };
}
export async function ensureSlot(slot) {
  const p = slotPaths(slot);
  for (const d of [p.root, join(p.root, 'tasks'), p.memory, p.macros, p.staging, join(p.staging, 'scripts'), p.snapshots, p.notes]) {
    await mkdir(d, { recursive: true });
  }
  if (!existsSync(p.ledger)) await writeFile(p.ledger, '[]');
  return p;
}
