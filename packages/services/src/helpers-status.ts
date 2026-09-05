/**
 * CLI for `golems helpers` command.
 * Shows status of all external helper backends.
 */

import { getHelperStatus, FALLBACK_CHAIN, type HelperBackend } from "@golems/shared/lib/helpers";

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[0;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";

const DEFAULT_TIMEZONE = "Asia/Jerusalem";

function getTimezone(): string {
  return process.env.TZ || DEFAULT_TIMEZONE;
}

function formatResetTime(resetsAt: string): string {
  const date = new Date(resetsAt);
  const tz = getTimezone();
  return date.toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

function formatMinutesUntil(resetsAt: string, now: Date): string {
  const diff = new Date(resetsAt).getTime() - now.getTime();
  const mins = Math.max(0, Math.ceil(diff / 60_000));
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return remainMins > 0 ? `${hours}h ${remainMins}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function compactMode(): void {
  const now = new Date();
  const status = getHelperStatus(now);
  const parts: string[] = [];

  for (const [backend, info] of Object.entries(status) as [HelperBackend, { available: boolean; resets_at: string | null }][]) {
    if (info.available) {
      parts.push(`${backend} \u2713`);
    } else if (info.resets_at) {
      const diff = new Date(info.resets_at).getTime() - now.getTime();
      if (diff < 3600_000) {
        parts.push(`${backend} \u26A0 ${formatMinutesUntil(info.resets_at, now)}`);
      } else {
        parts.push(`${backend} \u2717 until ${formatResetTime(info.resets_at)}`);
      }
    } else {
      parts.push(`${backend} \u2717`);
    }
  }

  console.log(`helpers: ${parts.join(" | ")}`);
}

function tableMode(): void {
  const now = new Date();
  const status = getHelperStatus(now);

  console.log(`${BLUE}=== HELPER BACKENDS ===${NC}`);
  console.log();
  console.log(`  ${"BACKEND".padEnd(12)} ${"STATUS".padEnd(12)} ${"RESETS AT".padEnd(30)}`);
  console.log(`  ${"-------".padEnd(12)} ${"------".padEnd(12)} ${"--------".padEnd(30)}`);

  for (const [backend, info] of Object.entries(status) as [HelperBackend, { available: boolean; resets_at: string | null }][]) {
    const name = backend.padEnd(12);
    if (info.available) {
      console.log(`  ${name} ${GREEN}\u2713 available${NC}`);
    } else if (info.resets_at) {
      const timeStr = formatResetTime(info.resets_at);
      const remaining = formatMinutesUntil(info.resets_at, now);
      console.log(`  ${name} ${RED}\u2717 limited${NC}    ${YELLOW}${timeStr}${NC} (${remaining})`);
    } else {
      console.log(`  ${name} ${RED}\u2717 limited${NC}`);
    }
  }

  console.log();
  console.log(`  Fallback chain: ${FALLBACK_CHAIN.join(" \u2192 ")}`);
}

// Main
const isCompact = process.argv.includes("--compact");
if (isCompact) {
  compactMode();
} else {
  tableMode();
}
