# Profiles Quality Gates — enforced, not aspirational

Every user-visible claim passes ALL of these, in order. A red gate stops
the line; nobody (Dave included) has to discover breakage by clicking.

## G0 Unit (fast, every change)
`npm test` — zero-dep checks: packs, governor, slots isolation, tool
registry, ladder, staging/docx, orchestration, tool router phrasing
matrix (incl. typos: "brower", "bc news website", "take me to…").

## G1 Behaviour QA (Playwright, headed + headless)
`npm run qa` / `npm run qa:headed` — real Firefox driving the real UI:
- chat answers in chat (never files a question, never "sidecar not reachable")
- agent tool asks act: "open a brower on bbc news" shows BBC in the pane
- browser: Google search page actually renders (bot-wall = FAIL),
  click lands on the clicked element (contain-mapped), typing reaches
  the page (click box -> keys -> text present), back works
- "go to bc news website" in chat drives the Browser pane to BBC
- close -> Recently closed -> recover RESTORES (data-loss regression)
- resize: flex share moves, neighbours adapt, zero overlap (measured px)
- mode swap: ink instant, calm static, zero page errors (console gate)

## G2 Visual (screenshots read by a human/agent eye)
Headless shots per changed surface at desktop size; read them, don't
file them blind. Framing rule: page content `object-fit: contain`,
never cropped.

## G3 Native (Tauri)
Rebuilt binary launched on desktop 2; agent must answer (shell spawns
its own sidecar — kill :1420 first and prove the app revives it);
browser pane loads Google clean (consent auto-rejected).

## Gotchas (paid for in blood, keep)
- `scripts/preflight.mjs` runs before every QA/screenshot/launch claim:
  server build stamp must match disk (stale servers certifying old code
  was the whole "it works for you, broken for me" class). RED = stop.
- First MJPEG chunk is the multipart header text, not a JPEG — any
  "first bytes" validation must parse a full part (Content-Length).
- Concurrent cold starts double-launch Chromium on one profile dir and
  the loser blocks on the Singleton lock with zero bytes out. Singleflight
  session creation + stale-lock cleanup on launch.
- CDP screencast emits on repaint only: idle pages starve frame-waits.
  Liveness = proof screenshot render; every /stream consumer gets an
  instant first frame; response headers go out BEFORE frame prep.
- Firefox fetch() does not stream multipart bodies to readers — assert
  the contract (img wired to stream URL + poster decodes), not the quirk.
- Headless virtual-time screenshots hang forever on infinite streams —
  use Playwright screenshots for visual proof, never chromium --screenshot.
- Google bot-blocks headless Firefox -> persistent HEADED Chromium
  profile per slot is the browser; headless = search API only via DDG.
- All search engines X-Frame SAMEORIGIN -> never iframe Google.
- object-fit: cover crops screenshots -> clicks map wrong. Contain +
  letterbox math, always.
- Persisted layout in config responses clobbers local UI state ->
  local layout is authoritative after first load (trash-recover bug).
- execFile holds stdin open -> llama hangs 90s. spawn + stdio ignore.
- Node module caches: dynamic imports in a long-lived sidecar serve
  stale code after edits -> restart servers, verify start times.
- Mode colour transitions on body text = unreadable mid-swap -> ink
  never transitions; surfaces do.

## Native rule (the frozen-frontend gotcha, 2026-10-29)
The Tauri window runs the frontend BUNDLED at binary build time — editing
src/ does NOT change what the window shows until `cargo build` re-bundles
and the window relaunches. An entire afternoon of "still broken" reports
traced to testing a morning binary. Hence, before ANY native claim:
1. `cargo build` in src-tauri (or `npm run app:build`),
2. relaunch the window fresh,
3. read Setup footer: "sidecar build X · up HH:MM · UI loaded HH:MM" —
   UI-loaded must be NEWER than your last src edit, sidecar-up newer
   than your last agent/ edit, else you are testing the past.
Headless QA can never catch this (it always loads live disk files).

## Release rule
Commit + push to the private repo only when G0+G1 pass; G2/G3 for
anything user-visible. "It works via curl" is not a gate.
