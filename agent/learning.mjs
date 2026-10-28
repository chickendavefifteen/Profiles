// Quiet learning - pi-durable style: plain files you own, no telemetry.
// vault/memory/events.jsonl  (append-only: mode stays, asks, dismissals)
// vault/memory/preferences.json (derived, rebuildable any time)
// vault/macros/*.json        (repeated asks become deterministic macros)
// Rules: learn from what the user STAYS with, never nag, suggestions are
// rare, learned, and silenced for 24h on dismiss. Macros replace the
// thinky loop for things asked often ("spin me up a blank slides").
import { readFile, writeFile, appendFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { slotPaths, activeSlot } from './slots.mjs';
async function paths() { return slotPaths(await activeSlot()); }

const norm = (q) => String(q).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function recordEvent(ev) {
  try {
    const p = await paths();
    await mkdir(p.memory, { recursive: true });
    await appendFile(p.events, JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n');
  } catch {}
}

export async function loadEvents() {
  try {
    const p = await paths();
    return (await readFile(p.events, 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** Derive preferences from behaviour: dwell wins, clicks don't talk. */
export function computePreferences(events) {
  const modeByHour = {}, askCounts = {}, dismissals = [];
  for (const e of events) {
    if (e.type === 'mode-stay' && e.mode && e.dwellSec >= 120) {
      const h = new Date(e.at).getHours();
      const bucket = h >= 21 || h < 6 ? 'evening' : h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : 'late-afternoon';
      modeByHour[bucket] = modeByHour[bucket] ?? {};
      modeByHour[bucket][e.mode] = (modeByHour[bucket][e.mode] ?? 0) + e.dwellSec;
    }
    if (e.type === 'ask' && e.query) { const k = norm(e.query); if (k) askCounts[k] = (askCounts[k] ?? 0) + 1; }
    if (e.type === 'suggest-dismissed') dismissals.push(e.at);
  }
  const linkedPanes = {};
  for (const e of events) {
    if (e.type === 'context' && Array.isArray(e.panes)) {
      for (let i = 0; i < e.panes.length; i++) for (let j = i + 1; j < e.panes.length; j++) {
        const k = [e.panes[i], e.panes[j]].sort().join('+');
        linkedPanes[k] = (linkedPanes[k] ?? 0) + 1;
      }
    }
  }
  const linkedGroups = Object.entries(linkedPanes).filter(([, n]) => n >= 3)
    .map(([pair, count]) => ({ panes: pair.split('+'), count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const preferredMode = {};
  for (const [bucket, modes] of Object.entries(modeByHour)) {
    const top = Object.entries(modes).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 600) preferredMode[bucket] = top[0]; // >=10 learned minutes
  }
  const macroCandidates = Object.entries(askCounts).filter(([, n]) => n >= 3)
    .map(([phrase, count]) => ({ phrase, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  return { preferredMode, macroCandidates, linkedGroups, lastDismissal: dismissals[dismissals.length - 1] ?? null, events: events.length };
}

/**
 * The ONLY suggestion logic now: learned preference for this time bucket,
 * with real confidence. No rapid-switch nagging, ever. Returns null a lot.
 */
export function learnedSuggestion(prefs, bucket, currentMode) {
  const want = prefs.preferredMode?.[bucket];
  if (!want || want === currentMode) return null;
  return { to: want, why: `you usually settle into ${want} around now — learned quietly, say the word and I stop suggesting`, requiresUserYes: true, learned: true };
}

export async function savePreferences(prefs) {
  const p = await paths();
  await mkdir(p.memory, { recursive: true });
  await writeFile(p.preferences, JSON.stringify({ ...prefs, derivedAt: new Date().toISOString() }, null, 2));
}

/** Repeated ask -> deterministic macro file (script, not a model loop). */
export async function ensureMacro(phrase, sampleQuery) {
  const macroDir = (await paths()).macros;
  await mkdir(macroDir, { recursive: true });
  const id = norm(phrase).replace(/ /g, '-').slice(0, 40) || 'macro';
  const file = join(macroDir, id + '.json');
  if (!existsSync(file)) {
    await writeFile(file, JSON.stringify({ id, phrase: sampleQuery, created: new Date().toISOString(),
      note: 'Deterministic macro - runs the same steps every time, no LLM loop. Delete this file to unlearn.' }, null, 2));
  }
  return { id, phrase: sampleQuery };
}
export async function listMacros() {
  const macroDir = (await paths()).macros;
  if (!existsSync(macroDir)) return [];
  const out = [];
  for (const f of (await readdir(macroDir)).filter((x) => x.endsWith('.json'))) {
    try { out.push(JSON.parse(await readFile(join(macroDir, f), 'utf8'))); } catch {}
  }
  return out;
}
export { norm };
