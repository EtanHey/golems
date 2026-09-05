/**
 * OllamaChat Telegram Bot
 *
 * Direct Ollama interaction via Telegram - ask questions, get answers.
 * Now with conversation memory - the bot remembers context from recent messages.
 *
 * SETUP:
 * 1. Create bot via BotFather: https://t.me/BotFather
 *    - /newbot
 *    - Name: OllamaChat (or whatever you prefer)
 *    - Username: your_ollama_chat_bot
 * 2. Copy the bot token
 * 3. Set OLLAMA_CHAT_BOT_TOKEN in .env or environment
 * 4. Run: bun run src/ollama-chat-bot.ts
 */

import { Bot, Context, Keyboard } from "grammy";
import { Ollama } from "ollama";

// Configuration
const BOT_TOKEN = process.env.OLLAMA_CHAT_BOT_TOKEN;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3-coder-64k";
const ALLOWED_USERS = (process.env.ALLOWED_TELEGRAM_USERS || "").split(",").filter(Boolean);

// Memory configuration
const MAX_HISTORY_MESSAGES = 20;  // Keep last 20 message pairs per chat
const CONTEXT_WINDOW_MESSAGES = 10;  // Use last 10 for context

if (!BOT_TOKEN) {
  console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║                    OllamaChat Bot Setup                           ║
╠═══════════════════════════════════════════════════════════════════╣
║ Bot token not found! Follow these steps:                          ║
║                                                                   ║
║ 1. Open Telegram and message @BotFather                           ║
║ 2. Send /newbot                                                   ║
║ 3. Name: "OllamaChat" (or your preference)                        ║
║ 4. Username: something unique like "your_ollama_chat_bot"         ║
║ 5. Copy the token BotFather gives you                             ║
║ 6. Set it: export OLLAMA_CHAT_BOT_TOKEN="your_token_here"         ║
║    Or add to ~/.golems-zikaron/.env                               ║
║ 7. Run again: bun run src/ollama-chat-bot.ts                      ║
╚═══════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// Initialize
const bot = new Bot(BOT_TOKEN);
const ollama = new Ollama({ host: OLLAMA_HOST });

// Conversation memory - per chat ID
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}
const conversationHistory: Map<number, ChatMessage[]> = new Map();

// Get or create conversation history for a chat
function getHistory(chatId: number): ChatMessage[] {
  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, []);
  }
  return conversationHistory.get(chatId)!;
}

// Add message to history and trim if needed
function addToHistory(chatId: number, role: "user" | "assistant", content: string) {
  const history = getHistory(chatId);
  history.push({ role, content, timestamp: new Date() });

  // Trim to max history
  while (history.length > MAX_HISTORY_MESSAGES * 2) {
    history.shift();
  }
}

// Clear history for a chat
function clearHistory(chatId: number) {
  conversationHistory.set(chatId, []);
}

// Message queue for when Ollama is busy
interface QueuedMessage {
  chatId: number;
  text: string;
  timestamp: Date;
}
const messageQueue: QueuedMessage[] = [];
let isProcessing = false;

// User authorization check
function isAuthorized(ctx: Context): boolean {
  if (ALLOWED_USERS.length === 0) return true; // No restriction if not configured
  const userId = ctx.from?.id?.toString() || "";
  const username = ctx.from?.username || "";
  return ALLOWED_USERS.includes(userId) || ALLOWED_USERS.includes(username);
}

