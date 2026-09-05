/**
 * ClaudeGolem Composer — CLI Remote Control
 *
 * System commands (/start, /status, /trigger, /morning, /tonight, /schedule, /repos)
 * and free-text passthrough to Claude CLI. No conversational UX, no personas, no forking.
 */

import { Composer, InlineKeyboard } from "grammy";
import { runJobSearch } from "@golems/jobs/index";
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
/trigger — Manual runs (email/jobs/briefing/nightshift)
/morning — Morning briefing
/tonight — Night Shift target
/schedule — Weekly rotation
/repos — Available repos

Or just type a message to spawn Claude.`,
  );
});

// /status command
claudeComposer.command("status", async (ctx) => {
  const state = loadState();
  const queueLen = queue.length;
  const { emailStats, jobStats } = await getDailyStats();

  await ctx.reply(
    `Status

Night Shift: ${state.nightShiftTarget}
Queue: ${queueLen} messages
Processing: ${isProcessing ? "yes" : "idle"}
Bot: ${Math.round(process.uptime() / 60)}min uptime${emailStats}${jobStats}`,
  );
});

// /trigger command - manual golem runs
claudeComposer.command("trigger", async (ctx) => {
  const arg = ctx.match?.trim().toLowerCase();
  if (!arg || !["email", "jobs", "briefing", "nightshift"].includes(arg)) {
    await ctx.reply(
      `Usage: /trigger <service>

/trigger email — Run email check
/trigger jobs — Run job scrape
/trigger briefing — Morning briefing
/trigger nightshift — Night Shift`,
    );
    return;
  }

  await ctx.reply(`Triggering ${arg}...`);
  try {
    if (arg === "jobs") {
      const result = await runJobSearch();
      if (result) {
        await ctx.reply(
          `Done: ${result.scraped} scraped, ${result.filtered} filtered, ${result.matched} matched`,
        );
      } else {
        await ctx.reply("Job scrape completed");
      }
    } else if (arg === "email") {
      const { processEmails } = await import("@golems/shared/email/index");
      await processEmails();
      await ctx.reply("Email check completed");
    } else if (arg === "briefing") {
      const { sendBriefing } = await import("@golems/services/briefing");
      await sendBriefing();
      await ctx.reply("Briefing sent");
    } else if (arg === "nightshift") {
      await ctx.reply(
        "Night Shift starting... This takes ~15min. I'll report back.",
      );
      const { nightShift } = await import("@golems/services/night-shift");
      const heartbeat = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 60_000);
      let results;
      try {
        results = await nightShift();
      } finally {
        clearInterval(heartbeat);
      }
      const prs = results
        .filter((r) => r.prUrl)
        .map((r) => r.prUrl)
        .join("\n");
      const summary = results
        .map(
          (r) =>
            `${r.success ? "+" : "-"} ${r.repo}: ${r.improvement || "skipped"}`,
        )
        .join("\n");
      await ctx.reply(
        `Night Shift Complete\n\n${summary}${prs ? "\n\n" + prs : ""}`,
      );
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

// /tonight command
claudeComposer.command("tonight", async (ctx) => {
  const state = loadState();
  const arg = ctx.message?.text?.split(" ")[1]?.toLowerCase();

  if (arg && state.rotation.includes(arg)) {
    state.nightShiftTarget = arg;
    saveState(state);
    await ctx.reply(`Tonight: ${arg}`);
    return;
  }

  const keyboard = new InlineKeyboard();
  state.rotation.forEach((repo) => {
    const current = repo === state.nightShiftTarget ? "+ " : "";
    keyboard.text(`${current}${repo}`, `tonight:${repo}`);
  });

  await ctx.reply(
    `Night Shift Target\nCurrent: ${state.nightShiftTarget}\n\nTap to change:`,
    { reply_markup: keyboard },
  );
});

// /schedule command - weekly Night Shift rotation
claudeComposer.command("schedule", async (ctx) => {
  const state = loadState();
  const arg = (ctx.match ?? "").trim();

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (arg === "clear") {
    delete state.weeklySchedule;
    saveState(state);
    await ctx.reply("Weekly schedule cleared. Using auto-rotation.");
    return;
  }

  if (arg && arg.includes("=")) {
    if (!state.weeklySchedule) {
      state.weeklySchedule = {};
    }
    const assignments = arg.split(/\s+/);
    for (const a of assignments) {
      const [day, repo] = a.split("=");
      const dayLower = day.toLowerCase();
      const dayIdx = DAYS.findIndex((d) => d.toLowerCase() === dayLower);
      if (dayIdx >= 0 && state.rotation.includes(repo)) {
        (state.weeklySchedule as Record<string, string>)[
          DAYS[dayIdx].toLowerCase()
        ] = repo;
      }
    }
    saveState(state);

    let msg = `Schedule Updated\n\n`;
    for (const day of DAYS) {
      const repo = (state.weeklySchedule as Record<string, string>)?.[
        day.toLowerCase()
      ];
      msg += `${day}: ${repo || "auto-rotate"}\n`;
    }
    await ctx.reply(msg);
    return;
  }

  let msg = `Night Shift Weekly Schedule\n\n`;
  msg += `Current target: ${state.nightShiftTarget}\n\n`;

  if (state.weeklySchedule && Object.keys(state.weeklySchedule).length > 0) {
    for (const day of DAYS) {
      const repo = (state.weeklySchedule as Record<string, string>)?.[
        day.toLowerCase()
      ];
      const isToday = new Date().getDay() === DAYS.indexOf(day);
      const marker = isToday ? " <-" : "";
      msg += `${day}: ${repo || "auto"}${marker}\n`;
    }
  } else {
    msg += `No weekly schedule — using auto-rotation.\n`;
    msg += `Rotation: ${state.rotation.join(" > ")}\n`;
  }

  msg += `\nSet: /schedule sun=golems mon=songscript\n`;
  msg += `Clear: /schedule clear`;

  await ctx.reply(msg);
});

// /repos command
claudeComposer.command("repos", (ctx) => {
  const state = loadState();
  ctx.reply(`Repos: ${state.rotation.join(" | ")}`);
});

// ═══════════════════════════════════════════════════════
// Callback Query Handlers
// ═══════════════════════════════════════════════════════

// Tonight repo selection
claudeComposer.callbackQuery(/^tonight:/, async (ctx) => {
  const repo = ctx.callbackQuery.data?.replace("tonight:", "") || "";
  const state = loadState();

  if (state.rotation.includes(repo)) {
    state.nightShiftTarget = repo;
    saveState(state);
    await ctx.editMessageText(`Tonight: ${repo}`);
    await ctx.answerCallbackQuery({ text: `Set to ${repo}` });
  } else {
    await ctx.answerCallbackQuery({ text: "Unknown repo" });
  }
});

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
