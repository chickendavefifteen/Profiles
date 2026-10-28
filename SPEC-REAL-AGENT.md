# Profiles — Real Agent Spec (v2, 2026-10-28, Muse Wonder session)

Owner direction: Profiles needs a *proper* agent behind the ask box —
Pi/pi-durable behind the scenes with a few smart extensions, still light,
closer to OMP in capability; an optional tiny packaged model; better tiers
on better hardware; always-on; clean staging for Word/Google Docs/PPT;
agent acts via Playwright or CUA+vision or codemode script-writing;
smooth across phone/laptop/PC; 4–5 modes manually or on auto, adapting to
the user but customisable on request.

This spec is what the code in `agent/` implements today, what is stubbed,
and what is deliberately gated. Nothing here requires network by default.

## 1. Architecture (one brain, many faces)

```
Ask box / PWA / Tauri window  (src/, unchanged skeleton, no reflow)
        │  POST /api/ask {query, mode, device}
        ▼
Agent sidecar  (agent/sidecar.mjs — also mounted inside server.mjs)
  ├─ ladder.mjs    model ladder + intent classifier + escalation rules
  ├─ tools.mjs     smart-extension tool registry, gated per profile pack
  ├─ staging.mjs   doc/slide staging: draft → preview → export (.md/.docx)
  └─ engine/       EXISTING pack engine: governor, router, ledger (reused)
        │
        ▼
vault/  plain files the user owns: tasks/ledger.json, notes/, staging/
```

- **Pi behind the scenes:** the sidecar speaks the Pi loop verbatim
  (`sense → plan → act → verify → remember`) and checkpoints into the
  existing durable ledger (`engine/ledger.mjs`). It is *Pi-shaped*: swap
  `runLocalBrain()` for a real `pi` subprocess/RPC later without touching
  the frontend. pi-durable maps to `vault/` (memory index, tasks, notes).
- **OMP is the power face, Profiles is the calm face.** Same loop, same
  ledger format, different surface. No second agent to maintain.
- **Always-on:** `npm run agent` runs the sidecar standalone on :8799
  (tray/service later). `npm start` mounts the same API inside the web
  server, so the one run command already gives a working real agent.
  Phone PWA talks to the always-on home machine (Tailscale); iOS gets no
  fake "always-on" promise — the phone is a remote, the house is awake.

## 2. Model ladder (capability follows the device, honesty enforced)

| Tier | Size | Runs on | May do | May never do |
|---|---|---|---|---|
| `bundled-tiny` | ~30–50 MB slot (today: <1 KB heuristic classifier in `ladder.mjs`) | anything, offline | classify intent, suggest a profile, draft replies to canned asks | act, send, multi-step reasoning |
| `mobile-local` | ~0.5–1 B GGUF/ONNX | phone | triage, summarise, short drafts | irreversible actions |
| `laptop-local` | 3–8 B GGUF (llama.cpp) | PC/laptop | simple multi-step plans, full staging drafts | irreversible without cloud review* |
| `cloud` | Muse Spark 1.3 Contributor xhigh (API key or OAuth) | anywhere online | heavy reasoning, review hops | anything without the opt-in below |

\* Implemented rule (`ladder.mjs: pickTier` + `classifyIntent`):
**local tiers suggest and draft; irreversible verbs (send, pay, delete,
publish, post) escalate to cloud review AND a ledger checkpoint AND user
confirmation.** If cloud is not opted in, irreversible asks are staged as
drafts, never executed. Cloud is **opt-in, OFF by default**; enabling it
requires `PROFILES_ALLOW_CLOUD=1` + a key (`PROFILES_API_KEY`, any
OpenAI-compatible `PROFILES_API_BASE`). OAuth (Google, for Docs/Slides)
is the documented next hop, not built.

The tiny tier ships as an honest heuristic today; dropping a GGUF file in
`agent/models/` upgrades it without code changes (health endpoint reports
which brain is live — never fakes an LLM).

## 3. Smart extensions (light because they are gated, not bundled)

`agent/tools.mjs` is a registry; each tool declares modes, risk, and
whether it needs confirmation. The governor prunes the list per pack:
Low-Sensory gets `file-task` only, suggest-only; Life-ful/Dev gets all.

| Tool | What it does today | Gate |
|---|---|---|
| `file-task` | files the ask into vault ledger + note | every mode |
| `stage-doc` | drafts a document into staging (preview + .md/.docx export) | every mode |
| `stage-slides` | drafts a deck outline into staging | not Lite |
| `write-script` | writes a Playwright/codemode script to `vault/staging/scripts/` for the user to run — never auto-executes | Dev/Focus, confirm |
| `browser-act` | Playwright/CUA+vision driving | **stub, gated off** — needs per-site permission UX first |
| `google-docs` | create Google Doc/Slide from a staged draft | **stub** — needs OAuth (next hop) |

Writing scripts instead of driving the browser is the default: auditable,
re-runnable, and safe on any device. Live driving comes later behind the
same registry entry.

## 4. Staging (documents, clean and elegant)

