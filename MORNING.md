# MORNING — Profiles finish-build handoff (2026-10-27, ~06:40 UTC)

## What works

- **One command:** `npm start` → open **http://localhost:8123/src/**
  (zero-dep static server; serves repo root so live `packs/*.json` load).
- **Adopted visual lane:** `src/index.html` + `src/main.js` is the polished
  morning experience (visual-lane prototype adopted, JS moved to external
  `main.js` for the Tauri CSP + cacheability; works over http AND file://).
- **Switch profiles, SEE evolution:** keys **1–5** or click.
  Life-ful (Busy) = vibrant, 4 parallel agent lanes, live activity stream,
  animated ambience. Low-Sensory = animation **stopped in code**
  (`gov-freeze` kills CSS + JS pulse), warm-paper palette, single column,
  one slow lane, notifications silenced. Contrast lands in ~2 seconds —
  see `shots/lifeful-2026-10-27.png` vs `shots/low-sensory-2026-10-27.png`.
- **Sensory budget meter** reacts per mode (motion %, flash 0/s, lanes) and
  the governor enforces it in JS, not just CSS (`clampBudget` mirrors
  `engine/governor.mjs`; flash hard-capped 0/s everywhere;
  `prefers-reduced-motion` freezes ambience in all modes).
- **Pack engine wired:** on boot the frontend fetches the real
  `packs/*.json` and overrides budgets/lanes/descriptions (activity stream
  logs "pack engine: live packs loaded"). File:// fallback = built-in
  budgets mirroring the packs, so the demo never breaks.
- **Agent loop panel:** sense → plan → act → verify → remember with a lead-
  lane strip, 4 parallel lanes in Life-ful / 1 slow lane in Low-Sensory,
  ledger checkpoints ("✓ checkpoint … remembered + filed").
- **Capture box:** type + File it (or press C) → task appears, checkpoint logged.
- **Routing toggle:** Settings card, **OFF by default**, fixed model
  Muse Spark 1.3 Contributor (concept); turning it on shows the cost preview
  + monthly cap text. Agent *suggests* profile switches with a "why" card
  after 30s in Life-ful; never auto-switches.
- **Tests:** `npm test` → **33 passed, 0 failed** (packs, governor,
  router, ledger, settings, 12 frontend checks, 3 run-command checks).
- **Accessibility:** skip link, aria-live meter/model line, 44px+ targets
  (64 Lite), full keyboard path, plain language.

## Run command

```sh
npm start
# → http://localhost:8123/src/   (try ?mode=lifeful and ?mode=calm)
```

## What is stubbed

- Model calls are **simulated** (no network, no keys, no spend) — routing
  shows concept text only. Real provider wiring is D2+ work.
- `vault/` stays plain files Dave owns; the capture box files into in-page
  tasks + ledger checkpoints (persistence bridge = next).
- `pwa/` is a day-summary placeholder; `src-tauri/` shell compiles
  alongside but the web build is the testable app.
- No phone sync, no voice (mic affordance only), no Tauri device APIs yet.

## Next steps (priority order)

1. Persist capture → `vault/notes/` + `vault/tasks/ledger.json` (Tauri FS
   bridge or local-first sync), phone picks up mid-flight.
2. Real checkpoint/restore copy in UI ("leaving desktop?" button).
3. PWA phone view fed by the same packs + ledger.
4. Voice input path + standard-mode privacy option (post-hackathon).
5. Second screenshot pass after (1): capture-then-reload persistence proof.

Nothing submitted, nothing pushed — all local. Morning acceptance test: PASS.

## Update — app container + stability + motion pass (same day, per owner)

Owner: hates browser chrome, hates layout jumping between profiles, wants
Apple-smooth motion. Delivered:

- **Native window:** `npm run app` → Tauri window "Profiles" 1200x850,
  beforeDevCommand boots the :1420 server, no browser UI. Builds vendor
  packs via `npm run sync-packs` (`src/vendor-packs/`, beforeBuildCommand).
  `npm start` stays as web fallback.
- **Stable skeleton:** removed ALL per-mode reflow (no more calm/lite
  single-column rewrite, no wrap shrink, no hidden cards). Every mode shares
  one grid, same cards, same slots. Lanes reserve 600px, stream is fixed
  560px scrolling inside, govNote/loopCaption reserve lines. Switching
  profiles now changes palette + content in place — nothing below moves.
- **Change tracking:** brief accent ring (beacon) on meter/lanes/stream when
  content moves; skipped in still modes where the stream log speaks instead.
- **Apple-smooth:** .55s lane entrances with 70ms stagger, .6s themed
  property crossfades (bg/border/color/shadow), lifeful-only progress sheen
  (transform-only, 2.4s), chip/strip transitions. All transform/opacity-only
  keyframes; gov-freeze + prefers-reduced-motion still kill everything.
- Tests: 55/55 green (added Tauri/vendor/stability/motion block).

## Tauri window verified live

`npm run app` now opens a real native window (no browser chrome), verified
by monitor screenshot on desktop 2. Fixes needed on this box: missing
`src-tauri/build.rs`, missing `icons/` (generated), `WEBKIT_DISABLE_DMABUF_RENDERER=1`
(baked into the script). `npm test` 55/55 after all changes.

## Minimal redesign (same day, per owner: simpler like Google/ChatGPT)

- Ask-first UI: hero + search bar + 5 pills; tabs Ask/Agent/Activity/Settings.
  Agent (mono TUI log + stage chips) appears once you ask; verbosity follows
  mode — full in Life-ful (parallel lane lines), sparse in Chill, one quiet
  line in Low-Sensory. No lag: switch is a var swap, nothing reflows.
- Low-Sensory is now a softer dark, not cream. `?ask=` deep-link for demos.
- npm test 59/59. Old card-grid screenshots superseded by shots/ask-2026-10-27.png etc.


## Real-agent pass (2026-10-28, Muse Wonder session)

Dave asked for a proper agent behind the ask box. Built (spec: `SPEC-REAL-AGENT.md`):

- **`agent/sidecar.mjs`** — Pi-shaped local sidecar (sense→plan→act→verify→remember,
  checkpointed into the existing vault ledger). `npm start` mounts it at `/api/`;
  `npm run agent` runs it always-on standalone on :8799 (8787 was already taken on Desky).
  No network by default; cloud only with `PROFILES_ALLOW_CLOUD=1` + `PROFILES_API_KEY`.
- **`agent/ladder.mjs`** — model ladder bundled-tiny (heuristic classifier today, honest
  label, GGUF drop-in slot) → mobile ~0.5–1B → laptop 3–8B → cloud Contributor xhigh.
  Irreversible verbs (send/pay/delete/publish) escalate to cloud review + checkpoint +
  confirm, or are staged as drafts — verified live: "send an email…" staged, never sent.
- **`agent/tools.mjs`** — smart-extension registry gated per profile pack: calm gets
  file-task + stage-doc only; browser-act (Playwright/CUA) and Google Docs are registered
  but GATED OFF with named prerequisites; write-script stages scripts, never auto-runs.
- **`agent/staging.mjs`** — draft → Stage tab preview → export .md / real .docx
  (zero-dep OOXML writer, unzips as valid Word parts — tested). Slides stage as deck outlines.
- **Frontend** — Stage tab, Real-agent toggle (OFF default, labelled simulated fallback),
  suggest-first auto ("It's late — Chill?", Accept/Dismiss; announced-auto is a toggle),
  deep links `?agent=1&ask=…&tab=stage`.
- Proof: `npm test` **87/87**; live curl runs for file-task / letter / slides /
  irreversible; shots `agent-real-sidecar-2026-10-28.png`, `stage-tab-2026-10-28.png`.
- Stubbed honestly: GGUF tiny model (heuristic in its slot), cloud calls, Google OAuth
  export, browser driving, Tauri tray always-on packaging, preference engine.

## V3 canvas + real local brain (2026-10-28 evening, Wonder)

Dave's corrections, all built and verified:

- **Chat answers in chat now.** "hi r u agentic now" used to get FILED as a task
  (screenshot evidence). New `chat` intent: direct honest answer in a chat bubble;
  the sense→plan→act stream is detail in the Agent pane beside it. Self-questions
  answer from live status; general questions go to the local model.
- **REAL local model downloaded + wired:** Qwen2.5-3B-Instruct Q4_K_M GGUF
  (2,104,932,768 bytes, sha256 626b4a66…c62d) in `agent/models/`, answered via
  llama.cpp (`agent/localbrain.mjs`, spawn with stdin ignored — execFile hung
  90s, diagnosed + fixed). ~1.9s/answer on this PC. Brain wired in config slot A.
- **No settings trips:** lite agent ALWAYS ON. "help me get a better agent
  plugged in" opens a deterministic setup wizard on the canvas
  (`agent/system.mjs` allowlisted steps + `scripts/fetch-model.mjs` dry-run).
- **Canvas:** Chat / Agent / Browser (sandboxed iframe) / Document-Stage /
  Setup / Activity panes, align Chat|Split|Canvas, Focus pins a pane.
  Welcome = name + buddy in chat; Profile A/B meta slots (B clean); kids mode;
  guided mode; Advanced (whole-machine/fleet) gated inside Setup, OFF default.
- **Quiet learning** (`agent/learning.mjs`, pi-durable style plain files):
  dwell-based preferences (`vault/memory/events.jsonl` → `preferences.json`),
  suggestions learned-only, max once/session, dismiss = 24h silence remembered.
  The rapid-switch "r u tired" nag is DELETED. Repeated asks 3× become
  deterministic ⚡ macros in `vault/macros/` (verified: slides ask fast-paths
  from run 4, no model loop). "save all this for another day" = one-tap snapshot.
- **Research** (`agent/models.json`): Parakeet TDT 0.6B v3 real (GGUF ports),
  NeuDecide (neuphonic) real ONNX ~43MB-class experimental; "Nemotron 3.5 Bolt
  E4B" and "Minitron-2B" NOT found publicly — flagged, not packaged. Voice
  in/out wired today via browser speech (mic + read-aloud buttons).
- Proof: `npm test` 109/109; shots `chat-agent-answer-2026-10-28.png`,
  `canvas-panes-2026-10-28.png`. Vault learning/test data reset fresh for Dave.

## V4 corrections (2026-10-28 late, Wonder)

- **Slots are different people now.** `agent/slots.mjs`: vault/A vs vault/B —
  config, ledger, memory, macros, staging, snapshots all per-slot; switching
  rebuilds every pane (frontend `resetWorldView`). Proven both ways via API:
  A's task invisible in B, B's secret-santa invisible in A. B screenshot shows
  its own turtle/calm/empty world.
- **Canvas is seamless tiling, no view toggles.** Drag any pane header —
  tiles snap-swap with FLIP animation; browser-style pane tabs (close with ×,
  + Pane reopens, double-click tab maximises); layout persists per profile.
  Agent moves panes deterministically: "move browser next to chat",
  "maximise doc", "hide setup" — no model loop involved.
- **Feel/personality per mode + energy nesting:** Life-ful springy pop-ins,
  hover lift, ripples on ask, drifting brand; Chill 0.9s soft transitions +
  breathing; Focus 120ms linear, sharp corners; Lite animation killed for
  weak hardware; Low-Sensory static always (intensity forced soft — promise
  outranks fun). Energy Soft/Full/Overdrive/Chaos lives in Setup ›
  Personality, per-slot. Chaos = slow hue drift only; flash stays 0/s.
- **Model re-research** (`models.json` v2): "Nemotron 3.5 Bolt E4B" and
  "Minitron-2B" still not found publicly (HF + web) — likely Gemma 3n E4B +
  Nemotron conflation, and Minitron family is 8B/4B. Packaged instead:
  **LFM2.5-1.2B Q4_K_M downloaded** (731MB, sha256 b1b3de11…84f5, runs via
  llama.cpp; plain-prompt adapter caveat noted) as the lite phone/Chromebook
  tier, Qwen2.5-3B stays PC brain, Gemma-3n-E2B/E4B + SmolLM3-3B + Nemotron-3-Nano-4B in manifest.
- Proof: npm test 121/121; shots drag-tiles-agent-layout + slot-b-other-person.

## Production ramp (2026-10-28 night, Wonder)

- **Profile X added** (`vault/X`, ⚡): ringfenced power profile — piPower
  defaults, advanced on, overdrive, advised PC-standard+ brain. Same zero
  carry-across isolation (X notes proven invisible in A and vice versa).
- **Pin-to-move:** dragging headers is gone. 📌 in each pane header unlocks;
  drag; click anywhere lands + re-pins; layout persists per profile.
  Max 8 panes/page enforced (overflow prompts a fresh page).
- **Front door:** 🌐 Browse / 🔍 Search-Ask / 💼 Work cards arrange the
  canvas (also by voice/text: "open work"). Work houses Google Docs/
  Slides/Sheets + Word/PowerPoint web tiles in the Browser pane next to
  staged drafts — shell wraps them, no deep integration.
- **Agent detail toggle:** Detailed ↔ Sleek (hides stages/reasoning/tool
  calls), per profile.
- **Linkage:** light local co-use heartbeat (20s, visible-only, never
  leaves the machine) → `linkedGroups` (video+notes+chat). "Reorganise
  this" applies learned linkage or best-practice order, explains which.
- **Models:** Nemotron-3-Nano-4B GGUF (official NVIDIA repo) downloading;
  Gemma-3n-E2B/E4B + Minitron-4B added as fetchable options; people decide,
  recommendations update via models.json (PRODUCTION.md has the full
  Tauri/Rust/maintenance/update story). Sub-agent delegation was attempted
  for an isolation audit and blocked by the expired workboard root — the
  lead audited via API proofs instead (both directions).
- Proof: npm test 135/135; shots front-door-options + work-layout-apps.

## UX overhaul (2026-10-28 night 2, Wonder)

- **Profile strip:** A B C by default, active reads "Profile A", others
  just letters. D/E are a setting (Setup › Profiles). **Profile X is
  hidden** until opted in there, behind the full-access warning; when
  shown it sits far right with a gap, inverted + bold outline.
- **Pin fixed:** click 📌 and the pane is immediately live — moving the
  mouse glides it across neighbours, click anywhere lands + re-pins.
  (A leftover `head is not defined` runtime bug was caught via headless
  console and fixed; the app had silently stalled — now verified clean.)
- **Window manners:** every pane incl. Chat has – minimise and ✕ close;
  closed panes land in 🗑 Recently closed (titles + times, one-tap
  recover, per profile). Pane tabs also carry ×.
- **Brand:** Profiles logo is a menu (Settings / Personality / Profiles /
  Models / Snapshots / About); Customise became a ⚙ cog. Meter chip is
  just "100%" + bar — lanes are no longer quantified, they're implied.
- **No more name interrogation in chat:** name/buddy moved to Settings;
  it belongs to install/profile-click time, not every conversation.
- **Browser honesty:** work apps (Docs/Word/etc) now open in your REAL
  browser by default — Profiles stays the layer on top (chat/notes/
  staging keep working); in-app pane remains for straight-through pages
  + "Open in my browser ↗". The sandbox framing that felt shit is gone.
- **Voice fixed properly:** natural-voice picker (GB natural/neural
  preferred), mic answers auto-enable speak-back, real error bubbles
  (incl. the honest Tauri-webview-no-engine case + Parakeet path).
- **Nemotron-3-Nano-4B verified:** 2,837,072,864 bytes, sha256 be5d9a65…,
  correct llama.cpp completions; tracked job accepted.
- Proof: npm test 151/151, headless console clean, shots profile-strip-abc.

## Deep build: master spec + P1/P2 (2026-10-28 night 3, Wonder)

Owner called out rushing — fairly. Response: ONE master spec
(`SPEC-PRODUCTION.md`, audited status table, phases P1–P5 with gates),
then depth over breadth:

- **P1.1 template adapters DONE:** per-model prompt formats
  (chatml/gemma/lfm/llama3/plain) in `localbrain.mjs`. LFM now chats
  (0.85s), Nemotron chats (5.5s) — both verified live, not "manifest".
- **P1.2 brain picker DONE:** Setup › Models uses any downloaded GGUF
  per profile; others unaffected.
- **P1.3 PWA + hub DONE (device gate pending Dave's phone):**
  installable src/ (manifest/SW, API never cached), hub-URL setting so
  a phone remotes to the home PC brain.
- **P2.1 REAL PI BRAIN IN X DONE:** `agent/pibrain.mjs` spawns
  `pi --print` (Contributor), tools live, session durable in
  vault/X/pi-sessions, cwd ringfenced to vault/X. Verified: X used
  tools to read+summarise its vault (18s); slot A asking the same got
  the lite agent — the gate is code, tested both ways. (Two real bugs
  found+fixed on the way: --session vs --session-id; my own repeated
  test query legitimately became a macro.)
- **P2.2 private mode DONE:** per-slot, stops all learning recording.
- Gemma-3n-E4B downloading (tracked 279041a6) → P1.4 adapter+listing.
- Remaining per spec: P3 accounts/OAuth/docs-push, P4 Playwright/CUA
  (X, confirmed), P5 Parakeet. npm test 165/165.

## Brand + chrome (2026-10-28 night 4)

- **Logo:** PPP in three shades (calm/bold/vibrant) + colour-mix conic
  circle holding a *shaded silhouette* avatar (person default; fox/cat/
  turtle/rocket/leaf/robot/skull paths, always shaded, never coloured
  drawings). The mark IS the menu. Wordmark gradient, 800 weight.
- **Trash:** inline strip gone — 🗑 fixed bottom-right with count badge,
  popup inspector (title + date/time + recover). Retention per profile:
  newest 12 AND <14 days, self-pruning. No smart-cache magic needed at
  pane scale; policy is in code + tests.
- **Removed:** meter chip entirely (budget implied), Focus buttons and
  minimise (owner unsure — pulled pending a rethink, not half-kept),
  all "synthetic demo" boilerplate text, cog moved top-right.
- **Gemma-3n-E4B DONE:** downloaded (4,539,054,208 B, sha256 43b489bb…),
  gemma adapter chats cleanly (~4.4s) after an extraction fix. All four
  local brains now real options: LFM-1.2B / Qwen-3B / Nemotron-4B / Gemma-E4B.
- npm test 170/170. Spec status table updated for P1/P2 completions.

## Logo correction + orchestration (2026-10-28 night 5)

- Logo as actually specced: [human-silhouette icon] **PPP** tightly
  stacked (slightly larger) + "rofiles". The icon alone opens
  account/settings menu; default avatar = person head-and-shoulders
  silhouette everywhere (was fox — fixed in defaults + live slots).
- **Orchestration integrated, fleet pattern:** `agent/orchestrate.mjs`
  Scout/Worker/Critic bounded lanes (max 3, critic verifies, parent
  accepts, nothing irreversible). Trigger: "ultrathink / think hard /
  research this". Verified live (allotment question, 5.4s, lanes
  reported + critic line + parent synthesis).
- Fleet-wide: canonical note `Harness-Adapters/agents/profiles-orchestration.md`
  (mirrored to fleet shared agents), SuperPi skill gained a Profiles
  section (backup kept). Per-machine proof caveat preserved — this is
  documentation + desky code, not peer adoption claims.
- npm test 175/175.

## Simplification + QA pipeline (2026-10-28 night 6)

Owner vibe-check (annoyed, fairly): cut the clutter. Now default canvas =
clean Chat + real Browser + Document. Browse/Search/Work cards, chat
chips, bottom copy, agent-detail in-your-face: gone (agent pane opt-in).
- **Browser actually works:** Google can never be iframed (X-Frame SAMEORIGIN
  everywhere), so the pane is a real Playwright Firefox session — live
  screenshot view, click/type/back, google.com home. Verified in native
  window (real Google consent page rendering).
- **Life-ful renamed Vibes** (pack + pill + label).
- **Colour swap readability:** body ink no longer transitions — text flips
  instantly, only surfaces crossfade. Chill muted contrast bumped.
- **Trash recover data-loss bug:** reproduced in QA, root-caused to a
  layout clobber race (save response re-applied persisted layout), fixed
  with authoritative-local-layout guard. Pinned forever in
  `tests/qa/core-flows.mjs` (Playwright, headed+headless both 13/13) —
  the Atomic-Acres-style pipeline, now permanent (`npm run qa` next).
- **P3 built:** OS-keyring API keys (verified), per-profile cloud routing
  (labelled), Google OAuth PKCE + Docs push complete; live gate = Dave's
  own Google client creds. Repo: github.com/chickendavefifteen/profiles
  PRIVATE (xtgeorge69 does not exist on GitHub).
- Tests: unit 197/197, QA 13/13 x2. Everything pushed.

## Structural browser + honest agent (2026-10-29, verified)

Dave's screenshots proved: fake "warming up" answers + blank browser.
- Agent honesty: simulation path deleted from the codebase. Failed asks
  retry once, then say so — nothing filed, nothing invented.
- Router: bare "bbc news"/"sky news" open; bare topics search; spoken
  domains ("google dot com properly"); "open result N"; Google fallback.
- Browser architecture: singleflight sessions, headers-first MJPEG,
  per-request first frame, poster fallback, boot poster, wrapping headers.
- Pipeline enforced: BUILD stamp + Update pill + scripts/preflight.mjs
  (build-match, model present, live render) gating every future claim.
- Proof: unit 261/261, QA 27/27 headless AND headed, wire-decoded live
  frames read by eye, native window relaunched on desktop 2.

## Browser fits the window (2026-10-29)
- /api/browser/size + ResizeObserver: session viewport tracks the live pane
  rect; frames render at exact pane size (verified 498x400); clicks stay 1:1.
- Native window rebuilt + verified: Reasoning/pin in chat, live Google
  fitted in the Browser frame. QA 28/28, unit 262.

## Simplification + personalities (2026-10-29)
- Clicks fixed at the root: ensureSession was not exported, so every page
  click died (silently). One-word fix, verified {"ok":true} live.
- No Go buttons (Enter submits); icon-only + menu/tabs/paneheads
  (monochrome SVG, tooltips kept); Adwaita Sans semibold; logo 50% larger.
- Themes: calm deep warm dark, chill night plum, babylite soft blue/pink.
  Stacked pills/tabs/slots; per-mode pill colours retained; FOCUSMAX caps.
- Invites (all stilled in calm/babylite): Calm... breathing dots (30s),
  babylite jiggle (+busy nudge from live RAM/CPU), Vibes 5-scheme rotation
  (button 60s, theme 5min), FOCUSMAX lure pulse.
- Router: reply/repeat/say/tell-me stay chat. QA submits with Enter.
- Tests 270 unit, QA 28/28 headless+headed. Native rebuilt + verified.

## Chrome v2 + staggered invites (2026-10-29)
- Header: cog removed; trash top-right; sessions (stacked folders) with
  named saves grouped by "project:" prefix + safe restore.
- Adaptive toggle sits in the mode row with matching pill styling.
- Invites staggered (calm 30s, babylite 45s, vibes 60s, focus 75s) +
  learned pill-glow from dwell patterns (30min cap, silence-aware).
- Mode arrivals: hard cut (calm/babylite), gentle settle (chill),
  staggered celebration (vibes/focusmax/xmax).
- Tests 277 unit, QA 29/29. Native rebuilt + verified narrow.

## Truth-sync + macro scope (2026-10-29)
- Browser lied (chat said BBC, view showed Google): frozen MJPEG looks
  alive forever. /api/browser/state + 4s frontend sync + re-stream on
  every tool nav — the view cannot silently disagree again.
- Macro hijack: repeated tool asks ("go to...") became no-op macros
  claiming Done (my own QA created it by asking 40x). Fast-path now
  file/stage only; reset clears macros+events; bogus macros deleted.
- Proven 5x consistent browser_open; tests 282, QA 29/29 x2.

## Smooth browser + stall-proofing (2026-10-29)
- Measured Qwen2.5-3B Q4: ~4.5GB peak RSS, 0 VRAM (CPU-only llama build).
- Browser behind the scenes: Chromium headless-shell via Playwright, one
  persistent profile per slot, CDP screencast MJPEG viewed+driven as one actor.
- Frozen-frame fix: frame counter + 12s stall re-attach; stream parks when
  its pane hides; everyNthFrame 3/q68; /browser/state carries frames.
- Clicks: /mouse endpoint verified live; native drag-eat prevented.
- Tests 285 unit, QA 30/30. Pushed.

## Native iframe browser rework (2026-10-29)
- Replaced MJPEG screenshot-streaming with a framing proxy + native
  iframe (GPU rendering, real clicks/typing, zero encode). Agent keeps
  the invisible CDP actor session for tools/reads/search.
- Solved the white-pane mystery: Tauri CSP blocked the frame (bundled
  origin tauri:// vs http) — added frame-src, rebuilt.
- Solved the click trap: inline display:flex defeated hidden; global
  [hidden] rule + Retry fallback.
- Search moved to Bing (Google sorry-pages automation; DDG challenges).
- QA rewritten for iframe (native click+type proven in Chromium).