// Process message with Ollama (includes conversation history for context)
async function processWithOllama(chatId: number, prompt: string): Promise<string> {
  try {
    // Build messages array with history for context
    const history = getHistory(chatId);
    const contextMessages = history.slice(-CONTEXT_WINDOW_MESSAGES * 2);

    // Build system prompt that explicitly mentions the conversation history
    const historyCount = contextMessages.length;
    const systemContent = historyCount > 0
      ? `You are a helpful AI assistant chatting via Telegram. Be concise.

IMPORTANT: You have FULL ACCESS to the conversation history shown above. The previous ${historyCount} messages are YOUR conversation with this user. When asked about "my last message" or "what did I say", refer to the user messages in the history above. DO NOT say you don't have access to past conversations - you DO have access, it's shown above.`
      : "You are a helpful AI assistant chatting via Telegram. Be concise but helpful.";

    const messages = [
      // System prompt for context
      {
        role: "system" as const,
        content: systemContent
      },
      // Previous conversation context
      ...contextMessages.map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content
      })),
      // Current message
      { role: "user" as const, content: prompt }
    ];

    // Debug log
    console.log(`[Ollama] Sending ${messages.length} messages (${historyCount} from history)`);

    const response = await ollama.chat({
      model: DEFAULT_MODEL,
      messages,
      stream: false,
    });

    // Store both user message and response in history
    addToHistory(chatId, "user", prompt);
    addToHistory(chatId, "assistant", response.message.content);

    return response.message.content;
  } catch (error) {
    console.error("Ollama error:", error);
    return `Error communicating with Ollama: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

// Process queued messages
async function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;

  isProcessing = true;

  while (messageQueue.length > 0) {
    const msg = messageQueue.shift()!;
    const response = await processWithOllama(msg.chatId, msg.text);

    try {
      await bot.api.sendMessage(msg.chatId, response, { parse_mode: "Markdown" });
    } catch (error) {
      console.warn("[Bot] Markdown failed, falling back to plain:", (error as Error).message);
      await bot.api.sendMessage(msg.chatId, response);
    }
  }

  isProcessing = false;
}

// Persistent reply keyboard
const mainKeyboard = new Keyboard()
  .text("💾 Memory").text("🧹 Clear").row()
  .text("📊 Status").text("🤖 Models").row()
  .resized()
  .persistent();

// Command handlers
bot.command("start", async (ctx) => {
  if (!isAuthorized(ctx)) {
    await ctx.reply("Unauthorized. Contact admin to get access.");
    return;
  }

  await ctx.reply(`
🤖 *OllamaGolem*

I'm connected to Ollama (${DEFAULT_MODEL}).

*Commands:*
/ask <question> - Ask Ollama directly
/model - Show current model
/models - List available models
/status - Check Ollama status
/clear - Clear conversation history
/memory - Show memory stats

Or just send me any message and I'll respond!

💾 *Memory:* I remember our conversation (last ${CONTEXT_WINDOW_MESSAGES} messages).
  `, { parse_mode: "Markdown", reply_markup: mainKeyboard });
});

bot.command("status", async (ctx) => {
  if (!isAuthorized(ctx)) return;

  try {
    const tags = await ollama.list();
    const models = tags.models.map(m => m.name).join(", ");
    await ctx.reply(`✅ Ollama is running\nModels: ${models}\nCurrent: ${DEFAULT_MODEL}`);
  } catch (error) {
    await ctx.reply(`❌ Ollama not responding: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});

bot.command("models", async (ctx) => {
  if (!isAuthorized(ctx)) return;

  try {
    const tags = await ollama.list();
    const modelList = tags.models.map(m => `• ${m.name}`).join("\n");
    await ctx.reply(`*Available models:*\n${modelList}`, { parse_mode: "Markdown" });
  } catch (error) {
    await ctx.reply("Error fetching models");
  }
});

bot.command("model", async (ctx) => {
  if (!isAuthorized(ctx)) return;
  await ctx.reply(`Current model: ${DEFAULT_MODEL}`);
});

bot.command("clear", async (ctx) => {
  if (!isAuthorized(ctx)) return;
  clearHistory(ctx.chat.id);
  await ctx.reply("🧹 Conversation history cleared. Starting fresh!");
});

bot.command("memory", async (ctx) => {
  if (!isAuthorized(ctx)) return;
  const history = getHistory(ctx.chat.id);
  const messageCount = history.length;
  const oldestTime = history.length > 0
    ? history[0].timestamp.toLocaleString()
    : "N/A";
  await ctx.reply(`
💾 *Memory Stats*
Messages in history: ${messageCount}
Context window: Last ${CONTEXT_WINDOW_MESSAGES} exchanges
Oldest message: ${oldestTime}
  `, { parse_mode: "Markdown" });
});

