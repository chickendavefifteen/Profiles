// Profile X brain: a REAL pi process, spawned per ask.
// Only reachable when ALL hold: active slot === 'X', profile.piPower,
// profile.piBrain === true (explicit enable). A/B/C can never get here —
// sidecar checks the slot before this module is even imported lazily.
// Sessions live in vault/X/pi-sessions (durable, X-only continuity).
// cwd is vault/X/ — pi's tools start ringfenced to X's world; widening
// is a separate owner decision recorded in SPEC-PRODUCTION.md.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function piBrainAnswer(query, slot, profile = {}) {
  if (slot !== 'X') return { ok: false, reason: 'pi brain is Profile-X only' };
  const xRoot = join(root, 'vault', 'X');
  // Widening (owner decision, spec 6.3): wholeMachine moves pi's cwd to
  // the home directory. Still X-only sessions, still X's config, and it
  // takes a separate explicit flag — piPower alone never widens.
  const { homedir } = await import('node:os');
  const cwd = profile.wholeMachine ? homedir() : xRoot;
  const sessDir = join(xRoot, 'pi-sessions');
  await mkdir(sessDir, { recursive: true });
  const args = ['--print', '--mode', 'text',
    '--provider', 'meta', '--model', 'muse-spark-1.3-contributor',
    '--session-dir', sessDir, '--session-id', 'profiles-x-main',
    '--append-system-prompt', `You are running inside Profiles Profile X (ringfenced power profile). Working directory: ${cwd}. ${profile.wholeMachine ? 'Whole-machine mode is ON by explicit owner opt-in: you may work across the home directory, still checkpoint big changes.' : 'You are ringfenced to the X vault.'} Be concise. Never touch other profile slots (vault/A, B, C) - they are other people.`,
    String(query).slice(0, 1500)];
  return await new Promise((resolve) => {
    const child = spawn('pi', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ ok: false, reason: 'pi timed out (150s)' }); }, 150000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, reason: 'pi spawn failed: ' + String(e.message).slice(0, 140) }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      const text = out.trim();
      if (code !== 0 || !text) return resolve({ ok: false, reason: 'pi exited ' + code + (err ? ': ' + err.slice(-200) : '') });
      resolve({ ok: true, text: text.slice(0, 2400), model: 'pi · muse-spark-1.3-contributor' });
    });
  });
}
