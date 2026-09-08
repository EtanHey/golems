import { afterEach, describe, expect, it } from "bun:test";
import type { Bot } from "grammy";

import { startNotifyServer } from "./notify-server";
import type { State } from "./bot-shared";

const baseState: State = {
  nightShiftTarget: "songscript",
  rotation: [],
  telegramChatId: null,
  nightShiftPRs: [],
  lastNightShift: null,
};

const servers: Bun.Server<undefined>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

function startTestServer(
  sendMessage: (...args: unknown[]) => Promise<{ message_id: number }>,
  state: State,
) {
  const bot = { api: { sendMessage } } as unknown as Bot;
  const server = startNotifyServer(bot, { port: 0, loadState: () => state });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

async function postNotify(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("notification delivery receipts", () => {
  it("returns non-2xx when no Telegram destination is configured", async () => {
    const sendMessage = async () => ({ message_id: 1 });
    const response = await postNotify(
      startTestServer(sendMessage, baseState),
      { title: "Stalker", body: "Digest ready", source: "stalker" },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      delivered: false,
      error: "notification destination unavailable",
    });
  });

  it("returns non-2xx when Telegram rejects the send", async () => {
    const sendMessage = async () => {
      throw new Error("secret Telegram rejection details");
    };
    const response = await postNotify(
      startTestServer(sendMessage, { ...baseState, telegramChatId: 123 }),
      { title: "Stalker", body: "Digest ready", source: "stalker" },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      delivered: false,
      error: "notification delivery failed",
    });
  });

  it("returns the actual Telegram message id after an accepted send", async () => {
    const calls: unknown[][] = [];
    const sendMessage = async (...args: unknown[]) => {
      calls.push(args);
      return { message_id: 8675309 };
    };
    const response = await postNotify(
      startTestServer(sendMessage, { ...baseState, telegramChatId: 123 }),
      { title: "Stalker", body: "Digest ready", source: "stalker" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      delivered: true,
      message_id: 8675309,
    });
    expect(calls).toHaveLength(1);
  });
});

describe("notification request validation", () => {
  it("keeps malformed payloads as HTTP 400", async () => {
    const response = await postNotify(
      startTestServer(async () => ({ message_id: 1 }), baseState),
      { body: "missing title" },
    );

    expect(response.status).toBe(400);
  });

  it("keeps malformed JSON as HTTP 500", async () => {
    const baseUrl = startTestServer(
      async () => ({ message_id: 1 }),
      baseState,
    );
    const response = await fetch(`${baseUrl}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });

    expect(response.status).toBe(500);
  });

  it("keeps oversized payloads as HTTP 413", async () => {
    const response = await postNotify(
      startTestServer(async () => ({ message_id: 1 }), baseState),
      { title: "Stalker", body: "x".repeat(5000) },
    );

    expect(response.status).toBe(413);
  });
});