bot.command("ask", async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const question = ctx.match;
  if (!question) {
    await ctx.reply("Usage: /ask <your question>");
    return;
  }

  await ctx.reply("🤔 Thinking...");
  const response = await processWithOllama(ctx.chat.id, question);
  await ctx.reply(response);
});

// Handle regular messages
bot.on("message:text", async (ctx) => {
  if (!isAuthorized(ctx)) return;

  const text = ctx.message.text;
  if (text.startsWith("/")) return; // Skip commands

  // Handle keyboard button presses
  if (text === "💾 Memory") {
    const history = getHistory(ctx.chat.id);
    const messageCount = history.length;
    const oldestTime = history.length > 0 ? history[0].timestamp.toLocaleString() : "N/A";
    await ctx.reply(`💾 *Memory Stats*\nMessages: ${messageCount}\nContext: Last ${CONTEXT_WINDOW_MESSAGES}\nOldest: ${oldestTime}`, { parse_mode: "Markdown" });
    return;
  }
  if (text === "🧹 Clear") {
    clearHistory(ctx.chat.id);
    await ctx.reply("🧹 Conversation history cleared!");
    return;
  }
  if (text === "📊 Status") {
    try {
      const tags = await ollama.list();
      await ctx.reply(`✅ Ollama running\nModel: ${DEFAULT_MODEL}\nAvailable: ${tags.models.length}`);
    } catch (e) {
      await ctx.reply(`❌ Ollama error: ${e}`);
    }
    return;
  }
  if (text === "🤖 Models") {
    try {
      const tags = await ollama.list();
      const modelList = tags.models.map(m => `• ${m.name}`).join("\n");
      await ctx.reply(`*Models:*\n${modelList}`, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply("Error fetching models");
    }
    return;
  }

  if (isProcessing) {
    messageQueue.push({
      chatId: ctx.chat.id,
      text,
      timestamp: new Date(),
    });
    await ctx.reply(`📥 Queued (${messageQueue.length} in queue). I'll respond when ready.`);
    return;
  }

  await ctx.reply("🤔 Thinking...");
  const response = await processWithOllama(ctx.chat.id, text);

  try {
    await ctx.reply(response, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(response);
  }

  // Process any queued messages
  processQueue();
});

// Utility function to send proactive notifications
export async function notifyUser(chatId: number, message: string) {
  try {
    await bot.api.sendMessage(chatId, message);
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
}

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.log(`\n[Bot] Received ${signal}, shutting down gracefully...`);
  try {
    await bot.stop();
    console.log("[Bot] Stopped successfully");
    process.exit(0);
  } catch (error) {
    console.error("[Bot] Error during shutdown:", error);
    process.exit(1);
  }
}

// Register signal handlers for clean shutdown
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start the bot with exponential backoff retry on 409 conflict
async function startBot(maxAttempts = 4) {
  console.log("🤖 OllamaChat bot starting...");
  console.log(`   Model: ${DEFAULT_MODEL}`);
  console.log(`   Ollama: ${OLLAMA_HOST}`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await bot.start();
      console.log("✅ OllamaChat bot running");
      return;
    } catch (err: any) {
      if (err?.error_code === 409 && i < maxAttempts - 1) {
        // Exponential backoff: 30s, 60s, 120s
        const delaySeconds = 30 * Math.pow(2, i);
        console.log(`[Bot] 409 conflict detected - previous instance still active`);
        console.log(`[Bot] Waiting ${delaySeconds}s before retry ${i + 2}/${maxAttempts}...`);
        await new Promise(r => setTimeout(r, delaySeconds * 1000));
      } else {
        throw err;
      }
    }
  }
}

startBot().catch(err => {
  console.error("[Bot] Failed to start:", err);
  process.exit(1);
});
