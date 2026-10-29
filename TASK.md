# Subagent 5: QA Evals, CI/CD Pipeline & Merge Reconciler
- Role: Quality Assurance & Release Engineering
- Branch: feature/qa-gates
- Tasks:
  1. Write E2E Playwright tests for:
     - Profile X disclaimer, git rollback repo creation, A/B/C isolation.
     - Adaptive toggle, segway transitions, hotkeys (1-6, a/b/c/x).
     - Pin unlock, border resize, re-pin lock.
     - Universal popup click-outside dismissal (recycle bin, menus).
     - Read/Write basic canvas pass-through.
  2. Validate 0 regressions across existing 208 unit tests + 14 QA tests.
  3. Linear git worktree merge reconciliation into master.
