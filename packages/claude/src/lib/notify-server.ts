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
  getState: () => State,
): Promise<
  | { ok: true; delivered: true; message_id: number }
  | {
      ok: false;
      delivered: false;
      reason: "destination_unavailable" | "delivery_failed";
    }
> {
  const state = getState();
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
    return {
      ok: false,
      delivered: false,
      reason: "destination_unavailable",
    };
  }

  try {
    const sendOptions: Record<string, unknown> = {};
    if (threadId) {
      sendOptions.message_thread_id = threadId;
    }

    const sentMessage = await bot.api.sendMessage(chatId, message, sendOptions);
    console.log(`[Notify] Sent: ${data.title} -> ${config.topic}`);
    return {
      ok: true,
      delivered: true,
      message_id: sentMessage.message_id,
    };
  } catch {
    console.error("[Notify] Telegram send failed");
    return { ok: false, delivered: false, reason: "delivery_failed" };
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface NotifyServerOptions {
  port?: number;
  loadState?: () => State;
}

/**
 * Start the notification HTTP server.
 * Returns the Bun.Server instance for graceful shutdown.
 */
export function startNotifyServer(
  bot: Bot,
  options: NotifyServerOptions = {},
) {
  const port = options.port ?? NOTIFY_PORT;
  const getState = options.loadState ?? loadState;
  const server = Bun.serve({
    port,
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
          const result = await sendNotificationToTelegram(bot, data, getState);
          if (result.ok) return jsonResponse(result);
          if (result.reason === "destination_unavailable") {
            return jsonResponse(
              {
                ok: false,
                delivered: false,
                error: "notification destination unavailable",
              },
              503,
            );
          }
          return jsonResponse(
            {
              ok: false,
              delivered: false,
              error: "notification delivery failed",
            },
            502,
          );
        } catch {
          console.error("[Notify] Request failed");
          return new Response("error", { status: 500 });
        }
      }

      return new Response("not found", { status: 404 });
    },
  });

  console.log(`Notification server on port ${server.port}`);
  return server;
}
