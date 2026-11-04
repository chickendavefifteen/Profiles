# Profiles

Local-first reading, browsing, writing and agent workspace. Meta Global AI Hackathon, Indie track. Synthetic demo data only; no employer data.

## Status

> Continued development — semi-working preview. It runs and demos end-to-end, but still needs debug, polish and refinement going forward.

## Run

Building requires Node.js, the npm dependencies (`npm ci`), and the platform Tauri prerequisites. A copied native executable can run basic browsing and local document reading without Node.

- Native development: `npm run app`.
- Embedded-frontend binary: `npm run app:build`, then `PROFILES_HOME="$PWD" src-tauri/target/debug/profiles`.
- Optimised binary: `cargo build --release --manifest-path src-tauri/Cargo.toml`; executable at `src-tauri/target/release/profiles`.
- Web: `npm start`, then `http://localhost:8123/src/`.

The native shell uses the OS webview rather than bundling Chromium. When Node and project resources are available through `PROFILES_HOME`, it owns a sidecar on a private loopback port and verifies that the responding process is its own child. Closing the shell stops only that child. If the optional backend is absent or cannot start, the app still opens: a built-in basic agent can navigate/search/read the native browser, local documents remain readable, and profile/mode/layout preferences stay on the device. API/local-model inference, notes and staging require the backend; unavailable features are labelled, never simulated. Set `PROFILES_NO_SIDECAR=1` to exercise this standalone route.

The web server binds to loopback by default. `PROFILES_BIND` is an explicit remote-binding opt-in; do not expose this unauthenticated personal workspace on an untrusted network. Static serving excludes the vault and backend source.

## Browsing architecture

Desktop browsing uses a genuine child webview inside the browser pane: WebKitGTK on Linux, the platform Tauri webview elsewhere. It loads the original HTTPS site, including scripts, cookies and forms. It is not an HTML-rewriting proxy and is not VNC.

Each tab owns a live document with separate history, unsaved forms, scroll and zoom. Switching tabs shows the existing document without navigating again; closing disposes it. Cookies/storage are shared by tabs belonging to the same person, never between people. Tab documents live for the current application session; website storage remains persistent.

The agent operates the displayed tab through a bounded local command bridge. Requests retain their originating person/tab; closing or switching cannot silently retarget an old action. Remote pages cannot invoke the app's privileged browser commands. Links requesting another window create a new in-pane tab.

The web frontend displays a live JPEG stream from the selected tab's headless Chromium/Playwright page. All tabs for a person share one private context. Pointer, keyboard and agent actions use those same pages. Changing tabs closes the previous stream without killing the new one.

Websites can still refuse an engine, require login, or require unsupported DRM. Profiles reports real failures; it does not manufacture a successful page, silently replace a blocked website with a feed, or bypass access controls.

## Everyday controls

- Ask **“show Channel 4 website”**, **“open Sky News”** or a full URL: known destinations open directly in the browser pane without a second instruction. Unknown destinations search rather than opening an arbitrary first hit.
- The address bar accepts a URL or a search. Search results and subsequent navigation use the same live page.
- **Ctrl + wheel** inside the browser changes only its content zoom, 50–200%. The browser's A−/A+ buttons do the same. Other panes and the app background have separate scaling targets.
- **−** minimises a pane to its tab; click the tab to restore its existing content. Closing uses the bin/recovery flow instead.
- Double-click a pane tab to maximise/restore it. Unlock with the pin, drag edges to resize, then pin again.
- Tap **Super/Windows** alone to highlight/unpin all visible panes. Resize an edge or drag a pane header; releasing the adjustment locks it. Otherwise, the next key or click exits. Held Super shortcuts remain available.
- **+ / Ctrl+T** opens a browser tab; **Ctrl+W** closes it; **Ctrl+Tab / Ctrl+Shift+Tab** cycles tabs; **Ctrl+L** selects the address. Tabs also have close buttons and support middle-click close. Back, Forward and Reload operate on the selected tab.
- Hold **Super + A/B/C** to select a person/profile; **Super + 1–6** selects a mode even while an input or browser page is focused. Profile X and xMAX must first be enabled. Tapping Super alone enters adjustment, not a latched shortcut; the next key only locks the layout. A compositor-reserved shortcut may intercept the held combination.
- Babylite and Calm disable app animation; reduced-motion is respected. Explicit mode choices persist.

## Agent models and activity

The native app and `npm start` default to **demo mode** (`PROFILES_DEMO_MODE=1`): the only model route is `muse-spark-1.3-contributor` at `https://api.meta.ai/v1`, with **xhigh** reasoning. Saved local models, alternate cloud endpoints and lower efforts cannot override this. Missing credentials/provider failures remain failures, not local or Basic-tool model substitutions. Deterministic navigation commands still identify that no model was called.

`PROFILES_DEMO_MODE=0` explicitly restores the optional non-demo model picker:

