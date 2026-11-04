# Profiles — Build Spec (overnight build, 2026-10-26)

Current reliability work (2026-10-31): use `README.md`, `QUALITY-GATES.md`
and the current entry in `QA-REPORT.md` for the actual architecture,
verification commands and measured artifacts. The overnight instructions
below are historical; the owner's current GitHub-backup request supersedes
their old no-push instruction. Desktop resource-budget checks are not
physical Chromebook certification.

Owner is asleep / on SSH. Build this all the way through so that in the
morning (Desky, main desktop) he can sit down, open the app, and TEST it.
Work autonomously in small steps. Keep WORKBOARD.md updated with what is
done, what is next, and the exact command to run the app. If a step
fails, fix it or take the simpler route — a working testable app beats
an ambitious broken one. Synthetic demo data only. No games, no
employer code/data.

Deadline for this build pass: morning 2026-10-27 (Europe/London).
Hackathon submission deadline: Nov 4, 9pm ET (spec in SPEC.md).

## Morning acceptance test (what "done" means)

1. One documented command in README.md starts the app on Desky
   (web build is fine; Tauri shell may exist alongside).
2. Dave can switch profiles and SEE the app evolve:
   - Chill: calm, slow, one thing at a time, soft palette.
   - Busy / Life-ful (Dev/Heavy): the showpiece. Vibrant, alive,
     animated — reactive agent lanes working in parallel, live
     activity stream, animated ambience. Impressive on first sight.
   - Low-Sensory / ND calm mode: animations nearly stop, NO flashing,
     muted palette, single column, one task only, parallelism off,
     notifications silenced. The contrast with Life-ful must be
     obvious within 2 seconds of switching.
   - Lite: big targets, minimal, works by typing/clicking or a few
     keybinds, no animation.
   - Focus: mono-task queue, distractions hidden.
3. Sensory budget meter is visible and reacts to mode switches
   (governor enforces budgets in code, not just CSS themes).
4. Agent loop panel shows the Pi-style loop live:
   sense -> plan -> act -> verify -> remember, with checkpoints in a
   task ledger. Demo tasks from the synthetic vault (notes, calendar,
   news) move through the loop. In Life-ful mode several run in
   parallel; in Low-Sensory/Chill exactly one runs, slowly.
5. Capture box: type a note/task, agent files it into vault + ledger.
6. Settings: "smart model routing" toggle exists, is OPT-IN and OFF
   by default, with cost-preview text. Runtime model concept:
   Muse Spark 1.3 Contributor xhigh (do not hard-require network
   calls for the demo; local simulated agent actions are fine, wire
   real API calls behind the toggle if time remains).

## Visual direction

- Life-ful mode is the demo hero: rich gradient ambience, smooth
  animated cards/orbs, live pulse — but never strobe; cap flash rate
  in the governor for ALL modes.
- Every other mode must feel like the same app re-tuned, not a
  different app: same layout bones, different density, motion,
  palette, parallelism.
- Big, obvious profile switcher (also keyboard accessible).
- Font scaling and target sizes change per profile.

## Guardrails

- WCAG-minded: no more than 3 flashes/sec anywhere (aim: none),
  reduced-motion respected, keyboard-only path works.
- Local-first: vault/ folder stays plain files the user owns.
- Keep dependencies light so it runs on a Chromebook-class machine
  in Lite mode.

## Polish bar (owner, 2026-10-26 evening)

"Basically fully built, just needing refining" by morning. Spend the
credits/time: iterate on the Life-ful mode visuals until they are
genuinely impressive, re-check the calm-mode contrast after each
change, keep tests green, and prefer finishing + polishing what
exists over starting new features after the acceptance test passes.
A parallel visual lane is exploring in /home/dh/profiles-visual-lane
(visual/index.html + visual/NOTES.md) — in the morning, adopt
anything from its NOTES that improves the main build.
Overnight supervision runs until 10:55 UTC; you will be nudged to
continue when idle. Keep going until MORNING.md is written.

## Finish line for the morning

- App runs, tests (tests/run.mjs or successor) pass, README has:
  run command, mode tour, what to try first.
- Leave a short MORNING.md: what was built overnight, what works,
  what is still stubbed, next steps for the hackathon submission.
- Do not submit anything externally. Do not push to any remote.

## Chromebook envelope (perf lane, 2026-10-31)

Target: the compiled Tauri binary stays small and still modes stay still.

- Binary budget: 12MB. The current measured release size is recorded in
  `QA-REPORT.md`. Rust uses `opt-level="z"`, LTO and stripping; Tauri uses
  the OS webview rather than bundling Chromium. Node/project resources,
  optional Playwright Chromium and optional model weights remain separate.
  `npm run sync-packs` vendors the offline profile packs.
- Stillness: `babylite`/`lite` budgets are `max_animation 0,
  max_simultaneous 0` (same as calm/low-sensory), so the governor reports
  `still()` and the frontend holds `gov-freeze`. Celebrations are capped
  (first 4 panes, <=270ms stagger, never when `document.hidden`), and every
  repeating invite/poll timer returns early while hidden. Keyframes are
  transform/opacity-only (`tabShimmer`/`lurePulse` pulse opacity, never
  filter/box-shadow); `[hidden]{display:none!important}` and the
  `#pane-browser` no-transform rule are load-bearing for software rendering.
- PWA: `src/sw.js` caches the app shell only; `/api/*` is never cached.
- Local vs Chromebook: dev/verify happens on a 16-core/62GB omarchy box, but
  the envelope that matters is Chromebook-class (weak iGPU, software
  compositing): zero motion in babylite/calm, settle-only in chill, capped
  celebration in Vibes/FOCUSMAX/xMAX. Run the behavioral gates in
  `QUALITY-GATES.md`; source/wording pins are not verification.
