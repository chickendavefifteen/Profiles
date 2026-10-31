# Profiles quality gates

A green web suite does not certify the packaged app. Run each affected surface and inspect its output before handing over a candidate.

## Automated stack gate

`npm run verify` owns disposable servers and vaults. It runs:

1. Preflight: actual health/build identity, model availability, and a local fixture opened/rendered by the owned headless browser.
2. `npm test`: pack/governor/router/document contracts, model selection/tool boundaries, native lease isolation and asynchronous frontend profile-switch regressions.
3. `npm run qa`: real frontend navigation, agent-to-browser action, click/typing on the same actor, minimise/restore, retained draft/history, Calm persistence, held/latched Super shortcuts, model selection, browser-only zoom, desktop/touch viewport fit, and border dragging while held plus persistence.
4. A separate disposable proxy/local-fixture click round trip.

`node tests/qa/documents.mjs` exercises real PDF pages/canvas/text, Office paragraphs/tables/cells/slides, inert HTML, malformed/unsupported files, cross-origin byte fetching without source CORS, byte/resource limits, superseding reads, profile privacy and narrow-screen fit. Vendor assets must match the pinned packages: `node scripts/sync-document-vendor.mjs --check`.

Every failure exits nonzero. There is no pin/gate split that returns success with named failures, no source-string certification, no numerical test-count parsing, and no shared slot-E reset. The obsolete core-flows/overnight-gates harnesses were removed; use the commands above.

Default automation is headless and muted. Linux QA/preflight/verify entry points re-execute under bubblewrap with GPU devices absent from `/dev`; they select Mesa/llvmpipe (including Mesa EGL when installed). Missing bubblewrap fails closed on GPU-equipped Linux. Rendering flags alone did not prevent GTK/Xvfb from opening NVIDIA/DRI devices in an earlier run. Never open a host browser, touch its input/profile, or use the owner's GPU for verification. Explicit `preflight --port PORT` only probes that existing server; it does not kill/restart it or create a browser session.

## Native gate

Build the actual candidate with `cargo build --release --manifest-path src-tauri/Cargo.toml`. `npm run verify:native` additionally checks release-binary freshness against embedded frontend and Rust inputs. Freshness is not a runtime proof.

Launch the release binary only in the verified isolated desktop with fresh XDG/browser/vault state and muted/unavailable audio. On Linux, put **the entire isolated-desktop launcher, including Xvfb**, inside a bubblewrap `/dev` namespace without NVIDIA/DRI/KFD nodes; select Mesa GLX/EGL and llvmpipe. Assert device absence in the test process and audit the owned scope's device handles. Never disable the WebKit sandbox. Confirm the *visible* Profiles window ID: GTK also creates an invisible leader window named Profiles, and resizing that leader proves nothing.

Exercise and inspect:

- A requested site/fixture opens in the displayed native browser without a second instruction.
- Native viewport remains inside its pane, including after resizing the real window.
- Ctrl+wheel changes browser zoom without scaling the neighbouring pane or app chrome; A−/A+ stay in sync.
- Super shortcuts work from the native page as well as app inputs; the tapped sequence is also checked.
- Minimise/restore leaves the agent usable and preserves the browser's actual page/form state.
- Profile changes cannot redirect an earlier profile's pending command into the new person's browser.
- Errors identify real failures, not a manufactured successful page or a substituted news feed.
- Repeat basic navigation, page reading and profile/mode persistence with `PROFILES_NO_SIDECAR=1`; no optional backend must mean reduced capability, not a dead app.
- Open real PDF/Office fixtures in the native document reader. Check PDF worker/CSP/font loading in WebKit, not just Chromium.
- For a current-page model question, observe that the answer uses the displayed fixture title and that its URL remains unchanged; a guessed example URL is a failure.

Close the owned app and its sidecar; verify no test processes survive. Do not kill the owner's existing app/server.

A low-memory approximation can cap only the owned isolated desktop's cgroup to `MemoryMax=2500M`, `MemorySwapMax=0`, `CPUQuota=100%`. Record current/peak memory and the actual local inference/browser outcome. A Desky CPU core is not a Celeron, and this cap is not physical Chromebook certification. Never change the owner's desktop resource limits.

## Native-specific failure classes

- Tauri's Linux GtkBox child backend ignores coordinates. The overlay allocation must be tested in GTK, not inferred from Chromium DOM bounds.
- A GTK size request is a minimum, not a maximum. Constrain all four overlay margins to prevent WebKit natural size overflowing a pane.
- Tauri hashes style blocks; CSP can consequently ignore `unsafe-inline` for HTML style attributes. Keep the explicit style-attribute policy and verify actual computed native layout. Never relax script policy to fix layout.
- Browser state/zoom/shortcut delivery requires scoped Tauri event-listener permissions for the trusted main webview. Remote page webviews receive none.
- The binary embeds its frontend. Restarting only Node does not update an older binary. Node also caches imported modules: restart the owned sidecar after backend changes.
- Native broker sanitisation must resolve every accepted job, including null or malformed payloads. Clearing its timeout before a throwing conversion can otherwise strand the ask indefinitely.
- Only `browser_switch` selects the native person. Ensuring/resizing a view must not select or reveal it. Queued reveal/zoom work captures the frontend generation and person; Rust refuses revealing an inactive person's view. Switch A → empty B while A contains an identifiable page, then return A with its browser minimised.
- Native document fetches are cross-origin from `tauri://localhost`; raw byte responses need the same trusted-origin CORS handling as JSON. Same-origin web tests alone miss this.
- Local-file conversation history uses real chat-template roles, not previous questions flattened into the current user message. Require answer text in the constrained schema and smoke a grounded page question followed by an unrelated question.
- A chat following its latest answer must stay at the bottom when pane/window dimensions change; resizing must not silently hide the completed answer below the viewport.
- Headless Chromium must not inherit an ephemeral or host desktop D-Bus connection. The observed failure was `FATAL:dbus/bus.cc:1245: D-Bus connection was disconnected`. `npm run qa:linux-browser` starts its own disposable bus, kills it, then verifies the browser still performs a real click and changes page title. Linux `verify` includes this regression.
- Native-shell sidecars never fall through to an unseen Chromium actor when their bridge disconnects. Agent admission waits for the displayed browser's lease; failure leaves the chosen actor unchanged.
- Navigation reveals the actual view as soon as the engine accepts it. A main-document title is sufficient to expose a usable document while subresources continue loading; a permanently pending image must not turn a usable page into a hidden 22-second timeout. Test with a controlled unfinished resource, not only fast public sites.

## Stream and state invariants

- The web viewer and agent use one Playwright page, not separate hidden browsers.
- A multipart header is not a JPEG. Read a complete image part, and inspect actual click/typing effects.
- CDP acknowledges each frame with its session ID. An idle page need not emit another frame; a current screenshot provides the initial proof.
- The last stream viewer disconnecting stops encoding; restoring reconnects to the existing actor page.
- Profile identity is captured per request and native navigation poll; a later global slot switch cannot change that request's person.
- Persisted layout applies on initial load/world switch, not on every config response. Explicit mode selection must not be overwritten by a late config response.
- A browser action may complete before a connection fails. Never automatically replay a failed ask or claim no side effect occurred without evidence.

## Honest evidence

Record commands, observed outcomes, candidate path/hash and inspected screenshots in `QA-REPORT.md`. Distinguish desktop software rendering, touch emulation, real local CPU inference, real provider inference and physical Chromebook/phone execution. No key means no claim of live cloud-provider verification. Third-party access restrictions and DRM are not bypassed to make a gate green.
