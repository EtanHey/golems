import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jev, jevShadow, voteMostCautious, type JevTransport } from "../lib/jev";

const ORIGINAL_ENV = { ...process.env };
let stateDir: string;

const questions = [
  {
    id: "urgent",
    type: "noul" as const,
    instructions: "Is this urgent?",
    fallbackAnswer: 0,
  },
];

beforeEach(() => {
  stateDir = mkdtempSync(join(process.cwd(), "docs.local", "jev-test-"));
  process.env = { ...ORIGINAL_ENV, TYPESAFE_API_KEY: "secret-test-key" };
  delete process.env.CI;
  delete process.env.JEV_ENABLED;
  delete process.env.JEV_SITE_GATE;
  delete process.env.JEV_DAILY_USD_CAP;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  rmSync(stateDir, { recursive: true, force: true });
});

function fakeTransport(answer = 0.91): JevTransport {
  return async (payload) => ({
    model: "jev-1.13.0",
    answers: { urgent: { type: "noul", noul: answer } },
    usage: { input_tokens: 100, output_tokens: 10 },
  });
}

describe("jev", () => {
  it("sanitizes state, defaults to shadow, and logs no raw state", async () => {
    let sentState: unknown;
    const transport: JevTransport = async (payload) => {
      sentState = payload.state;
      return fakeTransport()(payload, "ignored");
    };

    const result = await jev({ message: "private text", token: "remove-me" }, questions, (state) => ({ message: (state as { message: string }).message }), {
      site: "gate",
      stateDir,
      transport,
    });

    expect(sentState).toEqual({ message: "private text" });
    expect(result[0]).toMatchObject({
      answer: 0,
      acted: false,
      source: "fallback",
    });
    const log = readFileSync(join(stateDir, "decisions.jsonl"), "utf8");
    expect(log).not.toContain("private text");
    expect(log).not.toContain("remove-me");
    expect(JSON.parse(log)).toMatchObject({
      answer: 0.91,
      confidence: null,
      acted: false,
    });
  });

  it("returns typed vendor answers only in on mode", async () => {
    process.env.JEV_SITE_GATE = "on";
    const result = await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      transport: fakeTransport(0.83),
    });
    expect(result[0]).toMatchObject({
      type: "noul",
      answer: 0.83,
      acted: true,
      source: "jev",
    });
  });

  it("returns observable vendor answers in explicit shadow evaluation mode without acting", async () => {
    const result = await jevShadow("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      transport: fakeTransport(0.84),
    });
    expect(result[0]).toMatchObject({ answer: 0.84, acted: false, source: "jev" });
    expect(JSON.parse(readFileSync(join(stateDir, "decisions.jsonl"), "utf8"))).toMatchObject({ acted: false, fallback_reason: null });
  });

  it("refuses shadow evaluation unless the effective mode is shadow", async () => {
    let calls = 0;
    const transport: JevTransport = async (...args) => {
      calls += 1;
      return fakeTransport()(...args);
    };
    process.env.JEV_SITE_GATE = "on";
    await expect(
      jevShadow("state", questions, (state) => state, {
        site: "gate",
        stateDir,
        transport,
      }),
    ).rejects.toThrow("requires shadow mode");
    process.env.JEV_SITE_GATE = "shadow";
    process.env.JEV_ENABLED = "0";
    await expect(jevShadow("state", questions, (state) => state, { site: "gate", stateDir, transport })).rejects.toThrow("requires shadow mode");
    expect(calls).toBe(0);
  });

  it("reads kill switches per call and never calls the network in CI", async () => {
    let calls = 0;
    const transport: JevTransport = async (...args) => {
      calls += 1;
      return fakeTransport()(...args);
    };
    process.env.JEV_ENABLED = "0";
    await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      transport,
    });
    process.env.JEV_ENABLED = "1";
    process.env.CI = "1";
    await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      transport,
    });
    expect(calls).toBe(0);
  });

  it("fails to fallback before a request can exceed the daily cap", async () => {
    process.env.JEV_DAILY_USD_CAP = "0.001";
    let calls = 0;
    const result = await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      transport: async (...args) => {
        calls += 1;
        return fakeTransport()(...args);
      },
    });
    expect(calls).toBe(0);
    expect(result[0].answer).toBe(0);
  });

  it("reclaims only an expired lock whose owner is no longer alive", async () => {
    process.env.JEV_SITE_GATE = "on";
    const lock = join(stateDir, ".cost.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "stale", pid: 99_999_999, created_ms: 0 }));
    const result = await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      transport: fakeTransport(0.72),
      timeoutMs: 5,
    });
    expect(result[0].answer).toBe(0.72);
  });

  it("bounds custom transports and releases the cost lock", async () => {
    const result = await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      timeoutMs: 5,
      transport: async () => await new Promise<Awaited<ReturnType<JevTransport>>>(() => undefined),
    });
    expect(result[0].answer).toBe(0);
    expect(JSON.parse(readFileSync(join(stateDir, "usage.jsonl"), "utf8"))).toMatchObject({
      reserved_input_tokens: 64_000,
      cost_usd: 64_000 * (0.042 / 1_000_000),
    });
    expect(() => mkdirSync(join(stateDir, ".cost.lock"))).not.toThrow();
  });

  it("reserves under the lock but lets concurrent shadow calls all reach the vendor", async () => {
    process.env.JEV_DAILY_USD_CAP = String(8 * 64_000 * (0.042 / 1_000_000));
    let calls = 0;
    const transport: JevTransport = async (...args) => {
      calls += 1;
      await Bun.sleep(5);
      return fakeTransport(0.77)(...args);
    };
    const results = await Promise.all(Array.from({ length: 8 }, () => jevShadow("state", questions, (state) => state, { site: "gate", stateDir, transport })));
    expect(calls).toBe(8);
    expect(results.every((result) => result[0].answer === 0.77 && !result[0].acted && result[0].source === "jev")).toBeTrue();
    const usage = readFileSync(join(stateDir, "usage.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(usage.reduce((sum, row) => sum + row.cost_usd, 0)).toBeCloseTo(8 * 100 * (0.042 / 1_000_000), 12);
  });

  it("never admits concurrent worst-case reservations above the hard cap", async () => {
    process.env.JEV_DAILY_USD_CAP = String(2 * 64_000 * (0.042 / 1_000_000));
    let calls = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: JevTransport = async (...args) => {
      calls += 1;
      await held;
      return fakeTransport(0.77)(...args);
    };
    const pending = Promise.all(Array.from({ length: 8 }, () => jevShadow("state", questions, (state) => state, { site: "gate", stateDir, transport })));
    await Bun.sleep(20);
    expect(calls).toBe(2);
    release();
    const results = await pending;
    expect(results.filter((result) => result[0].source === "jev")).toHaveLength(2);
    expect(results.filter((result) => result[0].source === "fallback")).toHaveLength(6);
  });

  it("labels a lock-contention fallback instead of making it look like a vendor answer", async () => {
    const lock = join(stateDir, ".cost.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "busy", pid: process.pid, created_ms: Date.now() }));
    const result = await jev("state", questions, (state) => state, { site: "gate", stateDir, transport: fakeTransport(), lockWaitMs: 5 });
    expect(result[0].source).toBe("fallback");
    expect(JSON.parse(readFileSync(join(stateDir, "decisions.jsonl"), "utf8")).fallback_reason).toBe("cost_lock_busy");
  });

  it("falls back when the state directory cannot be created", async () => {
    const stateFile = join(stateDir, "not-a-directory");
    writeFileSync(stateFile, "occupied");
    const result = await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir: stateFile,
      transport: fakeTransport(0.72),
    });
    expect(result[0]).toMatchObject({ answer: 0, acted: false, source: "fallback" });
  });

  it("loads the key file without exposing the key in errors or logs", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const keyFile = join(stateDir, "api-key");
    writeFileSync(keyFile, "file-secret-key\n");
    const result = await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      keyFile,
      transport: async (_payload, key) => {
        throw new Error(`failed ${key}`);
      },
    });
    expect(JSON.stringify(result)).not.toContain("file-secret-key");
    expect(readFileSync(join(stateDir, "decisions.jsonl"), "utf8")).not.toContain("file-secret-key");
  });

  it("passes caller-owned choice options through unchanged", async () => {
    process.env.JEV_SITE_GATE = "on";
    const criteria = { allow: "Safe to proceed", review: "Needs a human" };
    let sentCriteria: unknown;
    await jev(
      "state",
      [
        {
          id: "route",
          type: "choice",
          instructions: "Choose",
          criteria,
          fallbackAnswer: "review",
        },
      ],
      (state) => state,
      {
        site: "gate",
        stateDir,
        transport: async (payload) => {
          sentCriteria = payload.questions.route.criteria;
          return {
            model: "jev-1.13.0",
            answers: {
              route: {
                type: "choice",
                choice: "allow",
                confidence: 0.8,
                probabilities: { allow: 0.9, review: 0.1 },
              },
            },
            usage: { input_tokens: 100, output_tokens: 10 },
          };
        },
      },
    );
    expect(sentCriteria).toEqual(criteria);
  });

  it("rejects out-of-range usage, charges the ceiling, and records the protocol reason", async () => {
    process.env.JEV_SITE_GATE = "on";
    const result = await jev("state", questions, (state) => state, {
      site: "gate",
      stateDir,
      transport: async () => ({
        model: "jev-invalid",
        answers: { urgent: { type: "noul", noul: 0.99 } },
        usage: { input_tokens: 10_000_000, output_tokens: 1 },
      }),
    });
    expect(result[0].source).toBe("fallback");
    const decision = JSON.parse(readFileSync(join(stateDir, "decisions.jsonl"), "utf8"));
    expect(decision.fallback_reason).toBe("usage_out_of_range");
    const usage = readFileSync(join(stateDir, "usage.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(usage.reduce((sum, row) => sum + row.cost_usd, 0)).toBeCloseTo(64_000 * (0.042 / 1_000_000), 12);
  });

  it("records only the HTTP status class when the vendor rejects a request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("secret vendor body", { status: 429 })) as unknown as typeof fetch;
    try {
      await jev("state", questions, (state) => state, { site: "gate", stateDir });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const log = readFileSync(join(stateDir, "decisions.jsonl"), "utf8");
    expect(JSON.parse(log).fallback_reason).toBe("http_error_429");
    expect(log).not.toContain("secret vendor body");
    const usage = JSON.parse(readFileSync(join(stateDir, "usage.jsonl"), "utf8"));
    expect(usage).toMatchObject({ kind: "reservation", reserved_input_tokens: 64_000 });
  });
});

it("voteMostCautious runs the requested votes and returns the highest-ranked", async () => {
  const votes = [1, 3, 2];
  expect(
    await voteMostCautious(
      async () => votes.shift()!,
      (value) => value,
    ),
  ).toBe(3);
});
