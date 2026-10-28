# Profiles — Production Notes (2026-10-28)

## What is it, actually?

**Tauri, not Electron.** The shell is Tauri 2 (`src-tauri/`, Rust): the OS
webview renders the app, Rust only owns the window/process. No bundled
Chromium — that's why the install is megabytes, not hundreds. The same
`src/` frontend also runs in any browser (`npm start`) and as the phone
PWA surface; Tauri is the desktop/phone wrapper, never a requirement.

## What is it made in?

| Layer | Tech | Why |
|---|---|---|
| Shell | Rust + Tauri 2 (`src-tauri/src/main.rs`, `tauri.conf.json`) | native window, tiny footprint, OS webview |
| Frontend | vanilla JS + CSS (`src/index.html`, `src/main.js`) — deliberately **no TypeScript, no build step, no framework** | malleable by hand or by agent; view-source honest; works from `file://`, web, and Tauri identically |
| Agent | Node.js sidecar (`agent/*.mjs`, zero npm deps) | Pi-shaped loop (sense→plan→act→verify→remember), ledger, learning, macros |
| Local models | llama.cpp (`llama-completion`) + GGUF files in `agent/models/` | one binary, every tier, CPU-first, GPU when present |
| Data | plain files per profile slot (`vault/A|B|X/`) | pi-durable style: readable, diffable, deletable = uninstalled |

## Who maintains it, how does it update?

- **Maintainer:** Dave (owner) + his Pi/OMP agent fleet. This repo is the
  source of truth; agent sessions work in it like this one did.
- **Updates:** the app itself is static files + sidecar. Updating =
  replace `src/` + `agent/` (git pull from the private remote), restart.
  Tauri shell rarely needs a rebuild (only for native changes); the
  frontend updates without recompiling. Model *recommendations* update
  by editing `agent/models.json` (the Setup pane reads it live) — new
  models appear as options, never silent swaps, downloads are always
  the deterministic `scripts/fetch-model.mjs` (dry-run default).
- **Dependencies:** Node (sidecar + tests), llama.cpp (local brains),
  Rust/Tauri CLI (only to build the shell). No npm dependency tree in
  the runtime path — `package.json` has zero runtime deps; supply-chain
  surface is the three named binaries above.
- **Privacy invariant:** private GitHub remotes only, no GitHub Pages;
  external sharing via password-gated Cloudflare Pages if ever needed.

## Is Pi + Pi-durable a natural fit, or fiddly?

Natural, with one honest seam. The sidecar re-implements the Pi loop in
~150 lines because the *shape* is the product: checkpoints in a plain
ledger, memory as linked files, tools as a gated registry. That is
pi-durable's philosophy verbatim, so Profiles state *is* durable-vault
state (same formats under `vault/<slot>/`). The seam: a real `pi`
process as the Profile-X brain is an adapter swap in
`agent/localbrain.mjs`'s place (spawn/RPC), not yet wired — today the
lite agent + local GGUFs are real, the full Pi runtime is the X upgrade
path. OAuth/API-key logins for cloud brains plug into the same slot
(`PROFILES_ALLOW_CLOUD` + key today; OAuth logins next).

## The line in the sand: A/B vs X

- **Profiles A/B (and C/D if added):** "you get what we designed" —
  guided, cosy, sandboxed to the shell, lite agent, staged-everything,
  irreversible = draft + confirm. Zero carry-across between slots:
  separate vaults, layouts, memory, macros.
- **Profile X:** ringfenced power profile (own vault, ⚡). Extensible
  Pi + durable, deeper device access where the platform allows,
  hackable/malleable, advised brain = PC-standard tier or better
  (weaker models are *allowed* but the UI advises against them for
  full-access work). X can be dangerous to X only: A/B keep running
  untouched, swap back any time. Full-access is a per-profile property,
  never a global switch.

## History / private mode?

Not needed as a global: each slot's browser pane is sandboxed, notes
and memory are local plain files you can read/delete, snapshots give
rollback, and slot B/X *are* the separation. A per-slot "private
session" (no learning events recorded) is a small toggle on the same
machinery if wanted — the learning ledger is append-only text; not
recording is one `if`.

## Plain-English glossary (asked 2026-10-28)

- **OS webview:** Tauri does not ship a browser. It borrows the one your
  operating system already has (WebKitGTK on Linux, WebView2 on Windows,
  WKWebView on macOS/iOS) and renders the app inside it. That's why the
  install is tiny and updates are cheap — and one honest caveat: voice
  APIs depend on that borrowed engine, which is why Parakeet-local is
  the packaged voice upgrade.
- **No TypeScript / no build step:** the frontend is plain `.js`/`.css`
  files served as-is. There is no compile/transpile/bundle stage between
  what we write and what runs — open the file, that's the code. For a
  solo + agent-maintained app this removes a whole class of tooling
  breakage and keeps every change inspectable.
