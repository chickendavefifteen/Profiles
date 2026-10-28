// Sensory governor — enforces budgets in code, not just theme.
// Rule: motion that exceeds the pack's budget is clamped, and
// Low-Sensory-class budgets (max_animation 0) produce zero motion.
// The frontend must call cssVars() and set body.still when still() is true.

export function clampBudget(sb) {
  const out = { ...sb };
  out.max_animation = Math.min(1, Math.max(0, out.max_animation ?? 1));
  // Flash is never allowed when motion is near zero, regardless of flash_hz.
  if (out.max_animation <= 0.1) out.flash_hz = 0;
  out.flash_hz = Math.min(60, Math.max(0, out.flash_hz ?? 0));
  out.max_simultaneous = Math.max(0, Math.min(8, Math.round(out.max_simultaneous ?? 0)));
  if (out.max_animation === 0) out.max_simultaneous = 0;
  return out;
}

export function governorApply(pack) {
  const eff = JSON.parse(JSON.stringify(pack));
  eff.sensory_budget = clampBudget(pack.sensory_budget ?? {});
  // Animation level is capped by the budget: budget 0 kills animation_level.
  if (eff.sensory_budget.max_animation === 0) eff.ui.animation_level = 0;
  else eff.ui.animation_level = Math.min(eff.ui.animation_level ?? 1, eff.sensory_budget.max_animation <= 0.3 ? 1 : 2);
  return eff;
}

/** True when the UI must render zero motion (provable on camera). */
export function still(effectivePack) {
  return (effectivePack?.sensory_budget?.max_animation ?? 1) === 0;
}

export function cssVars(effectivePack) {
  const sb = effectivePack?.sensory_budget ?? {};
  const ui = effectivePack?.ui ?? {};
  return {
    '--anim': String(sb.max_animation ?? 1),
    '--flash-hz': String(sb.flash_hz ?? 0),
    '--font-scale': String(ui.font_scale ?? 1),
    '--target-min': `${ui.target_min_px ?? 44}px`,
  };
}

export function budgetLine(effectivePack) {
  const sb = effectivePack?.sensory_budget ?? {};
  const ag = effectivePack?.agent ?? {};
  return `animation ${sb.max_animation ?? 1}, flash ${sb.flash_hz ?? 0} Hz, ` +
    `simultaneous ${sb.max_simultaneous ?? 0}; agent ${ag.verbosity ?? '?'}/${ag.autonomy ?? '?'}`;
}