- **Basic tools (no model):** deterministic website/search/document commands. This is not an LLM and does not pretend to be one.
- **Muse Spark 1.3 Contributor:** per-profile API key stored in the OS keyring. Default API base `https://api.meta.ai/v1`, wire model `muse-spark-1.3-contributor`. Contributor prompts may be used for training. Plain Muse Spark 1.3 and OpenRouter are refused.
- **Local endpoint:** an explicitly configured, already-running loopback OpenAI-compatible endpoint.
- **Installed GGUF:** explicit model selection; one-shot llama.cpp CPU inference, two threads, no GPU offload. No automatic server/model download, hidden provider substitution or cloud fallback. Large models are unavailable when free memory is insufficient.

Model turns can use bounded real browser/document tools. Conversation context is bounded, held per profile in memory, and excluded in private mode. Switching models does not load weights until an ask needs them.

Browser actions operate on the displayed tab: click a CSS selector, exact label or viewport coordinates, type into an explicit field, and submit with Enter. Missing/disabled controls fail rather than clicking/typing elsewhere. Native page keys currently support Enter, Tab/Shift+Tab and Escape; unsupported keys report an error. Native Linux screenshots contain actual visible-page PNG pixels; full-page capture is unsupported. Screenshot tool results now supply bounded PNG pixels to the model's next multimodal request, not just a filename. Images remain invocation-local, outside conversation history and activity traces. Page text and pixels are untrusted content; credentials and external/account actions still require the relevant owner confirmation.

**Traces** shows actual progress and provider-returned reasoning summaries when available; enabled by default. **Tools** shows tool-call detail; disabled by default. These are live events, not simulated thinking, invented reasoning, or access to hidden chain-of-thought. Provider capabilities differ.

## Documents and local state

Choose a local file or enter a document URL. PDF uses vendored PDF.js with a single fitted canvas, page navigation and selectable page text. DOCX/ODT expose paragraphs and tables; XLSX exposes bounded sheets/cells; PPTX exposes slide text. TXT, Markdown, inert HTML, CSV and JSON have local reading views. This is basic document reading, not pixel-perfect Office layout, OCR, macro execution or an Office editor. Legacy `.doc`/`.xls`/`.ppt`, encrypted and malformed files report their limits.

File/download size is capped at 10 MiB; archive expansion, rendered blocks, tables and PDF canvas size are bounded for low-memory devices. Full-backend URL reads use a bounded local byte-fetch endpoint, not a cloud converter or executable proxied document. Standalone URL reads require the source to permit CORS; local file reading does not. PDF.js and fflate are pinned npm dependencies copied locally by `npm run sync-docs`, with their licences in `src/vendor/documents/`.

Pasted text can be staged and exported as Markdown/OOXML `.docx` with the backend. Notes and sketches remain local. Opening a binary reader does not falsely tell the agent that the whole document was extracted or summarised.

Per-person state lives under `vault/<slot>/`. `PROFILES_VAULT_DIR` selects a separate vault for isolated QA. Never commit personal vault contents, browser stores, model weights or API keys. Secrets stay in the OS keyring; `PROFILES_DISABLE_KEYRING=1` disables keyring access during automated QA.

## Verification

```sh
npm test
npm run verify
npm run app:build
# After building the release binary:
npm run verify:native
```

`npm run qa:tabs` verifies live unsaved forms, JavaScript state and scroll survive tab changes without a reload; independent history; profile cookies; popup creation/close; stale-action rejection; and Super adjust/dismissal. It runs automatically in `npm run qa`. This is headless Chromium evidence, not a substitute for the explicitly approved native WebKit run.
With fresh owner permission for a disposable isolated native window, `PROFILES_NATIVE_QA_APPROVED=1 npm run qa:native` exercises the actual release executable against local HTTP fixtures. It requires `agent-isolated-desktop`, bubblewrap and the installed GTK/WebKit runtime; it refuses a GPU-visible fallback, uses private state with keyring disabled, and checks owned-process teardown. It is deliberately excluded from the automatic headless gate. Real provider inference and public-site checks are separate explicit canaries, not mocked or asserted by this local regression suite.

The suites own disposable servers/vaults and exercise live navigation, clicks, typing, minimise/restore, zoom ownership, sticky modes, shortcuts, model choice, resizing, touch-sized layouts and real documents. `tests/qa/native-actions.mjs` exercises the exact script embedded in the native binary against real controls and default HTTP form submissions; it does not replace a native shell run. Retry/page-error recovery, stale navigation completion and profile-selection races have deterministic behavioral regressions. Linux rendering checks require bubblewrap and hide GPU devices; software flags alone are insufficient. Native GTK behavior also requires an isolated native smoke run—Chromium tests do not certify it. See [QUALITY-GATES.md](QUALITY-GATES.md) for the native/device-isolation protocol and [QA-REPORT.md](QA-REPORT.md) for exercised evidence.

Chromebook target: 11–13-inch touchscreen, Celeron, 4GB RAM, usually 2–2.5GB free. Desktop software-rendered and narrow/touch tests are useful coverage, **not** evidence of execution on that physical Chromebook. No physical Chromebook or phone release is certified by desktop tests.
