// Profiles pack engine — loader + validator (zero-dep, ESM).
// A pack is declarative JSON. This module validates it and returns
// a normalized effective pack. Sensory clamping lives in governor.mjs;
// model routing lives in router.mjs (OFF by default).

const VERBOSITY = new Set(['terse', 'plain', 'detailed']);
const AUTONOMY = new Set(['suggest-only', 'act-with-checkpoint']);
const WIDGETS = new Set(['calendar', 'notes', 'news', 'files', 'tasks']);

export const PACK_VERSION = 1;

export function validatePack(pack) {
  const errors = [];
  const warnings = [];
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['pack must be an object'], warnings };
  for (const k of ['name', 'version', 'ui', 'sensory_budget', 'input', 'notifications', 'agent', 'widgets']) {
    if (!(k in pack)) errors.push(`missing key: ${k}`);
  }
  if (pack.version !== PACK_VERSION) errors.push(`version must be ${PACK_VERSION}`);
  const sb = pack.sensory_budget ?? {};
  if (typeof sb.max_animation !== 'number' || sb.max_animation < 0 || sb.max_animation > 1) {
    errors.push('sensory_budget.max_animation must be 0..1');
  }
  if (typeof sb.flash_hz !== 'number' || sb.flash_hz < 0 || sb.flash_hz > 60) {
    errors.push('sensory_budget.flash_hz must be 0..60');
  }
  if (typeof sb.max_simultaneous !== 'number' || sb.max_simultaneous < 0 || sb.max_simultaneous > 8) {
    errors.push('sensory_budget.max_simultaneous must be 0..8');
  }
  const ui = pack.ui ?? {};
  if (typeof ui.font_scale !== 'number' || ui.font_scale < 0.8 || ui.font_scale > 2) {
    errors.push('ui.font_scale must be 0.8..2');
  }
  if (typeof ui.target_min_px !== 'number' || ui.target_min_px < 24 || ui.target_min_px > 96) {
    errors.push('ui.target_min_px must be 24..96');
  }
  const ag = pack.agent ?? {};
  if (!VERBOSITY.has(ag.verbosity)) errors.push('agent.verbosity must be terse|plain|detailed');
  if (!AUTONOMY.has(ag.autonomy)) errors.push('agent.autonomy must be suggest-only|act-with-checkpoint');
  if (typeof ag.parallelism !== 'number' || ag.parallelism < 1 || ag.parallelism > 8) {
    errors.push('agent.parallelism must be 1..8');
  }
  if (!Array.isArray(pack.widgets)) errors.push('widgets must be an array');
  else for (const w of pack.widgets) if (!WIDGETS.has(w)) errors.push(`unknown widget: ${w}`);
  for (const k of Object.keys(pack)) {
    if (!['name', 'version', 'description', 'ui', 'sensory_budget', 'input', 'notifications', 'agent', 'widgets', 'routing'].includes(k)) {
      warnings.push(`unknown top-level key (ignored): ${k}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function normalizePack(pack) {
  // Deep-clone + fill documented defaults so the UI never branches on undefined.
  const p = JSON.parse(JSON.stringify(pack));
  p.description ??= '';
  p.ui.density ??= 'comfortable';
  p.ui.palette ??= 'default-dark';
  p.ui.animation_level ??= 1;
  p.input.modes ??= ['pointer', 'keyboard'];
  p.input.big_targets ??= false;
  p.input.voice ??= false;
  p.notifications.allow ??= [];
  p.notifications.quiet_hours ??= null;
  p.agent.proactivity ??= 0;
  p.agent.rest_reminders ??= false;
  p.agent.cadence_s ??= 300;
  p.routing ??= { preferred_model: null };
  return p;
}

export function loadPackFromObject(obj) {
  const v = validatePack(obj);
  if (!v.ok) throw new Error(`invalid pack: ${v.errors.join('; ')}`);
  return { pack: normalizePack(obj), warnings: v.warnings };
}
