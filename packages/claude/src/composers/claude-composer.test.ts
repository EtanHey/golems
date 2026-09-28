import { describe, expect, it } from "bun:test";
import { Context } from "grammy";
import { claudeComposer } from "./claude-composer";

async function trigger(command: string): Promise<string[]> {
  const replies: string[] = [];
  const update = {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 1, type: "private" },
      from: { id: 1, is_bot: false, first_name: "Test" },
      text: command,
      entities: [{ type: "bot_command", offset: 0, length: 8 }],
    },
  } as ConstructorParameters<typeof Context>[0];
  const api = {
    sendMessage: async (_chatId: number, text: string) => {
      replies.push(text);
      return {};
    },
  } as ConstructorParameters<typeof Context>[1];
  const me = { id: 2, is_bot: true, first_name: "Bot", username: "test_bot" } as ConstructorParameters<typeof Context>[2];
  const ctx = new Context(update, api, me);
  await claudeComposer.middleware()(ctx, async () => {});
  return replies;
}

describe("/trigger help", () => {
  it("lists email and briefing, and rejects the retired jobs target", async () => {
    const help = await trigger("/trigger");
    expect(help).toHaveLength(1);
    expect(help[0]).toContain("/trigger email");
    expect(help[0]).toContain("/trigger briefing");
    expect(help[0]).not.toContain("/trigger jobs");

    const retired = await trigger("/trigger jobs");
    expect(retired).toEqual(help);
  });
});
