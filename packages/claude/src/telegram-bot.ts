#!/usr/bin/env bun
/**
 * ClaudeGolem Telegram Bot — CLI Remote Control
 *
 * Simplified bot: auth middleware → claude-composer → notify server.
 * No domain composers, no conversational UX, no personas.
 *
 * Infrastructure:
 * - composers/claude-composer.ts  — /status, /trigger, /tonight, /schedule + free text → Claude CLI
 * - lib/bot-shared.ts             — Shared state, Claude CLI spawning, queue
 * - lib/notify-server.ts          — HTTP notification server (port 3847)
 */

import "@golems/shared/lib/load-env";
import { installProcessGuards } from "@golems/shared/lib/process-guards";
import { Bot } from "grammy";
import { GITS } from "./lib/bot-shared";

// Catch unhandled errors before they crash the bot silently
installProcessGuards("telegram-bot");
import { startNotifyServer } from "./lib/notify-server";

// Composers
import { claudeComposer } from "./composers/claude-composer";

// ═══════════════════════════════════════════════════════
// Bot Setup
// ═══════════════════════════════════════════════════════

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}
const bot = new Bot(token);

// Security: Whitelist allowed Telegram user IDs (FAIL-CLOSED)
const ALLOWED_USER_IDS =
  process.env.TELEGRAM_ALLOWED_IDS?.split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)) || [];

if (ALLOWED_USER_IDS.length === 0) {
  console.warn(
    "[Auth] TELEGRAM_ALLOWED_IDS is empty — bot will reject ALL users (fail-closed)",
  );
}

function isAuthorized(userId: number | undefined): boolean {
  if (ALLOWED_USER_IDS.length === 0) return false; // Fail-closed: no IDs = reject all
  if (!userId) return false;
  return ALLOWED_USER_IDS.includes(userId);
}

// Rate limiting: per-user, max 10 messages per minute
const rateLimitMap = new Map<number, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(userId: number): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitMap.set(userId, recent);
  return recent.length > RATE_LIMIT_MAX;
}

// Global auth + rate-limit middleware
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId)) {
    console.log(`[Auth] Blocked user ${userId} from ${ctx.chat?.id}`);
    return;
  }
  if (userId && isRateLimited(userId)) {
    console.log(`[RateLimit] Throttled user ${userId}`);
    await ctx.reply("Slow down — too many messages. Try again in a minute.");
    return;
  }
  await next();
});

// ═══════════════════════════════════════════════════════
// Register Composers
// ═══════════════════════════════════════════════════════

bot.use(claudeComposer);

// ═══════════════════════════════════════════════════════
// Infrastructure
// ═══════════════════════════════════════════════════════

// Start notification HTTP server
const notifyServer = startNotifyServer(bot);

// Start Telegram bot
console.log("ClaudeGolem v7 (CLI Remote Control)");
console.log("Working dir:", GITS);

bot.start({
  onStart: (botInfo) => {
    console.log(`@${botInfo.username} running`);
  },
});

// Graceful shutdown — release port 3847 before exit so KeepAlive restarts cleanly
async function gracefulShutdown(signal: string) {
  console.log(`[Shutdown] ${signal} received, cleaning up...`);
  try {
    await bot.stop();
    await notifyServer.stop(true);
    console.log("[Shutdown] Server and bot stopped cleanly");
  } catch (err) {
    console.error("[Shutdown] Error during cleanup:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
