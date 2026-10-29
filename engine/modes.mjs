// Modes nomenclature + Adaptive Switcher — canonical definitions.
// New canonical mode IDs (2026-10-29 overnight spec):
//   babylite (was lite), chill, FOCUSMAX (was focus), Vibes (was lifeful),
//   calm (panic button), xMAX (Vibes+Focus hybrid, Profile X only).
// Legacy IDs (lite, focus, lifeful, dev, low-sensory) remain accepted as
// aliases so old deep-links, saved configs and packs keep working.

export const MODE_ORDER = ['babylite', 'chill', 'FOCUSMAX', 'Vibes', 'calm', 'xMAX'];

export const MODE_ALIASES = {
  lite: 'babylite',
  focus: 'FOCUSMAX',
  focused: 'FOCUSMAX',
  lifeful: 'Vibes',
  vibes: 'Vibes',
  dev: 'Vibes',
  'low-sensory': 'calm',
  lowsensory: 'calm',
  xmax: 'xMAX',
  XMAX: 'xMAX',
};

export function canonicalMode(id) {
  if (!id) return null;
  if (MODE_ORDER.includes(id)) return id;
  const lower = String(id).toLowerCase();
  // Case-insensitive exact match (FOCUSMAX / Vibes / xMAX).
  const ci = MODE_ORDER.find((m) => m.toLowerCase() === lower);
  if (ci) return ci;
  if (MODE_ALIASES[id]) return MODE_ALIASES[id];
  if (MODE_ALIASES[lower]) return MODE_ALIASES[lower];
  return null;
}

export const MODE_META = {
  babylite: {
    id: 'babylite', hotkey: '1', legacy: ['lite'],
    label: 'babylite · soft + simple',
    theme: 'soft baby-blue accent, big targets, one thing at a time',
    motion: 60, sim: 1, tick: 900, speech: 'terse',
    trigger: 'resource pressure (CPU/RAM) downshifts here',
  },
  chill: {
    id: 'chill', hotkey: '2', legacy: [],
    label: 'chill · warm and slow',
    theme: 'warm, slow, rest reminders',
    motion: 35, sim: 1, tick: 2600, speech: 'sparse',
    trigger: 'AFK / idle / minimal input segways here',
  },
  FOCUSMAX: {
    id: 'FOCUSMAX', hotkey: '3', legacy: ['focus'],
    label: 'FOCUSMAX · mono-task',
    theme: 'uppercase mono-task, distractions held',
    motion: 10, sim: 1, tick: 1000, speech: 'terse',
    trigger: 'heavy focus on one pane segways here',
  },
  Vibes: {
    id: 'Vibes', hotkey: '4', legacy: ['lifeful', 'dev'],
    label: 'Vibes · full energy',
    theme: 'fun, fluent, energetic, full-sensory multitasking',
    motion: 100, sim: 4, tick: 700, speech: 'full',
    trigger: 'rapid task swapping segways here',
  },
  calm: {
    id: 'calm', hotkey: '5', legacy: ['low-sensory'],
    label: 'calm · sensory panic button',
    theme: 'zero motion, softened contrast, minimal cognitive load',
    motion: 0, sim: 0, tick: 4200, speech: 'quiet',
    trigger: 'manual panic button only — never auto-selected',
  },
  xMAX: {
    id: 'xMAX', hotkey: '6', legacy: [],
    label: 'xMAX · parallel storm',
    theme: 'Vibes + FOCUSMAX hybrid: crisp, quick, heavy parallelism',
    motion: 100, sim: 6, tick: 450, speech: 'full',
    trigger: 'Profile X power mode only',
    requiresProfileX: true,
  },
};

export const HOTKEY_TO_MODE = {
  1: 'babylite', 2: 'chill', 3: 'FOCUSMAX', 4: 'Vibes', 5: 'calm', 6: 'xMAX',
};

export const HOTKEY_TO_SLOT = { a: 'A', b: 'B', c: 'C', x: 'X' };

// Pack file backing each mode (legacy packs kept, new names added).
export const MODE_PACK_FILE = {
  babylite: 'babylite',
  chill: 'chill',
  FOCUSMAX: 'FOCUSMAX',
  Vibes: 'Vibes',
  calm: 'low-sensory',
  xMAX: 'xmax',
};

// Context triggers for the Adaptive switcher. Pure + testable:
// decideAdaptive({ idleSec, focusedSinglePane, swapRate, cpuLoad, memPressure, profileX })
// returns a mode id or null (no switch). calm is NEVER auto-selected.
export function decideAdaptive(ctx = {}) {
  const idleSec = ctx.idleSec ?? 0;
  const swapRate = ctx.swapRate ?? 0; // pane switches in last 60s
  const cpuLoad = ctx.cpuLoad ?? 0; // 0..1
  const memPressure = ctx.memPressure ?? 0; // 0..1
  const focused = !!ctx.focusedSinglePane;

  // Resource pressure wins (downshift to babylite) — but never yank out of calm.
  if ((cpuLoad >= 0.85 || memPressure >= 0.85) && ctx.current !== 'calm' && ctx.current !== 'babylite') {
    return { to: 'babylite', why: 'resource pressure: CPU/RAM struggling — soft downshift to babylite' };
  }
  // AFK / idle.
  if (idleSec >= 90 && ctx.current !== 'chill' && ctx.current !== 'calm') {
    return { to: 'chill', why: 'idle/AFK — gentle segway to chill' };
  }
  // Rapid task swapping -> Vibes (needs Profile X gate check for xMAX only).
  if (swapRate >= 5 && ctx.current !== 'Vibes' && ctx.current !== 'calm' && ctx.current !== 'xMAX') {
    return { to: 'Vibes', why: 'rapid task swapping — segway to Vibes' };
  }
  // Deep focus on one pane -> FOCUSMAX.
  if (focused && ctx.current !== 'FOCUSMAX' && ctx.current !== 'calm' && ctx.current !== 'xMAX') {
    return { to: 'FOCUSMAX', why: 'sustained single-pane focus — segway to FOCUSMAX' };
  }
  return null;
}

export function isModeVisible(mode, { profileXOn = false } = {}) {
  const c = canonicalMode(mode);
  if (!c) return false;
  if (c === 'xMAX') return !!profileXOn;
  return true;
}
