#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "/home/dh/profiles-hackathon";
const WORKTREES = [
  { id: "worker-1-core", dir: "worktrees/p-core", role: "Profile X & Sandbox" },
  { id: "worker-2-modes", dir: "worktrees/p-modes", role: "Modes Nomenclature & Adaptive Switcher" },
  { id: "worker-3-canvas", dir: "worktrees/p-canvas", role: "Unified Canvas, Browser & Chat" },
  { id: "worker-4-ui", dir: "worktrees/p-ui", role: "Pin Resize & Popup Dismissal" },
  { id: "worker-5-qa", dir: "worktrees/p-qa", role: "QA Evals, CI/CD Pipeline & Merge Reconciler" }
];

const LOGS_DIR = join(ROOT, "worktrees/logs");
await mkdir(LOGS_DIR, { recursive: true });

console.log("=== Launching 5 Parallel Subagents on Desky ===");
console.log("Model: meta/muse-spark-1.3-contributor (tier: contributor, thinking: xhigh)\n");

const jobs = WORKTREES.map(async (wt) => {
  const wtDir = join(ROOT, wt.dir);
  const taskFile = join(wtDir, "TASK.md");
  const taskContent = await readFile(taskFile, "utf8").catch(() => "Execute assigned worktree tasks per OVERNIGHT-SPEC-20261029.md");
  const logPath = join(LOGS_DIR, `${wt.id}.log`);
  const sessDir = join(LOGS_DIR, "sessions");
  await mkdir(sessDir, { recursive: true });

  const prompt = `You are subagent ${wt.id} (${wt.role}) working in ${wtDir}.
Strict rules:
1. Stay strictly inside your assigned worktree directory: ${wtDir}.
2. Implement all tasks specified in ${taskFile} and ${join(ROOT, "OVERNIGHT-SPEC-20261029.md")}.
3. Run npm test after changes to ensure zero unit test regressions.
4. Git commit your completed feature to your local worktree branch.

Task Specification:
${taskContent}
`;

  const args = [
    "-p",
    "--provider", "meta",
    "--model", "muse-spark-1.3-contributor",
    "--thinking", "xhigh",
    "--session-dir", sessDir,
    "--session-id", `profiles-${wt.id}`,
    prompt
  ];

  const logFd = await import("node:fs").then(fs => fs.openSync(logPath, "w"));
  const child = spawn("/home/dh/.local/bin/pi", args, {
    cwd: wtDir,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, PATH: `/home/dh/.local/bin:${process.env.PATH || ""}` }
  });

  console.log(`[${wt.id}] Spawned PID ${child.pid} -> Log: ${logPath}`);

  return new Promise((resolve) => {
    child.on("close", (code) => {
      console.log(`[${wt.id}] Completed with exit code ${code}`);
      resolve({ id: wt.id, code, logPath });
    });
    child.on("error", (err) => {
      console.error(`[${wt.id}] Spawn error:`, err.message);
      resolve({ id: wt.id, code: -1, error: err.message, logPath });
    });
  });
});

const results = await Promise.all(jobs);
console.log("\n=== All 5 Subagent Runs Finished ===");
console.log(JSON.stringify(results, null, 2));
