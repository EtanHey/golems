import tmi from "tmi.js";
import { createWriteStream } from "fs";

const channel = process.env.TWITCH_CHANNEL ?? "theo";
const output = process.env.CHAT_OUTPUT;
const preflightMode =
  process.env.STALKER_CHAT_PREFLIGHT === "1" && channel === "__golems_preflight__";

if (!output) {
  console.error("[lurk] CHAT_OUTPUT is required");
  process.exit(2);
}

const client = preflightMode
  ? {
      on: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
    }
  : new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      channels: [channel],
    });

const seen = new Set<string>();
const outputStream = createWriteStream(output, { flags: "a" });
const pendingLines: string[] = [];
let backpressured = false;
let writeFailed = false;

const failLurker = (error: unknown) => {
  if (writeFailed) return;
  writeFailed = true;
  console.error(`[lurk] Output failure: ${error}`);
  void client
    .disconnect()
    .catch(() => undefined)
    .finally(() => process.exit(1));
};

const writeLine = (line: string) => {
  if (writeFailed) return;
  if (backpressured) {
    pendingLines.push(line);
    return;
  }
  backpressured = !outputStream.write(line);
};

outputStream.on("drain", () => {
  backpressured = false;
  while (pendingLines.length > 0 && !backpressured && !writeFailed) {
    const line = pendingLines.shift();
    if (line !== undefined) backpressured = !outputStream.write(line);
  }
});
outputStream.on("error", failLurker);

client.on("message", (_channel, tags, message, self) => {
  if (self) return;
  const ts = new Date().toISOString().slice(11, 19);
  const user = tags["display-name"] ?? tags.username ?? "?";
  const key = tags.id ?? `${ts}-${user}-${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 10_000) {
    const retained = [...seen].slice(5_000);
    seen.clear();
    retained.forEach((item) => seen.add(item));
  }
  const line = `[${ts}] ${user}: ${message}`;
  console.log(line);
  writeLine(`${line}\n`);
});

outputStream.on("open", () => {
  client
    .connect()
    .then(() => {
      console.log(`[lurk] Connected to ${channel}`);
      console.log(`[lurk] Logging to ${output}`);
    })
    .catch((error) => {
      console.error(`[lurk] Connection failed: ${error}`);
      process.exit(1);
    });
});

setInterval(() => {}, 60_000);
