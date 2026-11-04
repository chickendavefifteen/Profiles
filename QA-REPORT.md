# Profiles verification

## Independent tabs, Super adjustment and Contributor demo — 2026-11-01

Candidate: preserved `fix/profiles-prof-reliability-20261031` lane, HEAD `43c0dc48a4d4013d952ec49c642459840d136bfd` plus the uncommitted repair and feature work. No reset, commit, push or host-window restart.

- Embedded frontend tag: `43c0dc4+tabs-contributor-20261101`.
- Release executable: `src-tauri/target/release/profiles`, **6,547,056 bytes**.
- SHA-256: `70b48aec094ba33ccb9372f3d09c9fadfc5f60a2b4489423692b5e1df2e6f302`.
- The existing `profiles-app.service` was observed **inactive**, with `MainPID=0`. No visible desktop deployment is claimed.

### Implemented behavior

- Browser tabs own separate live documents, history, forms, JavaScript state, scroll and zoom. Same-person tabs share browser storage; people have separate stores. New/close/cycle/address shortcuts, popup tabs, Back, Forward and Reload target the selected document. Closing the final tab creates a new blank tab.
- A lone Super/Windows tap highlights/unpins visible boxes. Header/edge gestures remain available and lock on release; the next ordinary key/click locks without clicking through. Layout adjustment freezes geometry animation. Held Super profile/mode shortcuts remain; the obsolete tapped shortcut latch was removed because its next-key behavior conflicts with adjustment.
- Requests capture originating tab/session ownership. Superseded selection/poll/navigation results cannot overwrite newer selection; disconnected native leases cannot adopt a replacement app. Queued hidden-stream input and stale web mutations fail rather than acting on another document.
- Native and web agents use their displayed browser actor for click/type/press/read/search and screenshots. PNG pixels are supplied to the next model request as actual multimodal input. Ordinary browser actions and model screenshots no longer save PNG/JSON receipts; explicit confirmed legacy receipt operations remain separate.
- Native startup and `npm start` default to Contributor-only demo mode at **xhigh**. Saved local models, normal-tier model names, endpoints and lower efforts cannot override it. The badge/picker use authoritative demo policy; missing credentials/provider errors do not substitute another model.

### Observed checks

| Check | Result |
| --- | --- |
| `cargo build --release --manifest-path src-tauri/Cargo.toml` | Passed |
| Final `npm run verify:native` | **8 passed, 0 failed**; headless stack plus release-bundle freshness, not an actual native-window run |
| DOM-free suites | 94 core, 155 model/tool, 67 broker checks passed; frontend lifecycle/ownership suite passed |
| Real independent-tab QA | **17 scenarios passed**: retained forms/JS/scroll, independent history, cookies, popup/close, rapid selection, stale mutations, transient pixels and Super gesture handlers |
| Real CDP/JPEG lifetime QA | Both disconnect-during-setup scenarios passed; live replacement viewer preserved; final viewer stopped its encoder |
| Existing reliability, document and native-action-script suites | Passed within the final composite gate |
| Actual demo entry point/UI | Persisted local-file/normal-tier/low-effort settings still produced Contributor xhigh badge and sole model choice; missing key failed honestly |
| Live Contributor xhigh vision canary | Model counted **RED=3** from a canvas-only screenshot without accessible shape-count text; cloud metadata confirmed Contributor/xhigh |

The first extended tab run caught a resize assertion failure; adjustment now disables geometry animation, and subsequent extended/composite runs passed. The first composite gate also caught a preflight consumer of the removed disk-backed poster endpoint (7/1). Preflight now validates a transient PNG from its own fixture; the final composite result above is the subsequent 8/0 run. Failures were not counted as passes.

Inspected headless screenshots: `/tmp/profiles-tab-evidence-jMOk2Y/independent-tabs.png` and `/tmp/profiles-demo-evidence-Pn0eWk/contributor-xhigh-demo.png`. Final composite tab screenshot: `/tmp/profiles-tab-evidence-an70NH/independent-tabs.png`. These are synthetic local fixtures in temporary evidence directories. The live vision result is retained at `runtime/omarchy/evidence/browser-repair-20261101/contributor-vision-tabs.json`.

