# Profiles

One press reshapes your whole digital environment — device, energy, brain.
Meta Global AI Hackathon, Indie track (solo). Deadline Nov 4, 2026, 9pm ET.

Synthetic demo data only. No employer code/data. No games.

## Run

**Native app window (Tauri, no browser chrome):**

```sh
npm run app
```

One command: boots the local server on :1420 and opens Profiles as a real
desktop window (title "Profiles", 1200x850) — same `src/` frontend the web
build uses. `npm run sync-packs` vendors `packs/*.json` into
`src/vendor-packs/` so app *builds* carry the pack engine too (wired as
`beforeBuildCommand` in `src-tauri/tauri.conf.json`).

**Web fallback (one command):**

```sh
npm start
```

Then open **http://localhost:8123/src/** — no build step, no dependencies.
`npm start` also mounts the **real agent sidecar** under `/api/`, so the
same command gives you the working agent (below). Or run the agent alone,
always-on: `npm run agent` (:8799). Full design: `SPEC-REAL-AGENT.md`.

The native window above is the primary app; the web build below stays as
the testable fallback.

## Tour (2 minutes, ask-first)

1. **Ask tab** — blank screen, one search bar. Type anything
   (e.g. `dentist letter arrived — file it`) and hit Go: the **Agent tab**
   opens and the pi-TUI panel works it sense → plan → act → verify → remember,
   then checkpoints to tasks + ledger.
2. **Pills 1–5** switch profile instantly — same page, nothing reflows.
   **Life-ful** is the vibrant showpiece; **Low-Sensory** is a softer dark
   with motion stopped in code (`gov-freeze`), one quiet line, nothing loud.
3. **Just ask.** The lite agent is ALWAYS ON (local sidecar) — no
   settings trip. Answers land in chat; the Agent pane keeps receipts.
   On this PC a real Qwen2.5-3B (llama.cpp) is downloaded + wired as the
   brain. Say **"help me get a better agent plugged in"** anywhere and a
   deterministic setup wizard walks the canvas with you, tap by tap.
4. Ask `draft a letter about …` or `slides for …` → **Stage tab**: clean
   preview, export **.md** or a real **.docx** (Word/Google-Docs-openable).
   Ask `send an email …` → it is **staged as a draft, never sent**:
   irreversible asks escalate (cloud review + checkpoint + your OK) and
   cloud is opt-in OFF by default (`PROFILES_ALLOW_CLOUD=1` + key).
5. **Model ladder** (Settings): bundled tiny (classify/suggest only, never
   acts — today a <1KB heuristic in the 30–50MB slot, GGUF-drop-in ready) ·
   mobile ~0.5–1B · laptop 3–8B · cloud Muse Spark 1.3 Contributor xhigh.
   **Auto profile** only ever *suggests* ("It's late — Chill?") unless you
   turn on announced auto in Settings.

Deep links: `?mode=lite|chill|focus|lifeful|calm`, `?ask=…` runs on boot,
`?agent=1` enables the real sidecar, `?tab=stage|agent|activity|settings`.

## Accessibility from the start

- Governor enforces budgets in code (`engine/governor.mjs`, mirrored live in
  `src/main.js`): Low-Sensory = zero motion, flash hard-capped at 0/s in
  **all** modes, `prefers-reduced-motion` freezes ambience everywhere.
- Skip link, aria-live budget meter + model line, 44px+ targets (64 Lite),
  full keyboard path (1–5 switch, C captures), plain-language agent.
- Agent suggests switches with a "why" and never auto-switches.

## Layout

- `src/` — polished frontend (adopted visual-lane prototype, pack-wired)
- `src-tauri/` — Tauri shell (Rust + tauri.conf.json)
- `pwa/` — phone PWA placeholder (day summary view)
- `packs/*.json` — Lite, Chill, Focus, Dev, Low-Sensory
- `engine/*.mjs` — pack loader/validator, governor, router toggle, ledger
- `agent/` — real sidecar: `sidecar.mjs` (Pi-shaped loop API), `ladder.mjs`
  (model ladder + escalation), `tools.mjs` (gated extensions), `staging.mjs`
  (doc staging + zero-dep .docx writer). Spec: `SPEC-REAL-AGENT.md`
- `vault/` — local-first folder: notes/tasks/calendar/memory/staging
- `server.mjs` — zero-dep static server (`npm start`)
- `tests/run.mjs` — zero-dep checks (`npm test`)

## Tests

```sh
npm test
```

109 checks: pack validation, governor clamp/still rules, router OFF-default, chat semantics, quiet learning, deterministic macros, setup/snapshot layer,
ledger round-trip, minimal ask-first frontend + stable layout, Tauri shell,
and the real agent — ladder/escalation rules, gated tool registry, staging
+ real .docx export, sidecar wiring, suggest-first auto.

## Privacy

Demo uses synthetic data only. Contributor-tier models may train on prompts —
nothing personal goes in. Standard-mode option is post-hackathon work.
