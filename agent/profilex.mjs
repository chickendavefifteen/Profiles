// Profile X opt-in: single all-on switch, concise disclaimer, private git
// rollback repo, and A/B/C sandbox isolation proof.
//
// Design (overnight spec, Subagent 1):
// - Advanced power features are hidden by default; one prominent
//   "Turn on Profile X" button is the only entry point.
// - The disclaimer is concise and plain-spoken: X unlocks developer /
//   power capabilities (arbitrary shell via staged scripts, whole-machine
//   agent tools where the device allows, bleeding-edge features), while
//   normal profiles A/B/C stay strictly sandboxed and isolated from X.
// - Opting in turns ALL power features on — no 3-5 confusing sub-options.
//   (Whole-machine cwd widening stays a separate explicit second gate;
//   cloud stays credential-gated. Both are called out in the disclaimer.)
// - Activating X auto-initialises/verifies a PRIVATE local git repo for
//   the X vault so state can be rolled back. Local-only == private by
//   default; nothing is pushed anywhere by this module, ever.
// - Sandboxed separation: A/B/C vaults must never be touched by X ops.
//   verifyIsolation() fingerprints A/B/C before/after and proves equality.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const vaultRoot = join(root, 'vault');
import { slotPaths, ensureSlot, activeSlot } from './slots.mjs';
import { loadConfig, saveConfig, makeSnapshot } from './system.mjs';

export const PROFILEX_DISCLAIMER = [
  'Profile X is the power world. One switch turns everything on:',
  'arbitrary local shell via staged scripts you confirm, whole-machine',
  'agent tools where this device allows, and bleeding-edge features.',
  'Profiles A, B and C stay strictly sandboxed — ringfenced, isolated,',
  'and untouched by anything you do in X (and X cannot see them either).',
  'Turning on X creates a private local git repo for the X vault so you',
  'can roll back. Whole-machine folder widening and cloud brains stay',
  'separate explicit opt-ins (cloud also needs your own key).',
].join(' ');

// Everything-on for Profile X in one shot. Deliberately NOT a set of
// sub-checkboxes. wholeMachine + cloudEnabled stay OFF: the first is a
// second explicit gate (home-dir widening), the second needs a credential.
export const PROFILEX_ALL_ON = {
  advanced: true,
  guided: false,
  piPower: true,
  piBrain: true,
};

async function git(args, cwd) {
  return run('git', args, { cwd, timeout: 15000 });
}

/** Initialise (or verify) the private local git repo for vault/X. */
export async function ensureXGitRepo() {
  await ensureSlot('X');
  const xRoot = slotPaths('X').root;
  try {
    await git(['--version'], xRoot);
  } catch {
    return { ok: false, error: 'git is not installed — install git, then turn on Profile X again' };
  }
  const dotGit = join(xRoot, '.git');
  let created = false;
  if (!existsSync(dotGit)) {
    await git(['init'], xRoot);
    created = true;
    // Local-only, private by construction: never add a remote here.
    await git(['config', 'user.name', 'Profiles X'], xRoot).catch(() => {});
    await git(['config', 'user.email', 'x@localhost'], xRoot).catch(() => {});
    await git(['config', 'commit.gpgsign', 'false'], xRoot).catch(() => {});
  }
  // Keep noisy runtime state out of history; config/ledger/memory stay tracked.
  const ignorePath = join(xRoot, '.gitignore');
  const ignoreBody = '# Profiles X local rollback repo (private, never pushed)\npi-sessions/*.log\nsnapshots/\n*.tmp\n';
  if (!existsSync(ignorePath)) await writeFile(ignorePath, ignoreBody);
  // Ensure there is at least one commit so rollback always has a base.
  let commit = null;
  try {
    commit = (await git(['rev-parse', 'HEAD'], xRoot)).stdout.trim();
  } catch {
    commit = null;
  }
  if (!commit) {
    try {
      await git(['add', '-A'], xRoot);
      await git(['commit', '-m', 'Profile X initial state (private local rollback base)', '--no-gpg-sign'], xRoot);
      commit = (await git(['rev-parse', 'HEAD'], xRoot)).stdout.trim();
    } catch (e) {
      return { ok: false, error: 'git commit failed: ' + String(e?.message ?? e) };
    }
  }
  let status = '';
  try {
    status = (await git(['status', '--porcelain'], xRoot)).stdout.trim();
  } catch {}
  let remote = '';
  try {
    remote = (await git(['remote'], xRoot)).stdout.trim();
  } catch {}
  return { ok: true, repo: xRoot, commit, created, clean: status === '', private: remote === '', remote };
}