**Acceptance still open:** no fresh approval was received for this candidate's isolated GTK/WebKit run. `tests/qa/native-desktop.mjs` now includes native tab/form/history/cookie/popup/close scenarios, but those additions have **not been executed**. Simulated native events in Chromium do not certify actual GTK Super focus, move/resize delivery, or native tab storage behavior. The earlier repair-only native passes below remain historical evidence, not acceptance of these new features.

All current rendering verification was headless, muted and GPU-device-hidden, with temporary vault/browser state. The live model canary used the normal internal authentication route, without tool inspection/copying of credential values. No host input, host audio/GPU verification, personal browser profile, native launch or service restart was performed for this feature candidate.

---

## Browser and agent repair — earlier 2026-11-01 baseline

Current source: existing `fix/profiles-prof-reliability-20261031` lane, HEAD `43c0dc48a4d4013d952ec49c642459840d136bfd` plus the preserved enhancement work and this uncommitted repair. No existing user work was reset or published.

- Embedded UI tag: `43c0dc4+browser-repair-20261101`.
- Release executable: `src-tauri/target/release/profiles`, **6,536,960 bytes**.
- SHA-256: `3360d2e40bd04fd822817f76974ded5114467e420cee0bea52b86e0e6a952e36`.
- The owner's existing host window was not driven or restarted by this repair session. This identifies the rebuilt candidate, not a claim that an older running process has reloaded it.

### Defects corrected

- WebKit replacement/redirect cancellation is no longer a terminal page error. Real load failures still surface; the previous failed-page snapshot no longer prevents the next navigation or Retry.
- Superseded navigation completions and delayed initial profile selection cannot overwrite the new page/profile. Retry reissues the exact profile-local address.
- A document title can arrive before its body. Native reads now wait for DOM parsing, not the full resource load; a pending image does not block an otherwise usable page.
- Native click/type/press wait for actual page evaluation results. Missing/disabled targets, unsupported keys and invalid selectors do not silently click/type elsewhere. Enter performs real default form submission.
- Corrected the public browser action argument routing. Tool failures propagate to the agent; they no longer hide or poison an otherwise usable native page.
- Native Linux screenshots now return actual visible-page PNG pixels. Full-page requests fail explicitly. A text-only model is not falsely described as having seen those pixels.
- Removed mock-success/HTTP-only action assertions. Regressions inspect actual page changes and failure behavior.

### Exercised checks

| Check | Observed result |
| --- | --- |
| `npm run verify:native` | 8 passed, 0 failed, including native bundle freshness |
| DOM-free suites | 94 core, 68 model/tool, 47 native broker checks; frontend lifecycle suite passed |
| Headless UI reliability | 63/63 passed; actual agent click, typing/Enter and missing-target behavior |
| Document reading | 64/64 passed |
| Embedded native action script | Real DOM controls and both default HTTP form-submission paths passed |
| `PROFILES_NATIVE_QA_APPROVED=1 npm run qa:native` | 8 native regression scenarios passed; private state and owned-process teardown |
| Live cloud application route | Contributor inference answered 17 × 19 = 323; model clicked/read the actual page and honestly reported a missing target |
| Live native application + cloud model | Contributor changed the displayed WebKit title to `NATIVE-CLICK-CONFIRMED` and read it back |
| Exact owner Bing address | `https://www.bing.com/search?q=sky%20news` rendered actual Sky News search results |
| Native agent web search | Returned real results, stated a reason for selecting the official Sky News homepage, opened it and read its live title |

The native runs used the actual release executable inside owned Xvfb/private-D-Bus sessions, with GPU devices hidden before launch and test audio disabled. The retained native suite checked both native app and sidecar `/dev` contents and GPU handles, and confirmed their termination. No host input, personal browser profile or user vault was used. The separate live inference canaries used the application's normal internal authentication route; no credential values were inspected or copied by the repair session.

Evidence is retained under ignored `runtime/omarchy/evidence/browser-repair-20261101/`: actual search/native PNGs, live cloud observations, native regression results, the initial failing premature-body-read result, and the corrected final native result. The initial failure is retained, not counted as a pass.

Limits: native page keys currently support Enter, Tab/Shift+Tab and Escape; other keys fail honestly. Screenshots are visible-page only. Capturing an image does not establish model vision. No physical Chromebook certification, remote publication or host-window deployment is claimed.

