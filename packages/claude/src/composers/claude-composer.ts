/**
 * ClaudeGolem Composer — CLI Remote Control
 *
 * System commands (/start, /status, /trigger, /morning)
 * and free-text passthrough to Claude CLI. No conversational UX, no personas, no forking.
 */

import { Composer } from "grammy";
import {
  HOME,
  loadState,
  saveState,
  queue,
  isProcessing,
  processQueue,
  getDailyStats,
} from "../lib/bot-shared";

export const claudeComposer = new Composer();

// /start command
claudeComposer.command("start", (ctx) => {
  const state = loadState();
  state.telegramChatId = ctx.chat.id;
  saveState(state);

  ctx.reply(
    `ClaudeGolem v7

/status — Health + stats
/trigger — Manual runs (email/briefing)
/morning — Morning briefing

Or just type a message to spawn Claude.`,
  );
});

// /status command
claudeComposer.command("status", async (ctx) => {
  const queueLen = queue.length;
  const { emailStats } = await getDailyStats();

  await ctx.reply(
    `Status

Queue: ${queueLen} messages
Processing: ${isProcessing ? "yes" : "idle"}
Bot: ${Math.round(process.uptime() / 60)}min uptime${emailStats}`,
  );
});

// /trigger command - manual golem runs
claudeComposer.command("trigger", async (ctx) => {
  const arg = ctx.match?.trim().toLowerCase();
  if (!arg || !["email", "briefing"].includes(arg)) {
    await ctx.reply(
      `Usage: /trigger <service>

/trigger email — Run email check
/trigger briefing — Morning briefing`,
    );
    return;
  }

  await ctx.reply(`Triggering ${arg}...`);
  try {
    if (arg === "email") {
      const { processEmails } = await import("@golems/shared/email/index");
      await processEmails();
      await ctx.reply("Email check completed");
    } else if (arg === "briefing") {
      const { sendBriefing } = await import("@golems/services/briefing");
      await sendBriefing();
      await ctx.reply("Briefing sent");
    }
  } catch (err) {
    await ctx.reply(
      `Trigger failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
});

// /morning command
claudeComposer.command("morning", async (ctx) => {
  ctx.reply("Generating morning briefing...");
  try {
    const { sendBriefing } = await import("@golems/services/briefing");
    await sendBriefing();
  } catch (err) {
    ctx.reply(`Briefing failed: ${err}`);
  }
});

// ═══════════════════════════════════════════════════════
// Callback Query Handlers
// ═══════════════════════════════════════════════════════

// Catch-all for unknown callbacks
claudeComposer.on("callback_query:data", async (ctx) => {
  console.log("Unknown callback:", ctx.callbackQuery.data);
  await ctx.answerCallbackQuery();
});

// ═══════════════════════════════════════════════════════
// Main Message Handler — Free text → Claude CLI
// ═══════════════════════════════════════════════════════

claudeComposer.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();

  // Skip commands
  if (text.startsWith("/")) {
    return;
  }

  // Save chat ID
  const state = loadState();
  state.telegramChatId = ctx.chat.id;
  saveState(state);

  // Add to queue for Claude
  queue.push({ ctx, text });
  console.log(`Queued: "${text.slice(0, 50)}..."`);

  if (!isProcessing) {
    processQueue();
  } else if (queue.length > 1) {
    await ctx.reply(`Queued (${queue.length - 1} ahead)`);
  }
});
