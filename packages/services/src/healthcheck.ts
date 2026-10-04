/**
 * Daily Healthcheck (C4)
 *
 * Runs at 9am to verify all golem services are healthy.
 * Logs status and exits with an error if a check fails.
 * Checks Ollama, state JSON validity, and loaded launchd jobs.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { $ } from "bun";

const HOME = process.env.HOME || homedir();
const STATE_FILE = join(HOME, ".golems-zikaron/state.json");

interface HealthStatus {
  name: string;
  ok: boolean;
  detail?: string;
}

interface HealthCheck {
  name: string;
  run: () => Promise<HealthStatus>;
}

async function checkOllama(): Promise<HealthStatus> {
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      const models = data.models?.length || 0;
      return { name: "Ollama", ok: true, detail: `${models} models available` };
    }
    return { name: "Ollama", ok: false, detail: `Status ${response.status}` };
  } catch {
    return { name: "Ollama", ok: false, detail: "Not responding" };
  }
}

async function checkStateFile(): Promise<HealthStatus> {
  try {
    if (!existsSync(STATE_FILE)) {
      return { name: "State File", ok: false, detail: "Missing" };
    }
    const content = readFileSync(STATE_FILE, "utf-8");
    const state = JSON.parse(content);
    const valid = state !== null && typeof state === "object" && !Array.isArray(state);
    return { name: "State File", ok: valid, detail: valid ? "Valid state JSON" : "Expected an object" };
  } catch (err) {
    return { name: "State File", ok: false, detail: "Invalid JSON" };
  }
}

async function checkLaunchdJobs(): Promise<HealthStatus> {
  try {
    const result = await $`launchctl list | grep golems`.quiet();
    const output = result.stdout.toString().trim();
    const lines = output.split("\n").filter(Boolean);
    if (lines.length > 0) {
      return { name: "Launchd Jobs", ok: true, detail: `${lines.length} jobs loaded` };
    }
    return { name: "Launchd Jobs", ok: false, detail: "No jobs found" };
  } catch {
    return { name: "Launchd Jobs", ok: false, detail: "No jobs found" };
  }
}

function getHealthChecks(): HealthCheck[] {
  return [
    { name: "Ollama", run: checkOllama },
    { name: "State File", run: checkStateFile },
    { name: "Launchd Jobs", run: checkLaunchdJobs },
  ];
}

async function runHealthcheck(): Promise<void> {
  console.log("[Healthcheck] Starting daily check...");

  const statuses: HealthStatus[] = await Promise.all(
    getHealthChecks().map((check) => check.run()),
  );

  // Log to console
  for (const s of statuses) {
    const emoji = s.ok ? "✅" : "❌";
    console.log(`${emoji} ${s.name}: ${s.detail || (s.ok ? "OK" : "Failed")}`);
  }

  const allOk = statuses.every((s) => s.ok);
  console.log(`\n[Healthcheck] ${allOk ? "All healthy" : "Issues found"}`);

  // Exit with error code if any checks failed
  if (!allOk) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  runHealthcheck().catch((err) => {
    console.error("[Healthcheck] Fatal error:", err);
    process.exit(1);
  });
}

export { runHealthcheck, getHealthChecks, HealthStatus };