---

The following is the historical **2026-10-31** candidate report. Its binary hash and earlier limits are not the identity of the current repaired candidate.

## Candidate

- Lane: `profiles-reliability-prof-20261031`; branch `fix/profiles-prof-reliability-20261031`.
- Base: `b01fb79921b468f313ded606d4f6449a97234034`.
- Optimised executable: `src-tauri/target/release/profiles`, **6,478,776 bytes**.
- SHA-256: `544dcf24ed8053080f06e8144858e599d7ddeeb105039174ea8936849124bf77`.
- A separate copied executable was also exercised with project/backend resources deliberately absent. The executable uses the installed OS webview; it does not include Chromium, Node or model weights.

This report replaces the historical pin/gate reports. Passing only existing pins while target behavior remained broken is no longer a successful release gate.

## Automated results

`npm run verify:native && node scripts/sync-document-vendor.mjs --check` completed successfully on this candidate:

| Check | Observed result |
| --- | --- |
| Composite native verification | 8 passed, 0 failed |
| Core behavioral checks | 94 passed |
| Model/tool contracts | 57 passed |
| Native broker contracts | 40 passed |
| Native frontend races/readiness | Passed |
| Live web reliability scenarios | 53/53 passed |
| Real document scenarios | 64/64 passed |
| Desktop D-Bus lifetime regression | Browser remained interactive after the disposable bus was killed |
| Document vendor provenance | Exact pinned assets and licences matched; unexpected extra files rejected |

Verification owned disposable PID/build-identified servers, private vaults and browser state. It exercised real local pages, pointer/keyboard interaction on the same actor page, URL/search navigation, per-pane zoom, held edge resizing and persistence, minimize/restore with retained draft/history, mode persistence, profile shortcuts, model choice, touch/narrow layouts, and actual PDF/Office contents. No shared server or user profile was reset. The native freshness check passed against the embedded frontend and Rust inputs.

The document scenarios cover actual PDF pages/canvas/text; DOCX/ODT paragraphs and tables; XLSX sheets/cells; PPTX text; TXT/Markdown/CSV/JSON and inert HTML. They include malformed/unsupported files, fetch failures, bounded input/decompression/rendering, superseding reads, privacy and narrow-screen fit. These are basic reading views, not pixel-perfect Office editing or OCR.

## Actual Linux native runtime

The final native runs used the release executable inside an owned Xvfb/private-D-Bus session, with the entire launcher inside a bubblewrap `/dev` namespace. NVIDIA/DRI devices were absent; Mesa EGL/GLX and llvmpipe were selected. Device absence was checked against both running app processes, and the owned native scope was audited for GPU device handles. Test audio was unavailable. No host window, input, clipboard or browser profile was used.

Observed in the final device-hidden native runs:

- The copied executable with a missing Node backend opened **Channel 4 on the first “show channel 4 website” request**. The actual site and its real consent screen appeared inside the pane. No cookie acceptance was automated.
- The basic fallback identifies itself as **Basic tools (no model)** rather than pretending to be a local LLM. Profile B/Chill settings survived restart in the private test state.
- From a focused document URL input, Super+A switched to Profile A. A had its own empty browser and chat, not B's Channel 4 page or document. Calm remained selected in A.
- A restored agent retained the typed question, accepted Enter, and displayed **“Two plus two equals four.”** after the actual window was resized to **1024×700**. The completed answer remained visible.
- Ctrl+wheel inside the native browser changed its reported zoom to **1.1**, while the neighboring chat and app chrome retained their scale. The page remained contained in its pane after resizing. Super+5 selected Calm from the native page.
- A controlled page whose image never finishes loading became visible and usable in **239 ms**. Its actual title was `DOM-READY-NOT-ALL-RESOURCES`, with `loading:true`; the fixture recorded both page and unfinished-image requests. This checks usable main-document readiness rather than waiting for every ad/image to finish.
- Actual installed LFM2.5 1.2B GGUF inference ran through llama.cpp with CPU-only arguments. A current-page question returned the displayed fixture title without navigating elsewhere. Subsequent unrelated arithmetic/day-count/greeting turns completed. A later current-page turn read the unfinished-resource fixture correctly.
- Native standalone PDF loading reached page 1 of 2 and pagination reached page 2 of 2. Its PDF canvas and initial page text were inspected. A DOCX URL rendered the real fixture paragraph and four identifiable table cells in WebKit, not a pointer card or fabricated summary.

