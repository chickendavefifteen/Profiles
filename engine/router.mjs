// Smart model routing — OPT-IN toggle, OFF by default.
// Off: one fixed model for everything. Simple, predictable cost.
// On: a pack may prefer a different model, but only with a cost
// preview + monthly budget cap + on-screen meter. Never silent.
//
// resolveModel() never throws for routing reasons; it always returns
// a decision object the UI must render when `switched` is true.

export const DEFAULT_MODEL = 'muse-spark-1.3-contributor';
export const MONTHLY_BUDGET_USD_DEFAULT = 20;

export function resolveModel(pack, opts = {}) {
  const enabled = opts.routingEnabled === true;
  const fallback = opts.defaultModel ?? DEFAULT_MODEL;
  const preferred = pack?.routing?.preferred_model ?? null;
  if (!enabled || !preferred || preferred === fallback) {
    return { model: fallback, switched: false, reason: enabled ? 'no pack preference' : 'routing off — fixed model', costPreview: null };
  }
  return {
    model: preferred,
    switched: true,
    reason: `pack "${pack?.name ?? '?'}" prefers ${preferred}; user opted in`,
    costPreview: {
      model: preferred,
      note: 'preview: estimated cost shown before use; monthly cap enforced',
      monthlyBudgetUsd: opts.monthlyBudgetUsd ?? MONTHLY_BUDGET_USD_DEFAULT,
    },
  };
}

/** Suggest a profile switch — always returns a suggestion, never applies it. */
export function suggestSwitch(fromPack, toPackName, why) {
  return {
    type: 'profile-switch-suggestion',
    from: fromPack?.name ?? null,
    to: toPackName,
    why: why ?? 'no reason given',
    requiresUserYes: true,
  };
}
