# ORCHESTRATION BRIEF FOR DESKY MAIN THREAD

## Directive Summary
The owner has reviewed the Profiles build on Chromebook and established the overnight optimization campaign.
All work on Desky MUST run on `meta/muse-spark-1.3-contributor` (contributor tier only) with `thinking: xhigh`.

## Immediate Action Items
1. **Branch Isolation via Git Worktrees**:
   Create 5 dedicated worktrees under `/home/dh/profiles-hackathon/worktrees/`:
   - `git worktree add worktrees/p-core -b feature/profile-x-core`
   - `git worktree add worktrees/p-modes -b feature/modes-adaptive`
   - `git worktree add worktrees/p-canvas -b feature/canvas-browser`
   - `git worktree add worktrees/p-ui -b feature/ui-pin-popups`
   - `git worktree add worktrees/p-qa -b feature/qa-gates`

2. **Subagent Execution Prompts & Scope**:
   - Each subagent executes bounded to its worktree.
   - Run tests (`npm test` and `npm run qa`) before and after edits.
   - Merging follows linear reconciliation into `master` with zero regressions.

3. **Feature Acceptance Matrix**:
   - [ ] "Turn on Profile X" with disclaimer -> turns everything on -> auto-creates rollback git repo.
   - [ ] Modes updated: `babylite` (baby-blue), `chill`, `FOCUSMAX`, `Vibes`, and `xMAX` (6th mode, Profile X only).
   - [ ] "Adaptive" checkbox to the left of profiles: smooth color/animation segways.
   - [ ] Hotkeys: `1`-`6` for modes, `a`, `b`, `c`, `x` for profile slots.
   - [ ] `+` menu cleaned (no video/activity suggestions); basic paint/canvas added to Read/Write.
   - [ ] Pin button: click to unlock, left-click border to resize, click to lock.
   - [ ] Popups / Recycle Bin: click anywhere outside dismisses popup preview.

Refer to `OVERNIGHT-SPEC-20261029.md` for complete technical contracts.