The full native scope was constrained to **one CPU core equivalent, 2500 MiB memory maximum and no swap** during the final local-model/browser checks. An observed cgroup memory peak was 835,301,376 charged bytes, but this is **not total or cold-start application RAM**: reused shared file cache may be charged elsewhere. A fast Desky core is not a Celeron.

### Inspected native screenshots

These are local evidence files outside Git, not user data or repository fixtures:

- `/tmp/profiles-standalone-device-hidden-v6-channel4.png`: first-request actual Channel 4 page.
- `/tmp/profiles-native-device-hidden-v10-draft.png`: restored agent draft beside the real native page.
- `/tmp/profiles-native-device-hidden-v10-small-final.png`: 1024×700, completed local-model answer, Calm, correctly contained unfinished-resource page.
- `/tmp/profiles-standalone-device-hidden-v6-pdf-restored.png` and `...-pdf-page2.png`: actual PDF canvas and page transition.
- `/tmp/profiles-standalone-device-hidden-v6-docx.png`: actual Word paragraph/table contents.
- `/tmp/profiles-standalone-device-hidden-v6-profile-a.png`: focused-input Super shortcut and separate empty profile browser.

## Defects found and corrected during native verification

- GTK child sizing needed four-sided overlay constraints; a size request alone is only a minimum.
- Profile initialization/queued resize could reveal another person's browser. Selection now has a single owner; async work captures the person/generation and Rust refuses revealing an inactive view.
- Main-app inputs needed GTK Super-key handling as well as native-page handling.
- Waiting for complete resource loading hid otherwise usable documents and caused false timeouts.
- A native sidecar with a missing lease could use an unseen Chromium actor. Native-shell admission now waits for the displayed bridge and never substitutes a hidden browser.
- Plain-text assistant history broke the constrained local-model action protocol. History now preserves actual chat roles and encodes prior assistant answers in the same JSON protocol; grounded page questions and unrelated follow-ups were exercised afterward.
- Resizing could hide the latest completed chat answer. Following the chat tail now survives viewport/pane changes without overriding deliberate user scroll-back.
- Chromium inherited an ephemeral desktop D-Bus connection and aborted when that bus died. Browser launches now detach desktop/audio environment; the regression kills a real disposable bus and verifies a subsequent click/title change.

## Verification safety correction

Earlier native runs used software-rendering flags but still opened NVIDIA/DRI device handles. Those owned runs were stopped and their process exits checked; they are **not CPU-only evidence**. The final route hides GPU devices before starting Xvfb, explicitly selects Mesa EGL as well as GLX, and asserts device absence. Linux QA/preflight/verify entry points now enforce the same fail-closed device-hiding policy when GPU nodes are present. A device-hidden initial launch exposed an NVIDIA EGL initialization abort; selecting the Mesa EGL vendor corrected that verification setup without disabling the WebKit sandbox.

## Limits and release interpretation

- No physical Chromebook or phone was available. Narrow/touch emulation and the owned cgroup restriction are approximations, not device certification.
- No real app API key was read or used in QA. Contributor provider selection/wire contracts were tested, but this report does not claim live cloud inference from the app. Implementation/review workers used the requested Contributor tier separately.
- Website login, cookie consent, engine restrictions and DRM remain real platform/site constraints. No access control bypass or substituted feed is counted as successful browsing.
- Native browsing is an OS child webview, not VNC or rewritten HTML. The web frontend uses a JPEG stream and input forwarding to the same Playwright page controlled by its agent.
- A backend-free copied binary retains native browsing, basic navigation/read commands and local document reading. API/local-model inference, notes and staging need the optional backend. Standalone remote document reads require source CORS; the full backend supplies bounded local byte fetching.
- Browser/model tools are bounded application operations, not unrestricted control of the owner's desktop. Activity displays show real events/provider-returned summaries, not hidden chain-of-thought.
- The original running application and unrelated dirty vault files were left unchanged. This is a verified branch candidate, not a claim of deployment to another machine or a successful remote CI run.
