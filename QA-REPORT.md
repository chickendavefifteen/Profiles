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
