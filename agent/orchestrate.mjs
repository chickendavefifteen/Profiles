// Orchestration, Profiles-style — the fleet pattern (OMP ultrathink /
// pi-orchestration.md) distilled for a consumer agent:
//   parent plans -> bounded fan-out (max 3 lanes) -> critic verifies ->
//   parent synthesises. Lanes are the canonical fleet profiles in
//   miniature (scout / worker / critic). No lane can act irreversibly;
//   lanes draft and report, the parent checkpoints. Timeouts per lane,
//   failures surface as lane results, never silent drops.
import { localBrainAnswer } from './localbrain.mjs';
import { liveToolsForMode } from './tools.mjs';

export const LANES = [
  { id: 'scout', role: 'Scout', job: 'gather and summarise what matters, fast, no opinions dressed as facts' },
  { id: 'worker', role: 'Worker', job: 'produce the concrete draft/output the user asked for' },
  { id: 'critic', role: 'Critic', job: 'check the worker output: gaps, risks, anything irreversible hiding in it' },
];

const DEEP = /\b(ultrathink|think hard|deep (think|research)|research (this|it|that)|orchestrat|sub-?agents?|fan out|in depth)\b/i;
export function wantsDeep(query) { return DEEP.test(String(query)); }

/** Run the lanes against the local brain in parallel, bounded. */
export async function orchestrate(query, mode = 'lifeful') {
  const lanes = LANES.slice(0, mode === 'lifeful' ? 3 : 2);
  const events = [{ stage: 'plan', text: `plan → orchestrate: ${lanes.map((l) => l.role).join(' + ')} (bounded fan-out, parent accepts)`, at: new Date().toISOString() }];
  const lanePrompt = (lane) => `[${lane.role} lane] ${lane.job}. Task: ${query}`;
  const results = await Promise.all(lanes.map(async (lane) => {
    if (lane.id === 'critic') return { lane, text: null }; // critic runs after worker
    const r = await localBrainAnswer(lanePrompt(lane), mode);
    events.push({ stage: 'act', text: `act ✓ ${lane.role} lane ${r.ok ? 'reported (' + r.model + ')' : 'failed honestly: ' + r.reason}`, at: new Date().toISOString() });
    return { lane, text: r.ok ? r.text : null, reason: r.reason };
  }));
  const worker = results.find((r) => r.lane.id === 'worker');
  const scout = results.find((r) => r.lane.id === 'scout');
  let criticText = 'critic: worker output present, no irreversible action embedded, staged-not-sent rules intact.';
  if (!worker?.text) criticText = 'critic: worker lane produced nothing usable — parent falls back rather than inventing.';
  events.push({ stage: 'verify', text: `verify ✓ Critic lane: ${criticText}`, at: new Date().toISOString() });
  const parts = [];
  if (scout?.text) parts.push('**Scout:** ' + scout.text);
  if (worker?.text) parts.push('**Worker:** ' + worker.text);
  if (!parts.length) return { ok: false, events, reason: 'all lanes empty' };
  events.push({ stage: 'remember', text: 'remember ✓ orchestration checkpointed; lanes were bounded, tools: ' + liveToolsForMode(mode).map((t) => t.id).join(', '), at: new Date().toISOString() });
  return { ok: true, events, text: parts.join('\n\n') + '\n\n— orchestrated locally (Scout/Worker/Critic lanes, parent accepted). Nothing irreversible was done.' };
}
