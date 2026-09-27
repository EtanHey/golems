import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCCUsageEvent, parseTranscript } from "./cc-axiom-reporter.ts";

let dir: string;

function assistant(model: string, usage: Record<string, number>, timestamp: string): string {
  return JSON.stringify({ type: "assistant", timestamp, message: { model, usage } });
}

function transcript(lines: string[]): string {
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

const META = { sessionId: "fixture-session", project: "golems", branch: "master", host: "fixture-host" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-axiom-reporter-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cc-axiom-reporter event", () => {
  it("reports tokens only — no cost estimate from a pricing table that lacks current models", () => {
    const path = transcript([
      JSON.stringify({ type: "user", message: { content: "not counted" } }),
      assistant(
        "claude-opus-5-5",
        { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
        "2026-09-27T10:00:00Z",
      ),
      assistant("claude-opus-5-5", { input_tokens: 10, output_tokens: 5 }, "2026-09-27T10:05:00Z"),
      assistant("claude-sonnet-5", { input_tokens: 1, output_tokens: 1 }, "2026-09-27T10:06:00Z"),
    ]);

    const event = buildCCUsageEvent(parseTranscript(path), META);

    expect(event).not.toHaveProperty("cost_estimate_usd");
    expect(event).toMatchObject({
      model: "claude-opus-5-5",
      input_tokens: 111,
      output_tokens: 56,
      cache_read_tokens: 1000,
      cache_write_tokens: 200,
      message_count: 3,
      started_at: "2026-09-27T10:00:00Z",
      ended_at: "2026-09-27T10:06:00Z",
      source: "session-end-hook",
    });
  });
});
