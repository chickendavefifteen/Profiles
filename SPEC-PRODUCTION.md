# Profiles — Master Production Spec (consolidated, 2026-10-28)

This is the single source of truth. It consolidates every owner direction
from the hackathon build (visual prototype → real agent → canvas → UX
overhaul) into phased, acceptance-gated production work. Earlier docs
(SPEC.md, BUILD.md, SPEC-REAL-AGENT.md, PRODUCTION.md) remain as history;
where they conflict, THIS file wins. Status column is audited against the
code, not aspirations: DONE / PARTIAL / STUB / NOT STARTED, with file refs.

Owner's core sentence, which every decision must serve: *"A calm front
door over an agent, a browser and the apps people already use — that
adapts to you, learns quietly, and never becomes homework."*

---

## 1. Product shape

- One blank ask box; answers in chat; everything else is panes.
- **Front door:** Browse / Search-Ask / Work arrange the canvas.
- **Sensory profiles (the app's soul):** Lite, Chill, Focus, Life-ful,
  Low-Sensory — same skeleton, different weather AND physics, governor
  enforced in code (flash 0/s always; Low-Sensory static always).
- **Meta profiles (people):** A/B/C default, D/E by setting, X opt-in.
  Each = a separate world (own vault/layout/memory/macros/notes).
  A/B/C = "you get what we designed". X = ringfenced full-access power
  world (Codex-like), advised stronger brain, can only hurt itself.
- **Agent:** always-on lite agent by default; deterministic scripts for
  setup and repeated tasks; local LLMs by tier; cloud only opt-in.
- **Learning:** dwell-based, quiet, local files; macros replace loops;
  suggestions rare + dismissible into 24h silence; private mode = no
  recording (Phase 2).

## 2. Architecture (as built, verified 2026-10-28)

```
Tauri 2 shell (Rust, OS webview)  ─┐
Browser / phone PWA               ├─ src/ vanilla JS+CSS, no build step
                                  │
        fetch /api/*              ▼
Node sidecar (zero deps)  agent/sidecar.mjs
  ├─ ladder.mjs    intent classify + tier escalation (deterministic)
  ├─ localbrain.mjs llama.cpp spawn per model, template adapters (P1)
  ├─ pibrain.mjs   Profile-X only: real `pi --print` subprocess (P2)
  ├─ tools.mjs     gated tool registry per mode/slot
  ├─ staging.mjs   draft → preview → .md/.docx (zero-dep OOXML)
  ├─ learning.mjs  events.jsonl → preferences, macros, linkage (per slot)
  ├─ system.mjs    capabilities, deterministic setup steps, snapshots
  └─ slots.mjs     vault/A|B|C|D|E|X — zero carry-across
vault/<slot>/  config, tasks/ledger, memory/, macros/, staging/,
               notes/, snapshots/   (plain files; delete = uninstall)
agent/models/  GGUF weights (shared, read-only across slots — weights
               are not personal data; per-slot *choice* of brain is)
```

**Why this shape:** Tauri gives a native window for the price of the OS
webview; vanilla JS keeps the frontend agent-editable with no toolchain;
the Node sidecar keeps the Pi loop shape (`sense→plan→act→verify→
remember` + ledger checkpoints = pi-durable file philosophy) without a
daemon; llama.cpp is the one runtime that covers 230M→14B, CPU→GPU,
phone→beast with a single binary.

## 3. Audited status (2026-10-28, npm test 151/151)

| Area | Status | Evidence / gap |
|---|---|---|
| Sensory profiles + governor | DONE | engine/, packs/, screenshots per mode |
| Canvas: pin-move, tabs, close/minimise/recover, ≤8/page | DONE | src/main.js pinTiles/renderTrash |
| Slots A–E + X isolation | DONE | API-proven both directions; vault/<slot>/ |
| Front door Browse/Ask/Work | DONE | HOME_LAYOUTS; app tiles open real browser |
| Lite agent always-on + chat semantics | DONE | classifyIntent chat/question/setup kinds |
| Local brains: Qwen2.5-3B (PC), LFM2.5-1.2B (lite), Nemotron-3-Nano-4B | DONE (P1.1/1.2) | template adapters per model (chatml/gemma/lfm/llama3/plain) — LFM chat 0.85s, Nemotron 5.5s, both correct; per-slot brain picker in Setup |
| Gemma-3n-E4B | DONE (P1.4) | downloaded 4,539,054,208B sha 43b489bb, gemma adapter chats cleanly (verified) |
| Deterministic setup wizard | DONE | system.mjs setupPlan + scripts/fetch-model.mjs |
| Quiet learning + macros + linkage + reorganise | DONE | learning.mjs; macros at 3× repeats |
| Staging .md/.docx, slides outline | DONE | staging.mjs; Google *push* needs OAuth (P3) |
| Voice in/out | PARTIAL | Web Speech wired with natural-voice pick + honest errors; engine availability depends on host webview. Parakeet adapter NOT STARTED (manifest only) |
| Profile X full access | PARTIAL→DONE core (P2.1) | **real Pi brain live**: `pi --print` contributor, tools working, sessions in vault/X/pi-sessions, cwd ringfenced, A proven unable to reach it (18s tool-using run). Whole-machine widening beyond vault/X remains an owner decision (spec §6.3) |
| Browser-act (Playwright/CUA+vision) | STUB | registry entry gated; runner NOT STARTED (browsers cached, library absent) — P4, X-only, per-action confirm |
| Cloud brains (API key/OAuth) | PARTIAL | env opt-in gate exists; no in-app key entry, no OAuth flow — P3 |
| Phone (Android/iPhone) | PARTIAL (P1.3 built, device gate pending) | src/ is installable PWA (manifest+SW, API never cached); hub-URL setting remotes a phone to the home PC sidecar. Acceptance gate (real phone screenshot) needs Dave's handset |
| Private mode (no recording) | DONE (P2.2) | per-slot `privateMode` stops events/learning recording; toggle in Setup |
| Overdrive/Chaos personalities | DONE | intensity per slot; calm forces static |

## 4. Phases (dependency-ordered; each has an acceptance gate)

### P1 — Brains done properly + phone-testable (next)
1. **Template adapters** (`localbrain.mjs`): per-model prompt format
   registry (chatml / plain / gemma / lfm) chosen by filename; every
   downloaded model answers chat questions, not just completions.
   *Gate:* scripted ask against each GGUF returns sane chat output.
2. **Brain picker per slot** (Setup › Models): choose any downloaded
   GGUF as this profile's brain (advised tier shown; X warns under 3B).
   *Gate:* switch A to LFM, ask, answer signed by LFM; B unaffected.
3. **Installable PWA**: manifest + SW + icons for `src/`; **hub URL**
   setting so a phone on the home network/Tailscale points at the
   always-on PC sidecar. *Gate:* phone-browser screenshot of the real
   UI answering via the PC brain (headless remote-UA proof acceptable).
4. Gemma E4B lands → adapter → listed as beefy-mobile/PC option.

### P2 — Profile X becomes real
1. **pibrain.mjs**: for slot X with piPower on, chat questions route to
   `pi --print --mode json` with `--session-dir vault/X/pi-sessions`
   (durable continuity per X only), contributor model default, tools
   allowlist = pi defaults minus nothing (that's the point of X) but
   spawned with cwd `vault/X/` sandbox; output parsed into chat +
   agent detail. A/B/C can never reach this code path (slot check +
   profile flag, tested).
   *Gate:* X answers with a real pi tool-using run (e.g. lists its own
   vault), A asking the same thing gets the lite agent; ledger proof.
2. **Private mode** per slot: stops events/learning recording, badge
   shown. *Gate:* events.jsonl unchanged across asks with it on.
3. **Advanced tools in X**: staged-script runner with per-run confirm
   token (script shown, one explicit Run, output back in chat).

### P3 — Accounts + docs push
1. API-key entry in Advanced (stored in OS keychain via Tauri, never in
   vault plain text) → cloud tier live for review hops.
2. Google OAuth (PKCE, Google client) → staged draft *push* to Docs/
   Slides; Microsoft Graph the same shape for Word/PPT.
   *Gate:* a staged letter appears in a real Google Doc (owner account).
3. OAuth logins surfaced Pi-style (`pi auth` already exists on the
   host — reuse for X; in-app flow for normal users).

### P4 — Acting in the world (X and confirmed A/B staging only)
1. Playwright runner service (pinned dep, X-only, per-action confirm,
   screenshot receipts in Activity).
2. CUA+vision adapter behind the same confirm gate (desktop only).
3. Codemode script library: agent-written scripts saved per slot,
   re-runnable from macros.

### P5 — Voice properly
1. Parakeet 0.6B local ASR sidecar adapter (GGUF port) — replaces Web
   Speech where installed; NeuDecide-class wake/intent as experimental.
2. Local TTS upgrade path (llama-tts present on host; evaluate).

## 5. Non-negotiables (every phase)

- Tests green and *grown* per feature (`tests/run.mjs`, zero deps).
- Screenshots per visual claim; headless console clean.
- No silent network: downloads are scripted + explicit; cloud opt-in.
- Irreversible actions: stage + checkpoint + confirm, in that order.
- Low-Sensory promises outrank every other feature, forever.
- Per-slot isolation is a test, not a hope: new state = new slot path.
- Work happens in the open: this spec's status table updated per phase.

## 6. Open decisions for the owner (non-blocking defaults chosen)

1. Default PC brain once adapters land: Qwen2.5-3B (chosen — proven).
2. Gemma E4B vs Nemotron-4B as the "beefy" recommendation: benchmark
   both on Desky in P1, recommend the winner, keep both choosable.
3. X's pi tools: full pi defaults inside `vault/X/` cwd (chosen) vs
   whole-home cwd — whole-home only behind a second explicit toggle.
4. Phone strategy: PWA-remote-to-home-hub (chosen) before any native
   mobile shell; iOS always-on is a platform fiction we won't sell.

> Status refresh (2026-10-28 night): P1.1 adapters DONE, P1.2 picker
> DONE, P1.4 Gemma landed + verified (sha 43b489bb…), P2.1 pi brain
> DONE, P2.2 private mode DONE. Next unblocked: P3 (keys/OAuth/docs).
