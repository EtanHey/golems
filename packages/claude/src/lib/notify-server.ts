/**
 * Notification Server
 *
 * HTTP server on port 3847 that receives POST /notify from Claude hooks,
 * launchd services, and other processes. Routes notifications to Telegram
 * group topics based on source.
 */

import type { Bot } from "grammy";
import { loadState, type State } from "./bot-shared";

const NOTIFY_PORT = 3847;
const MAX_BODY_SIZE = 4096;

// Per-source notification styles and topic routing
// Only two topics: General (interactive chat) and Alerts (one-way updates)
const SOURCE_CONFIG: Record<
  string,
  {
    icon: string;
    topic: keyof NonNullable<State["topics"]> | "general";
    format: (t: string, b: string) => string;
  }
> = {
  claude: {
    icon: "bot",
    topic: "general",
    format: (t, b) => `${t}\n${b}`,
  },
  nightshift: {
    icon: "moon",
    topic: "alerts",
    format: (t, b) => `Night Shift\n${t}\n${b}`,
  },
  email: {
    icon: "mail",
    topic: "alerts",
    format: (t, b) => `${t}\n\n${b}`,
  },
  jobs: {
    icon: "target",
    topic: "alerts",
    format: (t, b) => `${t}\n\n${b}`,
  },
  recruiter: {
    icon: "tie",
    topic: "alerts",
    format: (t, b) => `${t}\n\n${b}`,
  },
  teller: {
    icon: "money",
    topic: "alerts",
    format: (t, b) => `${t}\n\n${b}`,
  },
  bedtime: {
    icon: "moon",
    topic: "alerts",
    format: (t, b) => `${t}\n\n${b}`,
  },
  healthcheck: {
    icon: "hospital",
    topic: "alerts",
    format: (t, b) => `${t}\n\n${b}`,
  },
  default: {
    icon: "envelope",
    topic: "alerts",
    format: (t, b) => `${t}\n\n${b}`,
  },
};

// Validate incoming notification payload
function validateNotifyPayload(
  data: unknown,
): { title: string; body: string; source?: string; priority?: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.title !== "string" || !obj.title.trim()) return null;
  if (typeof obj.body !== "string") return null;
  return {
    title: obj.title.trim().slice(0, 200),
    body: String(obj.body).slice(0, 2000),
    source:
      typeof obj.source === "string" ? obj.source.slice(0, 50) : undefined,
    priority:
      typeof obj.priority === "string" ? obj.priority.slice(0, 20) : undefined,
  };
}

async function sendNotificationToTelegram(
  bot: Bot,
  data: {
    title: string;
    body: string;
    priority?: string;
    source?: string;
  },
) {
  const state = loadState();
  const config =
    SOURCE_CONFIG[data.source || "default"] || SOURCE_CONFIG.default;
  const priorityPrefix = data.priority === "high" ? "[!] " : "";
  const message = priorityPrefix + config.format(data.title, data.body);

  let chatId: number | null = null;
  let threadId: number | undefined = undefined;

  if (state.groupChatId && state.topics) {
    chatId = state.groupChatId;
    threadId =
      config.topic === "general"
        ? undefined
        : state.topics[config.topic as keyof typeof state.topics];
    console.log(
      `[Notify] Routing to group ${chatId}, topic ${config.topic} (thread ${threadId ?? "General"})`,
    );
  } else if (state.telegramChatId) {
    chatId = state.telegramChatId;
    console.log(`[Notify] Fallback to DM ${chatId}`);
  }

  if (!chatId) {
    console.log("[Notify] No chat ID saved, skipping");
    return;
  }

  try {
    const sendOptions: Record<string, unknown> = {};
    if (threadId) {
      sendOptions.message_thread_id = threadId;
    }

    await bot.api.sendMessage(chatId, message, sendOptions);
    console.log(`[Notify] Sent: ${data.title} -> ${config.topic}`);
  } catch (err) {
    console.error("[Notify] Failed:", err);
  }
}

/**
 * Start the notification HTTP server.
 * Returns the Bun.Server instance for graceful shutdown.
 */
export function startNotifyServer(bot: Bot) {
  const server = Bun.serve({
    port: NOTIFY_PORT,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", service: "notify-server" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (req.method === "POST" && url.pathname === "/notify") {
        // Reject oversized bodies
        const contentLength = req.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
          return new Response("payload too large", { status: 413 });
        }

        try {
          const raw = await req.json();
          const data = validateNotifyPayload(raw);
          if (!data) {
            return new Response("invalid payload: title (string) required", {
              status: 400,
            });
          }
          await sendNotificationToTelegram(bot, data);
          return new Response("ok");
        } catch (err) {
          console.error("[Notify] Error:", err);
          return new Response("error", { status: 500 });
        }
      }

      return new Response("not found", { status: 404 });
    },
  });

  console.log(`Notification server on port ${NOTIFY_PORT}`);
  return server;
}
