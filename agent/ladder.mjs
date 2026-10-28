// Model ladder + intent classifier + escalation + profile suggestion.
// Pure functions, zero-dep, tested. Honesty rule: the bundled "tiny" tier
// today is a <1KB heuristic classifier — it routes and drafts canned
// structure, it never acts. Dropping a GGUF in agent/models/ upgrades it
// without code changes (sidecar health reports which brain is live).

export const TIERS = [
  { id: 'bundled-tiny', label: 'Bundled tiny (~30–50MB slot)', params: '<1B', devices: ['phone', 'laptop', 'desktop'],
    may: ['classify', 'suggest-profile', 'canned-draft'], mayNot: ['act', 'irreversible', 'multi-step'] },
  { id: 'mobile-local', label: 'Mobile local (~0.5–1B)', params: '0.5-1B', devices: ['phone'],
    may: ['classify', 'summarise', 'short-draft'], mayNot: ['irreversible'] },
  { id: 'laptop-local', label: 'Laptop local (3–8B)', params: '3-8B', devices: ['laptop', 'desktop'],
    may: ['classify', 'summarise', 'draft', 'stage-doc', 'simple-plan'], mayNot: ['irreversible-solo'] },
  { id: 'cloud', label: 'Cloud — Muse Spark 1.3 Contributor xhigh', params: 'frontier', devices: ['phone', 'laptop', 'desktop'],
    may: ['heavy-reasoning', 'review', 'draft', 'stage-doc'], mayNot: ['act-without-opt-in'] },
];

const IRREVERSIBLE = /\b(send|email|pay|buy|purchase|delete|remove|publish|post|book|order|transfer|sign)\b/i;
const DOC = /\b(letter|doc|document|report|essay|memo|word)\b/i;
const SLIDES = /\b(slides?|deck|ppt|powerpoint|presentation)\b/i;
const SCRIPT = /\b(script|automate|scrape|playwright|browser|website|web page)\b/i;

/** Classify an ask. Risk drives escalation, never vibes. */
export function classifyIntent(query) {
  const q = String(query ?? '');
  if (/\b(better agent|plug\w* in|upgrade|set ?up|install|connect)\b.*\b(agent|model|brain)\b/i.test(q) || /help me get a better agent/i.test(q))
    return { kind: 'setup', risk: 'low', needsConfirm: false };
  if (IRREVERSIBLE.test(q)) return { kind: 'irreversible', risk: 'high', needsConfirm: true, escalateTo: 'cloud' };
  if (/^(hi|hey|hello|yo|hiya)\b/i.test(q.trim()) || /\b(are|r) (you|u)\b/i.test(q) || /\bwho are you\b/i.test(q)
      || /\bwhat can you do\b/i.test(q) || /\bagentic\b/i.test(q))
    return { kind: 'chat', risk: 'low', needsConfirm: false };
  if (/^\s*(file|save|log|add)\b/i.test(q)) return { kind: 'file-task', risk: 'low', needsConfirm: false };
  if (SLIDES.test(q) && !/^(what|why|how|can|is|are)\b/i.test(q.trim())) return { kind: 'stage-slides', risk: 'low', needsConfirm: false };
  if (DOC.test(q) && /\b(draft|write|make|create|about|for)\b/i.test(q)) return { kind: 'stage-doc', risk: 'low', needsConfirm: false };
  if (SCRIPT.test(q)) return { kind: 'write-script', risk: 'medium', needsConfirm: true };
  if (/\?\s*$/.test(q.trim()) || /^(what|why|how|when|who|can|could|do|does|is|are|explain|summarise|summarize)\b/i.test(q)) {
    return { kind: 'question', risk: 'low', needsConfirm: false };
  }
  // Short utterances with no imperative verb are conversation, not filing.
  if (q.trim().split(/\s+/).length <= 8 && !/\b(draft|write|make|create|file|send|book|buy|delete|remind|schedule)\b/i.test(q)) {
    return { kind: 'chat', risk: 'low', needsConfirm: false };
  }
  return { kind: 'file-task', risk: 'low', needsConfirm: false };
}

/**
 * Pick the tier that should handle this ask.
 * opts: { device='desktop', cloudOptIn=false, hasApiKey=false, tinyModelFile=false }
 * Irreversible + no cloud opt-in => staged-as-draft, never executed.
 */
export function pickTier(intent, opts = {}) {
  const device = opts.device ?? 'desktop';
  const cloudReady = opts.cloudOptIn === true && opts.hasApiKey === true;
  if (intent.kind === 'irreversible') {
    return cloudReady
      ? { tier: 'cloud', action: 'review-then-confirm', reason: 'irreversible: cloud review + checkpoint + user confirm' }
      : { tier: 'bundled-tiny', action: 'stage-draft-only', reason: 'irreversible but cloud not opted in: staged as draft, never sent' };
  }
  if (intent.kind === 'question' || intent.kind === 'write-script') {
    return device === 'phone'
      ? { tier: 'mobile-local', action: 'draft', reason: 'phone: mobile-local drafts, cloud only if opted in' }
      : { tier: 'laptop-local', action: 'draft', reason: 'local-first: laptop tier drafts without network' };
  }
  return { tier: opts.tinyModelFile ? 'bundled-tiny' : 'laptop-local', action: 'act-local',
    reason: 'safe local action (file/stage), tiny tier may classify, local tier acts' };
}

/** Suggest-first auto mode: returns a suggestion or null. Never applies. */
export function suggestProfile(signals = {}) {
  const { hour = 12, current = 'lifeful', rapidSwitches = 0, device = 'desktop' } = signals;
  if (rapidSwitches >= 3 && current !== 'calm') {
    return { to: 'calm', why: 'you have switched profiles a lot in a short time — fewer moving parts may help', requiresUserYes: true };
  }
  if (hour >= 21 && current !== 'chill' && current !== 'calm') {
    return { to: 'chill', why: 'it is late in the evening — Chill slows everything down', requiresUserYes: true };
  }
  if (hour >= 9 && hour <= 17 && device !== 'phone' && current === 'chill') {
    return { to: 'focus', why: 'daytime on a bigger screen — Focus holds distractions', requiresUserYes: true };
  }
  return null;
}
