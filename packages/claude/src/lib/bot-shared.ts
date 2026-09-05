/**
 * Bot Shared Module
 *
 * Shared state and functions used by telegram-bot.ts and claude-composer.ts.
 * Stripped to essentials: state management, Claude CLI spawning, message queue.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  logEvent,
  getRecentEvents,
  formatEventsForClaude,
} from "@golems/shared/lib/event-log";
import { logMessagePipeline } from "@golems/shared/lib/axiom";
import { getSupabase } from "@golems/shared/lib/supabase-factory";

// ═══════════════════════════════════════════════════════
// Constants & Paths
// ═══════════════════════════════════════════════════════

export const HOME = process.env.HOME || homedir();
export const GITS = join(HOME, "Gits");
export const STATE_FILE = join(HOME, ".golems-zikaron/state.json");
export const SOUL_FILE = join(GITS, "golems/packages/claude/SOUL.md");

// ═══════════════════════════════════════════════════════
// State Management
// ═══════════════════════════════════════════════════════

export interface State {
  nightShiftTarget: string;
  rotation: string[];
  telegramChatId: number | null;
  nightShiftPRs: Array<{ url: string; repo: string; createdAt: string }>;
  lastNightShift: string | null;
  groupChatId?: number;
  topics?: {
    alerts?: number;
  };
  weeklySchedule?: Record<string, string>;
}

export function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch (err) {
    console.warn(
      "[State] Failed to load, using defaults:",
      (err as Error).message,
    );
    return {
      nightShiftTarget: "songscript",
      rotation: ["songscript", "brainlayer", "claude-golem"],
      telegramChatId: null,
      nightShiftPRs: [],
      lastNightShift: null,
    };
  }
}

export function saveState(state: State) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ═══════════════════════════════════════════════════════
// Message Queue
// ═══════════════════════════════════════════════════════

export let isProcessing = false;
export const queue: Array<{ ctx: any; text: string }> = [];

function setIsProcessing(value: boolean) {
  isProcessing = value;
}

// ═══════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════

export async function notify(title: string, message: string) {
  try {
    const { $ } = await import("bun");
    const escaped = message.replace(/["'\\]/g, " ").slice(0, 100);
    await $`osascript -e ${'display notification "' + escaped + '" with title "' + title + '"'}`.quiet();
  } catch (e) {
    console.error("Notify error:", e);
  }
}

export async function getDailyStats(): Promise<{
  emailStats: string;
  jobStats: string;
}> {
  try {
    const supabase = getSupabase();
    if (!supabase) return { emailStats: "", jobStats: "" };
    const today = new Date().toISOString().slice(0, 10);
    const [emailsToday, urgentEmails, jobsToday] = await Promise.all([
      supabase
        .from("emails")
        .select("id", { count: "exact", head: true })
        .gte("received_at", today),
      supabase
        .from("emails")
        .select("id", { count: "exact", head: true })
        .gte("score", 8)
        .eq("notified", false),
      supabase
        .from("golem_jobs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", today),
    ]);
    return {
      emailStats: `\nEmails today: ${emailsToday.count || 0}${(urgentEmails.count || 0) > 0 ? ` (${urgentEmails.count} urgent!)` : ""}`,
      jobStats: `\nJobs today: ${jobsToday.count || 0}`,
    };
  } catch {
    return { emailStats: "", jobStats: "" };
  }
}

// ═══════════════════════════════════════════════════════
// Claude CLI Spawning
// ═══════════════════════════════════════════════════════

function getSystemPromptContent(): string {
  try {
    const content = readFileSync(SOUL_FILE, "utf-8");
    return content;
  } catch (err) {
    console.error(
      `[Soul] Failed to load ${SOUL_FILE}:`,
      (err as Error).message,
    );
    return "";
  }
}

export async function askClaude(
  message: string,
  onHeartbeat?: () => void,
): Promise<string> {
  const now = new Date();
  const timeStr = now.toLocaleString("en-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dateStr = now.toLocaleDateString("en-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const prompt = `Be brief (under 500 chars). You are ClaudeGolem.\n\n[${dateStr} ${timeStr} IL] ${message}`;

  const BOT_WORKING_DIR = join(HOME, "Gits");

  try {
    if (!existsSync(BOT_WORKING_DIR)) {
      mkdirSync(BOT_WORKING_DIR, { recursive: true });
    }

    const recentEvents = await getRecentEvents(24);
    const eventSummary = formatEventsForClaude(recentEvents);
    const soulContent = getSystemPromptContent();
    const systemPrompt = `${soulContent}

## While You Were Down
${eventSummary}`;

    const args = [
      process.env.CLAUDE_BIN || join(HOME, ".local/bin/claude"),
      "--dangerously-skip-permissions",
      "--print",
      "--continue",
      "--system-prompt",
      systemPrompt,
      prompt,
    ];

    const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env;
    const proc = Bun.spawn(args, {
      cwd: BOT_WORKING_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...cleanEnv, HOME },
    });

    const timeout = setTimeout(() => {
      proc.kill();
      console.error("Claude timeout (5 min)");
    }, 300000);

    const heartbeat = onHeartbeat
      ? setInterval(() => {
          console.log("[Claude] Still working...");
          onHeartbeat();
        }, 60000)
      : null;

    await proc.exited;
    clearTimeout(timeout);
    if (heartbeat) clearInterval(heartbeat);

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    if (stderr) {
      console.error("[Claude] stderr:", stderr.slice(0, 200));
    }
    if (!output.trim()) {
      console.warn("[Claude] Empty stdout, exit code:", proc.exitCode);
    }
    return output.trim() || "No response.";
  } catch (error) {
    console.error("Claude error:", error);
    return "Error.";
  }
}

// ═══════════════════════════════════════════════════════
// Queue Processing
// ═══════════════════════════════════════════════════════

export async function processQueue() {
  if (isProcessing || queue.length === 0) return;

  setIsProcessing(true);
  const { ctx, text } = queue.shift()!;
  const messageId = ctx.message?.message_id
    ? `tg-${ctx.message.message_id}`
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pipelineStart = Date.now();

  logMessagePipeline({
    message_id: messageId,
    golem_name: "claudegolem",
    phase: "receive",
    latency_ms: 0,
    success: true,
  });

  try {
    await ctx.replyWithChatAction("typing");

    console.log(`Spawning Claude for: "${text.slice(0, 50)}..."`);
    await notify("ClaudeGolem", `Processing: ${text.slice(0, 50)}...`);

    const processStart = Date.now();
    const response = await askClaude(text, async () => {
      await ctx.replyWithChatAction("typing");
    });
    const processMs = Date.now() - processStart;

    logMessagePipeline({
      message_id: messageId,
      golem_name: "claudegolem",
      phase: "process",
      latency_ms: processMs,
      success: true,
      response_length: response.length,
    });

    console.log(`Claude responded (${response.length} chars, ${processMs}ms)`);
    await notify("Claude Done", response.slice(0, 80));

    logEvent(
      "telegram_message_out",
      {
        preview: response.slice(0, 120),
        length: response.length,
        prompt: text.slice(0, 80),
      },
      "claudegolem",
    ).catch((err: unknown) => {
      console.warn(
        "[BotShared] Event log failed:",
        err instanceof Error ? err.message : err,
      );
    });

    if (response.length > 4000) {
      const chunks = response.match(/.{1,4000}/gs) || [response];
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(response);
    }

    logMessagePipeline({
      message_id: messageId,
      golem_name: "claudegolem",
      phase: "respond",
      latency_ms: Date.now() - pipelineStart,
      success: true,
      response_length: response.length,
    });
  } catch (error) {
    const totalMs = Date.now() - pipelineStart;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Error:", error);

    logMessagePipeline({
      message_id: messageId,
      golem_name: "claudegolem",
      phase: "respond",
      latency_ms: totalMs,
      success: false,
      error_type: "processing_error",
      error_message: errMsg,
    });

    await ctx.reply("Error processing message.");
  }

  setIsProcessing(false);
  processQueue();
}
