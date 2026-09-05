/**
 * Daily Healthcheck (C4)
 *
 * Runs at 9am to verify all golem services are healthy.
 * Sends status report to Telegram.
 *
 * Checks:
 * 1. Telegram bot process running
 * 2. Notification server responding (port 3847)
 * 3. Ollama available (for scoring)
 * 4. State files exist and valid
 * 5. Launchd jobs loaded
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { $ } from "bun";

const HOME = process.env.HOME || homedir();
const STATE_FILE = join(HOME, ".golems-zikaron/state.json");
const NOTIFY_URL = "http://localhost:3847/notify";

interface HealthStatus {
  name: string;
  ok: boolean;
  detail?: string;
}

interface HealthCheck {
  name: string;
  run: () => Promise<HealthStatus>;
}

async function checkTelegramBot(): Promise<HealthStatus> {
  try {
    const result = await $`pgrep -fl telegram-bot`.quiet();
    const output = result.stdout.toString().trim();
    if (output) {
      const pid = output.split(" ")[0];
      return { name: "Telegram Bot", ok: true, detail: `PID ${pid}` };
    }
    return { name: "Telegram Bot", ok: false, detail: "Not running" };
  } catch {
    return { name: "Telegram Bot", ok: false, detail: "Not running" };
  }
}

async function checkNotifyServer(): Promise<HealthStatus> {
  try {
    const response = await fetch(NOTIFY_URL.replace("/notify", "/"), {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    // Even 404 means server is up
    return { name: "Notify Server", ok: true, detail: `Port 3847 responding` };
  } catch (err) {
    return { name: "Notify Server", ok: false, detail: "Not responding" };
  }
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
    if (state.telegramChatId) {
      return { name: "State File", ok: true, detail: `Chat ID: ${state.telegramChatId}` };
    }
    return { name: "State File", ok: false, detail: "No chat ID saved" };
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
    { name: "Telegram Bot", run: checkTelegramBot },
    { name: "Notify Server", run: checkNotifyServer },
    { name: "Ollama", run: checkOllama },
    { name: "State File", run: checkStateFile },
    { name: "Launchd Jobs", run: checkLaunchdJobs },
  ];
}

async function sendHealthReport(statuses: HealthStatus[]): Promise<void> {
  const allOk = statuses.every((s) => s.ok);
  const icon = allOk ? "✅" : "⚠️";

  const lines = statuses.map((s) => {
    const emoji = s.ok ? "✅" : "❌";
    return `${emoji} ${s.name}: ${s.detail || (s.ok ? "OK" : "Failed")}`;
  });

  const body = lines.join("\n");
  const title = allOk ? "All Systems Healthy" : "Issues Detected";

  try {
    await fetch(NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${icon} ${title}`,
        body,
        source: "healthcheck",
        priority: allOk ? "default" : "high",
      }),
    });
    console.log("[Healthcheck] Report sent to Telegram");
  } catch (err) {
    console.error("[Healthcheck] Failed to send report:", err);
    // Fall back to console
    console.log(`\n${icon} ${title}\n${body}\n`);
  }
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

  // Send to Telegram
  await sendHealthReport(statuses);

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
