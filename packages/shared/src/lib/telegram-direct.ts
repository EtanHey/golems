/**
 * Telegram Direct Sender
 *
 * Cloud services can't reach localhost:3847 (the local notification server).
 * This module sends Telegram messages directly via Bot API when TELEGRAM_MODE=direct,
 * or falls back to the local notification server when TELEGRAM_MODE=local (default).
 *
 * Chat ID and topic IDs are resolved in order:
 *   1. Environment variables (TELEGRAM_CHAT_ID, TELEGRAM_TOPIC_*)
 *   2. Supabase golem_state table (when STATE_BACKEND=supabase)
 *   3. Local state.json file
 *
 * ENV:
 *   TELEGRAM_MODE      - "local" (default) | "direct"
 *   TELEGRAM_BOT_TOKEN - Required for direct mode
 *   TELEGRAM_CHAT_ID   - Group chat ID (or read from state-store)
 *   TELEGRAM_TOPIC_*   - Thread IDs for topic routing (or read from state-store)
 */

const TELEGRAM_API = "https://api.telegram.org";
const LOCAL_NOTIFY_URL = "http://localhost:3847/notify";

// Cache resolved values to avoid repeated DB calls
let cachedChatId: string | null = null;
let cachedTopics: Record<string, number> | null = null;

/**
 * Source → topic mapping (aligned with notify-server.ts SOURCE_CONFIG).
 * The Telegram group has: general, alerts, nightshift, recruiter.
 * Most sources route to "alerts" — only interactive chat goes to "general".
 */
const SOURCE_TO_TOPIC: Record<string, string> = {
  claude: "general",
  nightshift: "nightshift",
  email: "alerts",
  jobs: "alerts",
  recruiter: "recruiter",
  briefing: "alerts",
  healthcheck: "alerts",
  uptime: "alerts",
  monitoring: "alerts",
  default: "alerts",
};

/** Source → icon + formatter (matches telegram-bot.ts) */
const SOURCE_FORMAT: Record<
  string,
  { icon: string; format: (t: string, b: string) => string }
> = {
  claude: { icon: "🤖", format: (t, b) => `🤖 *${t}*\n${b}` },
  nightshift: { icon: "🌙", format: (t, b) => `🌙 *Night Shift*\n${t}\n${b}` },
  email: { icon: "📧", format: (t, b) => `📧 *${t}*\n\n${b}` },
  jobs: { icon: "🎯", format: (t, b) => `🎯 *${t}*\n\n${b}` },
  recruiter: { icon: "👔", format: (t, b) => `👔 *${t}*\n\n${b}` },
  briefing: { icon: "☀️", format: (_t, b) => b }, // Briefing builds its own formatted message
  healthcheck: { icon: "🏥", format: (t, b) => `🏥 *${t}*\n\n${b}` },
  uptime: { icon: "📡", format: (t, b) => `📡 *${t}*\n\n${b}` },
  monitoring: { icon: "📡", format: (t, b) => `📡 *${t}*\n\n${b}` },
  default: { icon: "📨", format: (t, b) => `📨 *${t}*\n\n${b}` },
};

/** Payload for sending a Telegram notification */
export interface NotificationPayload {
  title: string;
  body: string;
  source?: string;
  priority?: string;
}

/**
 * Resolve chat ID: env var → Supabase state → local state.json
 */
async function resolveChatId(): Promise<string | null> {
  // 1. Env var (fastest)
  if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID;

  // 2. Cache
  if (cachedChatId) return cachedChatId;

  // 3. State-store (reads from Supabase or file based on STATE_BACKEND)
  try {
    const { getState } = await import("./state-store");
    const id = await getState<number>("telegramChatId");
    if (id) {
      cachedChatId = String(id);
      return cachedChatId;
    }
  } catch {
    // state-store not available
  }

  return null;
}

/**
 * Resolve topic thread IDs: env vars → Supabase state → local state.json
 */
async function resolveTopics(): Promise<Record<string, number>> {
  if (cachedTopics) return cachedTopics;

  // Check env vars first
  const fromEnv: Record<string, number> = {};
  for (const [source, topic] of Object.entries(SOURCE_TO_TOPIC)) {
    if (topic === "general") continue;
    const envKey = `TELEGRAM_TOPIC_${topic.toUpperCase()}`;
    const value = process.env[envKey];
    if (value) fromEnv[topic] = parseInt(value, 10);
  }
  if (Object.keys(fromEnv).length > 0) {
    cachedTopics = fromEnv;
    return cachedTopics;
  }

  // Fall back to state-store (topics object in state)
  try {
    const { getState } = await import("./state-store");
    const topics = await getState<Record<string, number>>("topics");
    if (topics) {
      cachedTopics = topics;
      return cachedTopics;
    }
  } catch {
    // state-store not available
  }

  return {};
}

