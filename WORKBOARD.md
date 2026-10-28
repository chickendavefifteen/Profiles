# Profiles — Day 1 build (hackathon, solo indie)

Deadline: Nov 4, 2026, 9pm ET. Theme: Build for Your World.
Spec: `SPEC.md`. Synthetic demo data only. No employer code/data. No games.

## Workboard (visible plan)

Root deadline for Day 1 lane: 2026-10-27T02:00:00Z.

- [completed] `scaffold` — Tauri shell + PWA placeholder
- [completed] `packs` — pack engine + five JSON packs
- [completed] `vault` — vault + task-ledger skeleton
- [completed] `governor` — sensory governor stub + routing toggle OFF
- [running] `verify` — tests + docs (18/18 green, README written)

## Layout

- `src/` — Tauri frontend (accessible, governor-driven CSS vars)
- `src-tauri/` — Tauri shell (Rust + tauri.conf.json)
- `pwa/` — phone PWA placeholder (day summary view)
- `packs/*.json` — Lite, Chill, Focus, Dev, Low-Sensory
- `engine/*.mjs` — pack loader/validator, governor, router toggle
- `vault/` — local-first folder: notes/tasks/calendar/memory
- `tests/run.mjs` — zero-dep Day 1 checks

## Invariants (from start)

- Sensory governor enforces budgets in code, not just theme.
- Smart routing is opt-in, OFF by default. No silent model switch.
- Agent suggests profile switches with a "why"; never auto-switches.
- Contributor-tier privacy note ships in-app (synthetic demo only).

## 2026-10-27 finish build (morning session, DONE)

- Adopted visual-lane prototype into src/index.html + src/main.js (external JS for Tauri CSP).
- Pack-engine wiring: live packs/*.json fetch overrides budgets/lanes/descriptions; file:// fallback built in.
- One command: `npm start` (server.mjs) → http://localhost:8123/src/. README + MORNING.md written.
- npm test: 33/33 green (added 12 frontend + 3 run-command checks).
- Headless Chromium screenshots verified: shots/lifeful-2026-10-27.png + shots/low-sensory-2026-10-27.png.
- One real bug found+fixed: block-comment `packs/*/routing` closed the comment early → JS never ran.
- Morning acceptance test: PASS. Nothing submitted, nothing pushed.

## Update — app container + stability + motion (owner pass, same day)

- `npm run app` → Tauri native window (1200x850, titled Profiles); beforeDevCommand serves :1420; builds vendor packs (src/vendor-packs/ via sync-packs).
- Removed per-mode grid reflow + hidden cards; all modes share one skeleton with reserved heights. Change beacon rings moved panels (still modes exempt).
- Motion: staggered lane entrances, .6s theme crossfades, lifeful-only sheen, all transform/opacity keyframes; freeze/reduced-motion guards intact.
- npm test 55/55. Screenshots re-verified (s3-*.png): identical skeleton both modes. Pending: first Tauri dev window compile (tracked job profiles-tauri-dev-1).

## Tauri window VERIFIED live (same day)

- Native window "Profiles" running on desktop 2 (class profiles, no browser chrome), screenshot-verified rendering Life-ful with live pack-engine budgets.
- Scaffold fixes: added src-tauri/build.rs (was missing → generate_context failed), generated icons/ via `tauri icon`, absolute beforeDevCommand path.
- Env: needs WEBKIT_DISABLE_DMABUF_RENDERER=1 on this box (Wayland Error 71 otherwise) — baked into `npm run app`.
- Running now: target/debug/profiles (PID 86743) + :1420 server. Old chromium tab on :8123 left alone (has Dave's other tabs).

## Minimal redesign (owner pass: simpler, no lag, soft-dark calm)

- Rebuilt src/ ask-first: blank screen + search bar, 4 tabs (Ask/Agent/Activity/Settings),
  pi-TUI agent panel that embeds on submit. Verbosity per mode (full/sparse/terse/quiet).
- Profile switch = one var swap, in-place text, zero reflow; ?ask= deep-link starts a run.
- Calm is now a softer dark (warm charcoal, sage, nothing pure/loud).
- npm test 59/59. Screenshots: shots/ask-*, shots/agent-lifeful-*, shots/agent-calm-*.
- New native window running (PID relaunch) on desktop 2, serves new UI via :1420 (verified).

## 2026-10-28 real-agent pass (Wonder)
- SPEC-REAL-AGENT.md + agent/{sidecar,ladder,tools,staging}.mjs built and live-verified; npm test 87/87. See MORNING.md.
