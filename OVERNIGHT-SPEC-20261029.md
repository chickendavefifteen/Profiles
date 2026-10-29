# Profiles Overnight Orchestration Specification — 2026-10-29

## Owner Directive & Core Vision
"Complexity meeting minimalism: unifying the browser, agent, and note/document canvas."
Refine Profiles into an elegant, robust, and highly tested product. Work overnight orchestrated across 5 parallel subagents running on `meta/muse-spark-1.3-contributor` with `xhigh` thinking.

---

## 1. Feature Specifications

### 1.1 Profile X & Advanced Settings Gating
- **Visibility & Gating**: Advanced features in the settings/menu must NOT be visible or selectable by default.
- **Opt-in Trigger**: A clear, prominent button/toggle: **"Turn on Profile X"**.
- **Disclaimer**: Clicking it presents a concise, plain-spoken disclaimer explaining:
  - Profile X unlocks developer/power capabilities (arbitrary shell, whole-machine agent tools, bleeding-edge features).
  - Normal profiles (A, B, C) remain strictly sandboxed, ringfenced, and completely isolated from Profile X.
- **Everything-On Policy**: Turning on Profile X does not present 3–5 confusing sub-checkboxes; it simply turns everything on.
- **Automatic Rollback / Git Repo**:
  - Activating Profile X automatically initializes/verifies a private git repository for the vault/environment so the user can easily rollback if an experimental feature breaks.
- **Sandboxed Separation**: Profile A, B, and C vaults and storage must never be touched or altered by Profile X operations.

### 1.2 Profile Modes & Nomenclature
- **`babylite`**: Formerly `lite`. Lowercase `babylite`. Theme accent: soft baby-blue. Auto-triggers when system resources (RAM/CPU) are struggling.
- **`chill`**: Formerly `chill`. Lowercase `chill`. Warm, slow, for AFK or resting states.
- **`FOCUSMAX`**: Formerly `focus` / `focused`. Uppercase `FOCUSMAX`. For mono-tasking when heavily focused on one objective.
- **`Vibes`**: Formerly `lifeful` / `vibes`. More fun, fluent, energetic, full-sensory mode for multitasking.
- **`xMAX` (New 6th Mode)**:
  - A hybrid of Vibes and Focus: crisp, quick, and built for heavy parallelism.
  - **Exclusivity**: Only visible and selectable when Profile X is turned on!
- **`calm` (Low-Sensory)**: Acts as a panic button for sensory overload, stress, or anxiety (zero motion, softened contrast, minimal cognitive load).
- **Profile Hotkeys**:
  - `1`, `2`, `3`, `4`, `5`, `6` to switch modes.
  - `a`, `b`, `c`, `x` to switch profile slots directly (even if Adaptive is active).

### 1.3 Adaptive Switcher ("Adaptive" Toggle)
- Located to the left of the profile options: a clean checkbox/toggle labeled **"Adaptive"**.
- **Smooth Segways**: Switches between profiles automatically without jarring cuts or sudden jumps:
  - Subtle color-grade cross-fades and gentle animation transitions.
- **Context-Aware Rules**:
  - Idle / AFK / minimal user input -> segway into `chill`.
  - Heavy focus on a single pane/document -> segway into `FOCUSMAX`.
  - Rapid swapping between tasks/panes -> segway into `Vibes`.
  - Elevated CPU/RAM resource contention -> smoothly downshift into `babylite`.
  - Manual panic trigger -> `calm`.

### 1.4 The `+` Menu & Unified Canvas
- **Suggestions Cleanup**:
  - Remove "Video" and "Activity" suggestions from the `+` menu.
  - Keep "Notes".
- **Read / Write (Documents & Canvas)**:
  - Provide a basic, native canvas / paint pass-through so users can draw or sketch directly out of the box, with support for document export.
- **Fix Browser & Agent Chat**:
  - Ensure the embedded Browser pane loads URLs and navigates reliably.
  - Ensure Agent chat connects to tool calling, web search, and answers smoothly without hanging.

### 1.5 Window Management & UI Polish
- **Pin Button Dual-Action (Move + Resize)**:
  - Clicking the 📌 Pin button unlocks the pane.
  - While unlocked, the user can:
    1. Drag to reorder panes.
    2. Left-click and drag any edge/border of the highlighted box to resize it smoothly.
  - Clicking the Pin button again locks the pane firmly into place.
- **Global Click-Outside Dismissal**:
  - Recycle bin preview popup: clicking anywhere outside the popup immediately cancels and dismisses it.
  - Establish this as a universal rule across all popups, chip selectors, and dropdown menus.

---

## 2. Five Parallel Subagent Workstreams

| Subagent ID | Focus Area | Branch / Worktree | Core Deliverables |
| :--- | :--- | :--- | :--- |
| **`worker-1-core`** | Profile X & Sandbox | `worktrees/p-core` | Profile X disclaimer, all-on gating, automated private git repo creation, A/B/C vault sandboxing. |
| **`worker-2-modes`** | Modes & Adaptive | `worktrees/p-modes` | Renaming (`babylite`, `chill`, `FOCUSMAX`, `Vibes`, `xMAX`), Adaptive toggle, subtle color-grade segways, hotkeys `1-6` & `a,b,c,x`. |
| **`worker-3-canvas`** | Canvas & Browser | `worktrees/p-canvas` | Fix browser pane & agent chat, clean `+` menu (drop video/activity), add native paint/sketch canvas pass-through. |
| **`worker-4-ui`** | Pin Resize & Popups | `worktrees/p-ui` | Left-click border drag resizing on unpinned panes, universal outside-click dismissal for recycle bin & menus. |
| **`worker-5-qa`** | QA, CI/CD & Gates | `worktrees/p-qa` | Playwright end-to-end suites for all new features, regression guards, clean git worktree reconciliation. |

---

## 3. Quality & Regression Contracts
1. **Zero Unapproved Regressions**: All 208 existing unit tests and 14 Playwright QA flows must pass.
2. **New E2E Tests Required**:
   - `test_profile_x_gating`: Profile X disclaimer, git init, A/B/C isolation.
   - `test_adaptive_toggle`: Smooth transitions, hotkeys 1–6 and a, b, c, x.
   - `test_pin_resize`: Pin toggle, border resize interaction, re-pin lock.
   - `test_popup_dismissal`: Recycle bin outside-click cancel.
   - `test_canvas_passthrough`: Paint/canvas basic drawing and persistence.
