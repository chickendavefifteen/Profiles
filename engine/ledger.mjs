// Task ledger — durable skeleton (zero-dep).
// Every agent task has a state, a next step, and a checkpoint so work
// survives device switches and app restarts. Phone picks up mid-flight.

export const STATES = ['inbox', 'active', 'checkpointed', 'done'];

export function createTask(ledger, { title, device = 'desktop' }) {
  const task = {
    id: `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    title: String(title ?? 'untitled'),
    state: 'inbox',
    next_step: 'triage capture',
    checkpoint: null,
    device,
    updated: new Date().toISOString(),
  };
  ledger.push(task);
  return task;
}

export function advance(ledger, id, { nextStep, device }) {
  const t = ledger.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  if (t.state === 'done') throw new Error('task already done');
  t.state = t.state === 'inbox' ? 'active' : t.state;
  if (nextStep) t.next_step = nextStep;
  if (device) t.device = device;
  t.updated = new Date().toISOString();
  return t;
}

export function checkpoint(ledger, id, note) {
  const t = ledger.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  t.state = 'checkpointed';
  t.checkpoint = { note: String(note ?? ''), at: new Date().toISOString(), device: t.device };
  t.updated = t.checkpoint.at;
  return t;
}

export function complete(ledger, id) {
  const t = ledger.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  t.state = 'done';
  t.updated = new Date().toISOString();
  return t;
}

/** Handoff view for device switch: checkpointed + active tasks first. */
export function handoff(ledger) {
  const rank = { checkpointed: 0, active: 1, inbox: 2, done: 3 };
  return [...ledger].sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9));
}
