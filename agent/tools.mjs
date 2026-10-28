// Smart-extension tool registry — light because tools are gated per
// profile pack, not bundled into the UI. The governor prunes this list:
// Low-Sensory gets file-task only (suggest-only); Life-ful/Dev gets all.
// browser-act and google-docs are registered but GATED OFF (stubs with a
// named missing prerequisite) — never silently enabled.

export const TOOLS = [
  { id: 'file-task', label: 'File into vault tasks + note', risk: 'low', confirm: false,
    modes: ['lite', 'chill', 'focus', 'lifeful', 'calm'], status: 'live' },
  { id: 'stage-doc', label: 'Stage a document draft (preview, .md/.docx)', risk: 'low', confirm: false,
    modes: ['lite', 'chill', 'focus', 'lifeful', 'calm'], status: 'live' },
  { id: 'stage-slides', label: 'Stage a slide-deck outline', risk: 'low', confirm: false,
    modes: ['chill', 'focus', 'lifeful'], status: 'live' },
  { id: 'write-script', label: 'Write a Playwright/codemode script to vault (never auto-runs)', risk: 'medium', confirm: true,
    modes: ['focus', 'lifeful'], status: 'live' },
  { id: 'browser-act', label: 'Drive a browser (Playwright, read-only actions, per-run confirm token)', risk: 'high', confirm: true,
    modes: ['lifeful'], status: 'gated', gate: 'live via /api/browser/prepare+run (X or Advanced, 60s token); CUA+vision still gated' },
  { id: 'google-docs', label: 'Push staged draft to Google Docs/Slides', risk: 'medium', confirm: true,
    modes: ['chill', 'focus', 'lifeful'], status: 'gated', gate: 'needs Google OAuth (next hop); .docx export works today' },
];

const UI_TO_MODE = { dev: 'lifeful', 'low-sensory': 'calm' };

/** Tools available in a mode (accepts pack names like dev/low-sensory too). */
export function toolsForMode(mode) {
  const m = UI_TO_MODE[mode] ?? mode;
  return TOOLS.filter((t) => t.modes.includes(m));
}

/** Live tools only — gated stubs are listed for honesty, never callable. */
export function liveToolsForMode(mode) {
  return toolsForMode(mode).filter((t) => t.status === 'live');
}

export function toolById(id) {
  return TOOLS.find((t) => t.id === id) ?? null;
}