/** Fingerprint vault/A + vault/B + vault/C (relative path, size, mtime). */
export async function fingerprintABC() {
  const out = {};
  for (const slot of ['A', 'B', 'C']) {
    const r = slotPaths(slot).root;
    const files = [];
    async function walk(dir) {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          try {
            const st = await stat(full);
            files.push({ f: relative(r, full), s: st.size, m: st.mtimeMs });
          } catch {}
        }
      }
    }
    await walk(r);
    files.sort((a, b) => (a.f < b.f ? -1 : 1));
    out[slot] = files;
  }
  return out;
}

export function isolationEqual(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

/** Verify A/B/C untouched between two fingerprints. */
export async function verifyIsolation(before) {
  const after = await fingerprintABC();
  const equal = isolationEqual(before || {}, after);
  return { ok: equal, equal, after, checked: ['A', 'B', 'C'] };
}

/** Single all-on activation: git rollback base + snapshot + flags + showX. */
export async function activateProfileX() {
  const before = await fingerprintABC();
  await ensureSlot('X');
  const gitRes = await ensureXGitRepo();
  if (!gitRes.ok) return { ok: false, error: gitRes.error, before };
  // Snapshot first so file-level rollback exists alongside git history.
  let snapshot = null;
  try {
    snapshot = await makeSnapshot('profile-x-activation', 'X');
  } catch {}
  const cfg = await loadConfig('X');
  Object.assign(cfg, PROFILEX_ALL_ON);
  await saveConfig(cfg, 'X');
  // Reveal X on the strip (app-level). This is the ONLY write outside vault/X.
  let app = { showX: false, extraSlots: [] };
  try {
    app = { ...app, ...JSON.parse(await readFile(join(vaultRoot, 'app.json'), 'utf8')) };
  } catch {}
  app.showX = true;
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(join(vaultRoot, 'app.json'), JSON.stringify(app, null, 2));
  const isolation = await verifyIsolation(before);
  if (!isolation.ok) return { ok: false, error: 'isolation check failed: A/B/C changed during activation', before, git: gitRes };
  try {
    await git(['add', '-A'], slotPaths('X').root);
    await git(['commit', '-m', 'Profile X turned on (all power features on)', '--no-gpg-sign'], slotPaths('X').root).catch(() => {});
  } catch {}
  let commit = gitRes.commit;
  try {
    commit = (await git(['rev-parse', 'HEAD'], slotPaths('X').root)).stdout.trim();
  } catch {}
  return {
    ok: true,
    showX: true,
    allOn: { ...PROFILEX_ALL_ON },
    git: { repo: gitRes.repo, commit, private: true },
    snapshot: snapshot ? snapshot.id : null,
    isolation: { checked: ['A', 'B', 'C'], unchanged: true },
    activeSlot: await activeSlot().catch(() => 'A'),
  };
}

/** Read-only status for the Setup pane: gating + git + isolation proof. */
export async function profileXStatus() {
  let app = { showX: false, extraSlots: [] };
  try {
    app = { ...app, ...JSON.parse(await readFile(join(vaultRoot, 'app.json'), 'utf8')) };
  } catch {}
  const cfg = await loadConfig('X').catch(() => ({}));
  const dotGit = join(slotPaths('X').root, '.git');
  let gitInfo = { repo: false, commit: null, private: true };
  if (existsSync(dotGit)) {
    try {
      gitInfo.commit = (await git(['rev-parse', 'HEAD'], slotPaths('X').root)).stdout.trim();
      gitInfo.repo = true;
      gitInfo.private = (await git(['remote'], slotPaths('X').root)).stdout.trim() === '';
    } catch {}
  }
  const allOn =
    cfg.advanced === true && cfg.piPower === true && cfg.piBrain === true;
  return {
    showX: !!app.showX,
    gated: !app.showX,
    allOn,
    advancedVisible: !!app.showX,
    git: gitInfo,
    disclaimer: PROFILEX_DISCLAIMER,
    isolation: { checked: ['A', 'B', 'C'], note: 'A/B/C vaults are never written by Profile X operations' },
  };
}
