/**
 * TUI — Terminal UI components for golems CLI
 *
 * Rich terminal output with colors, tables, and status indicators.
 * Used by `golems status`, `golems dashboard`, and other commands.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// ANSI Colors (no dependencies)
// ---------------------------------------------------------------------------

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

export const colors = {
  bold: (s: string) => `${ESC}1m${s}${RESET}`,
  dim: (s: string) => `${ESC}2m${s}${RESET}`,
  red: (s: string) => `${ESC}31m${s}${RESET}`,
  green: (s: string) => `${ESC}32m${s}${RESET}`,
  yellow: (s: string) => `${ESC}33m${s}${RESET}`,
  blue: (s: string) => `${ESC}34m${s}${RESET}`,
  magenta: (s: string) => `${ESC}35m${s}${RESET}`,
  cyan: (s: string) => `${ESC}36m${s}${RESET}`,
  gray: (s: string) => `${ESC}90m${s}${RESET}`,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GolemStatus {
  name: string;
  emoji: string;
  status: "running" | "stopped" | "error" | "scheduled";
  detail?: string;
  lastActive?: string;
}

export interface SystemHealth {
  golems: GolemStatus[];
  services: ServiceStatus[];
  config: ConfigStatus;
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  port?: number;
  pid?: string;
}

export interface ConfigStatus {
  configFile: boolean;
  stateDir: boolean;
  envFile: boolean;
  wizardRun: boolean;
}

// ---------------------------------------------------------------------------
// Status detection
// ---------------------------------------------------------------------------

function shellExec(cmd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    return { ok: true, output };
  } catch {
    return { ok: false, output: "" };
  }
}

export function detectGolemStatuses(): GolemStatus[] {
  const golems: GolemStatus[] = [];

  // Telegram Bot
  const telegram = shellExec("pgrep -fl telegram-bot");
  golems.push({
    name: "ClaudeGolem",
    emoji: "🤖",
    status: telegram.ok && telegram.output.length > 0 ? "running" : "stopped",
    detail: telegram.ok ? "Telegram bot active" : "Not running",
  });

  // Email Golem (launchd)
  const emailLaunchd = shellExec("launchctl list 2>/dev/null | grep com.golemszikaron.email-golem");
  golems.push({
    name: "EmailGolem",
    emoji: "📧",
    status: emailLaunchd.ok && emailLaunchd.output.length > 0 ? "scheduled" : "stopped",
    detail: emailLaunchd.ok ? "Scheduled (launchd)" : "Not scheduled",
  });

  // Job Golem (launchd)
  const jobLaunchd = shellExec("launchctl list 2>/dev/null | grep com.golemszikaron.job-golem");
  golems.push({
    name: "JobGolem",
    emoji: "🎯",
    status: jobLaunchd.ok && jobLaunchd.output.length > 0 ? "scheduled" : "stopped",
    detail: jobLaunchd.ok ? "Scheduled (launchd)" : "Not scheduled",
  });

  // Night Shift (launchd)
  const nightShift = shellExec("launchctl list 2>/dev/null | grep com.golemszikaron.nightshift");
  golems.push({
    name: "NightShift",
    emoji: "🌙",
    status: nightShift.ok && nightShift.output.length > 0 ? "scheduled" : "stopped",
    detail: nightShift.ok ? "Scheduled (4am)" : "Not scheduled",
  });

  // RecruiterGolem (part of email pipeline)
  golems.push({
    name: "RecruiterGolem",
    emoji: "💼",
    status: emailLaunchd.ok && emailLaunchd.output.length > 0 ? "scheduled" : "stopped",
    detail: "Routes from EmailGolem",
  });

  // TellerGolem (subscription tracking)
  golems.push({
    name: "TellerGolem",
    emoji: "💰",
    status: emailLaunchd.ok && emailLaunchd.output.length > 0 ? "scheduled" : "stopped",
    detail: "Routes from EmailGolem",
  });

  return golems;
}

export function detectServices(): ServiceStatus[] {
  const services: ServiceStatus[] = [];

  // Notification server
  const notify = shellExec("curl -s --max-time 2 http://localhost:3847/health");
  services.push({
    name: "Notify Server",
    running: notify.ok,
    port: 3847,
  });

  // Ollama
  const ollama = shellExec("curl -s --max-time 2 http://localhost:11434/api/tags");
  services.push({
    name: "Ollama",
    running: ollama.ok,
    port: 11434,
  });

  // Zikaron MCP
  const zikaron = shellExec("curl -s --max-time 2 http://localhost:8765/health 2>/dev/null");
  services.push({
    name: "Zikaron MCP",
    running: zikaron.ok,
    port: 8765,
  });

  return services;
}

export function detectConfig(): ConfigStatus {
  const home = process.env.HOME || "~";
  return {
    configFile: existsSync(join(home, ".golems", "config.yaml")),
    stateDir: existsSync(join(home, ".golems-zikaron")),
    envFile: existsSync(join(home, "Gits", "golems", "packages", "autonomous", ".env")),
    wizardRun: existsSync(join(home, ".golems", "wizard-state.json")),
  };
}

export function getSystemHealth(): SystemHealth {
  return {
    golems: detectGolemStatuses(),
    services: detectServices(),
    config: detectConfig(),
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function statusIcon(status: GolemStatus["status"]): string {
  switch (status) {
    case "running": return colors.green("●");
    case "scheduled": return colors.blue("◐");
    case "stopped": return colors.gray("○");
    case "error": return colors.red("✗");
  }
}

function serviceIcon(running: boolean): string {
  return running ? colors.green("●") : colors.red("○");
}

function configIcon(ok: boolean): string {
  return ok ? colors.green("✓") : colors.yellow("✗");
}

export function formatDashboard(health: SystemHealth): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(colors.bold("  🜔 GOLEMS DASHBOARD"));
  lines.push(colors.dim("  " + "─".repeat(46)));
  lines.push("");

  // Golems section
  lines.push(colors.bold("  Golems"));
  for (const g of health.golems) {
    const icon = statusIcon(g.status);
    const name = `${g.emoji} ${g.name}`.padEnd(22);
    const detail = colors.dim(g.detail || "");
    lines.push(`    ${icon} ${name} ${detail}`);
  }
  lines.push("");

  // Services section
  lines.push(colors.bold("  Services"));
  for (const s of health.services) {
    const icon = serviceIcon(s.running);
    const name = s.name.padEnd(18);
    const port = s.port ? colors.dim(`:${s.port}`) : "";
    lines.push(`    ${icon} ${name} ${port}`);
  }
  lines.push("");

  // Config section
  lines.push(colors.bold("  Config"));
  const c = health.config;
  lines.push(`    ${configIcon(c.configFile)} config.yaml`);
  lines.push(`    ${configIcon(c.stateDir)} state directory`);
  lines.push(`    ${configIcon(c.envFile)} .env file`);
  lines.push(`    ${configIcon(c.wizardRun)} wizard state`);
  lines.push("");

  // Summary line
  const running = health.golems.filter((g) => g.status === "running" || g.status === "scheduled").length;
  const total = health.golems.length;
  const svcUp = health.services.filter((s) => s.running).length;
  const svcTotal = health.services.length;
  lines.push(
    colors.dim(`  ${running}/${total} golems active  ·  ${svcUp}/${svcTotal} services up`)
  );
  lines.push("");

  return lines.join("\n");
}

export function formatCompactStatus(health: SystemHealth): string {
  const lines: string[] = [];

  const running = health.golems.filter((g) => g.status === "running" || g.status === "scheduled");
  const stopped = health.golems.filter((g) => g.status === "stopped");

  if (running.length > 0) {
    lines.push(colors.bold("Active:") + " " + running.map((g) => `${g.emoji} ${g.name}`).join(", "));
  }
  if (stopped.length > 0) {
    lines.push(colors.dim("Stopped: " + stopped.map((g) => g.name).join(", ")));
  }

  const svcDown = health.services.filter((s) => !s.running);
  if (svcDown.length > 0) {
    lines.push(colors.yellow("Services down: " + svcDown.map((s) => s.name).join(", ")));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Box drawing
// ---------------------------------------------------------------------------

export function box(title: string, content: string[], width: number = 50): string {
  const lines: string[] = [];
  const inner = width - 4;
  lines.push(`  ┌${"─".repeat(inner + 2)}┐`);
  lines.push(`  │ ${colors.bold(title.padEnd(inner))} │`);
  lines.push(`  ├${"─".repeat(inner + 2)}┤`);
  for (const line of content) {
    // Pad without ANSI (rough approximation)
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
    const padding = Math.max(0, inner - stripped.length);
    lines.push(`  │ ${line}${" ".repeat(padding)} │`);
  }
  lines.push(`  └${"─".repeat(inner + 2)}┘`);
  return lines.join("\n");
}
