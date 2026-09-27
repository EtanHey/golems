import { beforeEach, describe, expect, it, mock } from "bun:test";

// Capture what actually leaves through the client.
const ingested: unknown[][] = [];
mock.module("@axiomhq/js", () => ({
  Axiom: class {
    ingest = (_dataset: string, events: unknown[]) => {
      ingested.push(events);
    };
    flush = () => Promise.resolve();
  },
}));

mock.module("@golems/shared/lib/config", () => ({
  loadConfig: () => ({
    observability: {
      enabled: true,
      axiomToken: "xaat-fixture-token",
      axiomDataset: "golems-test",
    },
  }),
}));

const {
  logError,
  logLLMCall,
  logMessagePipeline,
  logServiceEvent,
  resetAxiom,
  sanitizeAxiomEvent,
} = await import("@golems/shared/lib/axiom");

const PROMPT = "PROMPT-TEXT-FIXTURE the quick brown fox jumps over the lazy dog. ".repeat(40);
const STACK = "Error: boom\n    at fixtureFrame (fixture.ts:1:1)";

beforeEach(() => {
  ingested.length = 0;
  resetAxiom();
});

describe("sanitizeAxiomEvent (IDs and metrics only)", () => {
  it("drops stack, truncates error_message to 120, keeps only numeric/boolean metadata", () => {
    const out = sanitizeAxiomEvent({
      _type: "error",
      service: "claudegolem",
      error_message: PROMPT,
      error_type: "processing_error",
      stack: STACK,
      metadata: { prompt: PROMPT, retries: 3, ok: false, nested: { text: PROMPT }, bad: Number.NaN },
    } as never);

    expect(out).toEqual({
      _type: "error",
      service: "claudegolem",
      error_message: PROMPT.slice(0, 120),
      error_type: "processing_error",
      metadata: { retries: 3, ok: false },
    });
  });

  it("drops fields outside the event type's allowlist", () => {
    const out = sanitizeAxiomEvent({
      _type: "llm_call",
      model: "haiku",
      source: "email-router",
      backend: "haiku",
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.001,
      duration_ms: 12,
      tier: "paid",
      success: true,
      prompt: PROMPT,
      response: PROMPT,
    } as never);

    expect(out).not.toHaveProperty("prompt");
    expect(out).not.toHaveProperty("response");
    expect(out).toMatchObject({ model: "haiku", input_tokens: 10, success: true });
  });

  it("drops string-only metadata entirely", () => {
    const out = sanitizeAxiomEvent({
      _type: "service",
      service: "email-golem",
      event: "run",
      status: "failure",
      duration_ms: 5,
      metadata: { error: PROMPT, subject: "SUBJECT-FIXTURE" },
    });
    expect(out).not.toHaveProperty("metadata");
  });

  it("truncates every string field, not just error_message", () => {
    const out = sanitizeAxiomEvent({
      _type: "message_pipeline",
      message_id: "tg-1",
      golem_name: "claudegolem",
      phase: "respond",
      latency_ms: 10,
      success: false,
      error_type: "processing_error",
      error_message: PROMPT,
    }) as Record<string, unknown>;
    expect((out.error_message as string).length).toBe(120);
  });

  it("drops unknown event types", () => {
    expect(sanitizeAxiomEvent({ _type: "transcript", text: PROMPT } as never)).toBeNull();
  });
});

describe("send path", () => {
  it("every log helper sends only the sanitized shape", () => {
    logError({
      service: "claudegolem",
      error_message: PROMPT,
      error_type: "uncaught_exception",
      stack: STACK,
    } as never);
    logMessagePipeline({
      message_id: "tg-2",
      golem_name: "claudegolem",
      phase: "respond",
      latency_ms: 1,
      success: false,
      error_message: PROMPT,
    });
    logServiceEvent({
      service: "cloud-worker",
      event: "run",
      status: "success",
      duration_ms: 3,
      metadata: { summary: PROMPT, jobs_found: 4 },
    });
    logLLMCall({
      model: "haiku",
      source: "x",
      backend: "haiku",
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 0,
      duration_ms: 0,
      tier: "paid",
      success: false,
      error: PROMPT,
      prompt: PROMPT,
    } as never);

    const sent = JSON.stringify(ingested);
    expect(ingested.length).toBe(4);
    expect(sent).not.toContain("stack");
    expect(sent).not.toContain("fixtureFrame");
    expect(sent).not.toContain('"prompt"');
    expect(sent).not.toContain('"summary"');
    for (const [event] of ingested as Record<string, unknown>[][]) {
      for (const v of Object.values(event)) {
        if (typeof v === "string") expect(v.length).toBeLessThanOrEqual(120);
      }
    }
    expect(ingested[2][0]).toMatchObject({ metadata: { jobs_found: 4 } });
  });
});
