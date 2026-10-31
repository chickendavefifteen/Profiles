# QA Report — worker-5-qa (feature/qa-gates)

Date: 2026-10-29 · Worktree: `worktrees/p-qa` · Base: `841f4f1` (shared overnight base)

## Deliverables

- `tests/qa/overnight-gates.mjs` — Playwright E2E suite for the five overnight gates
  (self-spawns `server.mjs` on `QA_PORT`, honours `QA_BASE` / `QA_HEADED`).
- `package.json` — new scripts `qa:gates` (pins must hold) and `qa:gates:strict`
  (pins + target gates; for post-merge CI).

## Method: pins vs gates

- `pin(name, cond)` — behaviour true TODAY that must never regress.
- `gate(name, cond)` — target contract owned by a sibling branch; fails until merged.
- Default exit: nonzero iff any pin fails. `--strict` also fails on open gates.

## Results (this worktree, 2026-10-29)

- Unit: `npm test` → **208 passed, 0 failed**.
- Existing QA: `npm run qa` → **14/14 passed** (against this worktree's own server
  on a private port; the shared :8123 is held by another session — see note).
- New gates: `npm run qa:gates` → **25/25 pins holding, 5/22 target checks passing**.
  17 open gates map to sibling branches (see below). Exit 0 (non-strict).

### Open gates by owner

- worker-1-core: X-activation git rollback repo (1).
- worker-2-modes: Adaptive toggle + position + persistence, 6th-mode hotkey,
  spec pill labels, a/b/c slot hotkeys (9).
- worker-4-ui: unpinned border-drag resize, trash outside-click dismissal (2).
- worker-3-canvas: + menu Video/Activity removal, sketch canvas + draw + persist (5).

Already-green target checks (no sibling work needed): rollback wording via
snapshots, addMenu/brandMenu outside dismissal, xMAX absent while X off,
everything-on single-click X entry, A/B/C + X isolation proofs.

## Notes for the merge run

1. Run `npm run qa:gates:strict` after the linear reconciliation — all 22 gates
   must pass there, plus 208 unit + 14 QA with zero regressions.
2. Do NOT run `npm run qa` against the shared :8123 blindly; verify which
   worktree that server roots at first (it is owned by another session).
3. Selector contracts the suite assumes (align sibling implementations or update
   the suite): `#adaptiveToggle` checkbox labelled "Adaptive" left of `.pills`;
   six pills `babylite/chill/FOCUSMAX/Vibes/xMAX/calm`; hotkeys `1-6`, `a/b/c/x`;
   edge-drag resize on `.pane.unpinned`; outside-click hides `#trashPop`;
   no Video/Activity in `#addMenu`; drawable `#pane-doc canvas` that persists.

## Merge reconciliation

Sibling branches (`feature/profile-x-core`, `feature/modes-adaptive`,
`feature/canvas-browser`, `feature/ui-pin-popups`) contain **zero commits**
beyond the shared base at check time — nothing to merge yet. This branch is
base + one QA commit, fast-forwardable into master with no conflicts
(app code untouched: only `package.json` scripts + new test files).

## 2026-10-31 Chromebook review fallout (QA lane, master worktree)

Method: pins (hold today) vs gates (target contracts, may stay open with owner).
Headless only (Chromium default, `QA_BROWSER=firefox` escape), muted, software
rendering. Every claim behind `scripts/preflight.mjs` stamp-match; both suites
self-spawn on probed-free private ports (see gotcha).

Results:
- G0 `npm test` → **371 passed, 0 failed** (includes mode-stickiness, header
  order, shingle overlap, babylite luminance/contrast, browser-fit mechanism,
  perf opacity-only keyframes, X-widening load-proof, BrowserDocs/Mode/Perf blocks).
- `node tests/qa/core-flows.mjs` → **44/44** (headless Chromium, self-spawned
  private port, build stamp matches disk).
- `node tests/qa/overnight-gates.mjs` → **25/25 pins**; `--strict` → **19/24
  gates**, 5 open (all ownerless lanes — BLOCKED list below, file:line evidence).
- Native G3 BLOCKED: `src-tauri/target/{debug,release}/profiles` predate the
  worktree (release 4.25MB Oct 30); rebuild + relaunch only after final reconcile.

BLOCKED (strict-gate opens, no active owner lane):
- `activating X verifies a private git rollback repo` — neither `vault/X/.git`
  nor `vault/.git` exists on disk; creation is activation-lazy (`agent/profilex.mjs`
  `ensureXGitRepo`), gate checks without activating. Needs X-core lane decision.
- `border drag resizes the unlocked pane` (`tests/qa/overnight-gates.mjs` gate3)
  — mechanism present (`src/main.js` `addHandles`/`startResize`/`applyResize`),
  8 handles attach, zero page errors, but the gate gesture (+80px east drag)
  yields −35px width in isolation probe. Needs ui lane triage of resize math.
- sketch ×3 (`native sketch canvas lives in the doc pane`, `mouse stroke lands
  pixels`, `survives reload`) — canvas landed in pane-notes (`src/index.html`
  ~L693, inside `#pane-notes` 680–697), gates expect pane-doc. Design question
  for owner; no canvas lane active.

Quirks paid this run (also one-lined in QUALITY-GATES.md): ghost servers from
deleted worktrees holding ports with stale code (`:8125`, deleted p-qa path,
health without build stamp — probe BUILD, scan PORT..+9, never trust `r.ok`
alone); trusted clicks misdropping under iframe layout shift (in-page dispatch
+ poll); deterministic staging ids + persistent vault breaking count-growth
asserts (assert id-presence, unique payload per run).
