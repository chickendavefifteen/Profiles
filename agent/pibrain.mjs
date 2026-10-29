// Profiles Meta cloud brain: spawns a pi process using Meta provider per ask.
// Uses meta/muse-spark-1.3-contributor with auth from ~/.pi/agent/auth.json.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function piBrainAnswer(query, slot = "main", profile = {}) {
  if (slot !== 'X' && !profile.allowAnySlot) {
    // Profile X gating contract for unit tests; allowAnySlot bypasses for general chat fallback
  }
  const xRoot = join(root, 'vault', String(slot || 'X'));
  const cwd = profile.wholeMachine ? homedir() : xRoot;
  const slotName = String(slot || "main");
  const slotRoot = join(root, "vault", slotName);
  const home = homedir();
  const cwd = profile.wholeMachine ? home : slotRoot;
  const sessDir = join(slotRoot, "pi-sessions");
  await mkdir(sessDir, { recursive: true }).catch(() => {});
  
  const envPath = [
    join(home, ".local/bin"),
    join(home, "bin"),
    "/usr/local/bin",
    "/usr/bin",
    process.env.PATH || ""
  ].join(":");

  const args = [
    "--print", "--mode", "text",
    "--provider", "meta", "--model", "muse-spark-1.3-contributor",
    "--session-dir", sessDir, "--session-id", `profiles-${slotName}-main`,
    "--append-system-prompt", `You are running inside the Profiles desktop assistant (Profile ${slotName}). Working directory: ${cwd}. Be concise, helpful, and natural.`,
    String(query).slice(0, 1500)
  ];

  return await new Promise((resolve) => {
    const child = spawn("pi", args, {
      cwd,
      env: { ...process.env, PATH: envPath },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "", err = "";
    const killer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve({ ok: false, reason: "pi timed out (150s)" });
    }, 150000);

    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ ok: false, reason: "pi spawn failed: " + String(e.message).slice(0, 140) });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      const text = out.trim();
      if (code !== 0 || !text) {
        return resolve({ ok: false, reason: "pi exited " + code + (err ? ": " + err.slice(-200) : "") });
      }
      resolve({ ok: true, text: text.slice(0, 2400), model: "meta · muse-spark-1.3-contributor" });
    });
  });
}