Ask "draft a letter about…" / "slides for…" → agent stages a draft →
**Stage tab** shows a clean preview → export `.md` or a real `.docx`
(zero-dep OOXML writer in `staging.mjs`, Word/Google-Docs-openable).
Google Docs export = upload that .docx once OAuth lands. Nothing is sent
anywhere from staging; export is a download the user triggers.

## 5. Modes, auto, and adaptation

- Manual: pills 1–5, instant variable swap, no reflow (unchanged).
- **Auto = suggest-first** (`ladder.mjs: suggestProfile`): signals (hour,
  rapid switching, device class, current mode) produce a suggestion bar —
  *"It's late — Chill?"* — Accept/Dismiss. Never silent.
- Full auto is a settings toggle; when on, suggestions apply but are
  always announced in Activity. Customising = just ask ("keep me in
  Focus until 5") — the agent files that as a remembered preference note
  (stub: filed as a task/note today, preference engine later).

## 6. What is real today vs stubbed

Real: sidecar API, Pi-loop runs that file real tasks/notes, staging +
.docx export, ladder/escalation logic, tool gating, suggest-first auto,
frontend wiring with labelled simulated fallback when the sidecar is off.
Stubbed/gated: GGUF tiny model (heuristic in its slot), cloud calls
(only with explicit env opt-in), browser-act, Google OAuth export,
preference engine, Tauri tray always-on packaging.

---

# V3 addendum (2026-10-28 evening) — canvas, always-on, quiet learning

Owner corrections that override earlier sections where they conflict:

1. **No settings trips.** The lite agent is ALWAYS ON from first launch.
   Upgrading it is a conversation ("help me get a better agent plugged in")
   that opens a deterministic setup wizard on the canvas: scan device →
   recommend tier → scripted fetch (`scripts/fetch-model.mjs`, dry-run by
   default, checksumed) → wire brain → verify. Steps are allowlisted data
   (`agent/system.mjs: setupPlan/runSetupStep`), never arbitrary shell,
   nothing runs without a tap. Settings is demoted to an Advanced block
   inside the Setup pane (power users, PC side): routing opt-in,
   whole-machine tools, fleet/SSH — checkpointed and confirmed, off by default.

2. **Chat-first canvas.** One blank box; answers are chat bubbles.
   The Pi-loop TUI is a *detail pane* ("receipts"), not the conversation.
   Panes — Chat, Agent, Browser (sandboxed iframe), Document/Stage,
   Setup, Activity — align as Chat / Split / Canvas(full grid); Focus pins
   any pane beside chat. Nothing reflows between the 5 sensory profiles.
   First run is cosy: name + buddy (🦊🐢🚀🌿🐱) in the chat pane, guided
   mode, kids mode (hides Advanced), no menus to learn.

3. **Meta-profiles.** Two slots (A everyday, B clean) in `vault/config.json`,
   each with name/buddy/mode/guided/kids/advanced/voice. Reset = defaults
   with an automatic snapshot first. Snapshots (`vault/snapshots/`) cover
   config+ledger: easy unstitch, roll back, debug. Everything is plain
   files; uninstall = delete the folder.

4. **Quiet learning (pi-durable style).** `agent/learning.mjs`:
   `vault/memory/events.jsonl` (mode *dwells*, asks, dismissals) →
   `preferences.json` derived. Suggestions come ONLY from learned dwell
   patterns (≥10 settled minutes in a time bucket), at most once a
   session, and a dismissal silences them 24h + is remembered. The old
   rapid-click "are you tired?" nag is deleted — clicks don't talk,
   staying does. Repeated asks (3×) become **deterministic macros** in
   `vault/macros/` — one-tap ⚡ chips that run the same steps instantly
   with no model loop ("spin me up a blank google slides" → staged deck).
   Delete the file = unlearn. All local, inspectable, no notifications.

5. **Models (researched, see `agent/models.json`).** Bundled tiny
   heuristic (always on) → mobile-lite Qwen2.5-0.5B Q4 (491MB) →
   beefy mobile 1.5–3B → PC Qwen2.5-3B Q4 (2.1GB, downloaded on Desky,
   wired via llama.cpp) → beast 7B+/Nemotron-3-Nano-4B class on dual-GPU
   → cloud opt-in (API key/OAuth, OFF). The Celeron 4GB laptop and
   iPhone are *remotes to the home beast* or tiny-only; iOS gets no fake
   always-on claim. Voice: Web Speech in/out now (zero install);
   Parakeet TDT 0.6B v3 (real, GGUF ports exist) and NeuDecide
   (neuphonic, ONNX, 43MB-class) are manifest adapters, experimental,
   decision-only. "Nemotron 3.5 Bolt E4B" and "Minitron-2B" were NOT
   found publicly — flagged in the manifest, never packaged on vibes.

6. **Sandbox boundary.** Profiles is a top layer (Tauri/browser) that is
   sandbox-to-itself: embedded browser, staged docs, its own vault.
   It does not drive your other apps day-to-day; Playwright/CUA+vision
   live behind Advanced + per-action confirmation.