/**
 * Resolve the thread ID for a given topic name.
 * Checks env vars first, then falls back to state-store (Supabase/file).
 * Returns undefined for "general" (no thread = main chat).
 */
async function getTopicThreadId(
  topicName: string,
): Promise<number | undefined> {
  if (topicName === "general") return undefined;

  // Try env var first (fast path)
  const envKey = `TELEGRAM_TOPIC_${topicName.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue) return parseInt(envValue, 10);

  // Fall back to resolved topics from state-store
  const topics = await resolveTopics();
  return topics[topicName];
}

/**
 * Send notification - routes to local server or direct Telegram API
 * based on TELEGRAM_MODE environment variable.
 */
export async function sendNotification(
  payload: NotificationPayload,
): Promise<boolean> {
  const mode = process.env.TELEGRAM_MODE || "local";

  if (mode === "direct") {
    return sendDirect(payload);
  }
  return sendLocal(payload);
}

/**
 * Send via local notification server (localhost:3847)
 */
async function sendLocal(payload: NotificationPayload): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (err) {
    console.error("[TelegramDirect] Local notify failed:", err);
    return false;
  }
}

/**
 * Send directly via Telegram Bot API (for cloud deployment)
 */
async function sendDirect(payload: NotificationPayload): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = await resolveChatId();

  if (!botToken || !chatId) {
    console.error(
      "[TelegramDirect] TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required for direct mode.",
      !botToken ? "Missing TELEGRAM_BOT_TOKEN." : "",
      !chatId
        ? "Missing TELEGRAM_CHAT_ID (not in env, Supabase, or state.json)."
        : "",
    );
    return false;
  }

  const source = payload.source || "default";
  const topicName = SOURCE_TO_TOPIC[source] || SOURCE_TO_TOPIC.default;
  const threadId = await getTopicThreadId(topicName);
  const formatter = SOURCE_FORMAT[source] || SOURCE_FORMAT.default;

  const priorityIcon = payload.priority === "high" ? "🔔 " : "";
  const message = priorityIcon + formatter.format(payload.title, payload.body);

  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;

  try {
    // Try Markdown first
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
    };
    if (threadId) {
      body.message_thread_id = threadId;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      console.log(`[TelegramDirect] Sent: ${payload.title} → ${topicName}`);
      return true;
    }

    // Markdown failed — check if it's a thread error
    const errText = await response.text();
    const isThreadError = errText.includes("thread not found");

    if (!isThreadError) {
      // Markdown issue — retry with plain text (keep thread ID)
      const plainMessage = message.replace(/[*_`\[\]]/g, "");
      const plainBody: Record<string, unknown> = {
        chat_id: chatId,
        text: plainMessage,
      };
      if (threadId) {
        plainBody.message_thread_id = threadId;
      }

      const retryResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plainBody),
        signal: AbortSignal.timeout(10000),
      });

      if (retryResponse.ok) {
        console.log(
          `[TelegramDirect] Sent (plain): ${payload.title} → ${topicName}`,
        );
        return true;
      }

      // Plain text also failed — check if THIS is a thread error
      const plainErrText = await retryResponse.text();
      if (!plainErrText.includes("thread not found")) {
        console.error(`[TelegramDirect] Send failed: ${plainErrText}`);
        return false;
      }
    }

    // Thread not found — fall back to sending without thread ID (General)
    if (threadId) {
      // Invalidate cached topics so next send re-resolves from state-store
      cachedTopics = null;
      console.warn(
        `[TelegramDirect] Thread ${threadId} not found for topic "${topicName}", falling back to General`,
      );
      const fallbackBody: Record<string, unknown> = {
        chat_id: chatId,
        text: message.replace(/[*_`\[\]]/g, ""),
      };

      const fallbackResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackBody),
        signal: AbortSignal.timeout(10000),
      });

      if (fallbackResponse.ok) {
        console.log(
          `[TelegramDirect] Sent (fallback to General): ${payload.title}`,
        );
        return true;
      }

      const fallbackErr = await fallbackResponse.text();
      console.error(`[TelegramDirect] Fallback also failed: ${fallbackErr}`);
      return false;
    }

    console.error(`[TelegramDirect] Send failed: ${errText}`);
    return false;
  } catch (err) {
    console.error("[TelegramDirect] Error:", err);
    return false;
  }
}

/** Reset cached values (for testing) */
export function _resetCache(): void {
  cachedChatId = null;
  cachedTopics = null;
}
