import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";

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
  logCCUsage,
  logError,
  logLLMCall,
  logMessagePipeline,
  logServiceEvent,
  resetAxiom,
  sanitizeAxiomEvent,
} = await import("@golems/shared/lib/axiom");

// Markers: if either ever appears in a payload, input text or a name leaked.
const PROMPT = "PROMPT-TEXT-FIXTURE the quick brown fox";
const PERSON = "PERSON-NAME-FIXTURE";
const SHORT_PROMPT = "PROMPT-TEXT-FIXTURE";
const STACK = "Error: boom\n    at fixtureFrame (fixture.ts:1:1)";
const HOST = `${PERSON} Laptop`;
const HOST_ID = createHash("sha256").update(HOST).digest("hex").slice(0, 12);

beforeEach(() => {
  ingested.length = 0;
  resetAxiom();
});

describe("sanitizeAxiomEvent (IDs and metrics only)", () => {
  it("error: drops raw error text (even short), stack and all metadata; keeps type + status code", () => {
    const out = sanitizeAxiomEvent({
      _type: "error",
      service: "claudegolem",
      error_message: SHORT_PROMPT,
      error_type: "mlx_api_error",
      status_code: 500,
      stack: STACK,
      metadata: { retries: 3, [PROMPT]: 1 },
    } as never);

    expect(out).toEqual({
      _type: "error",
      service: "claudegolem",
      error_type: "mlx_api_error",
      status_code: 500,
    });
  });

  it("llm_call and message_pipeline: raw error strings never leave", () => {
    const llm = sanitizeAxiomEvent({
      _type: "llm_call",
      model: "haiku",
      source: "email-router",
      backend: "haiku",
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.001,
      duration_ms: 12,
      tier: "paid",
      success: false,
      error: SHORT_PROMPT,
      status_code: 429,
      prompt: PROMPT,
    } as never);
    expect(llm).not.toHaveProperty("error");
    expect(llm).not.toHaveProperty("prompt");
    expect(llm).toMatchObject({ model: "haiku", input_tokens: 10, success: false, status_code: 429 });

    const pipe = sanitizeAxiomEvent({
      _type: "message_pipeline",
      message_id: "tg-1",
      golem_name: "claudegolem",
      phase: "respond",
      latency_ms: 10,
      success: false,
      error_type: "processing_error",
      error_message: SHORT_PROMPT,
    });
    expect(pipe).not.toHaveProperty("error_message");
    expect(pipe).toMatchObject({ error_type: "processing_error" });
  });

  it("service metadata: only named metric keys survive; dynamic keys are dropped, not length-checked", () => {
    const out = sanitizeAxiomEvent({
      _type: "service",
      service: "jobgolem",
      event: "run",
      status: "success",
      duration_ms: 5,
      metadata: { scraped: 40, matched: 2, [PROMPT]: 1, [PERSON]: 2, x: 1, date: "2026-09-27" },
    });
    expect(out).toEqual({
      _type: "service",
      service: "jobgolem",
      event: "run",
      status: "success",
      duration_ms: 5,
      metadata: { scraped: 40, matched: 2 },
    });
  });

  it("cc_usage: hostname becomes an opaque host_id, branch is dropped, project stays", () => {
    const out = sanitizeAxiomEvent({
      _type: "cc_usage",
      model: "claude-opus-5-5",
      project: "golems",
      input_tokens: 1,
      output_tokens: 1,
      hostname: HOST,
      branch: `feat/${PERSON}-thing`,
    });
    expect(out).toMatchObject({ project: "golems", host_id: HOST_ID });
    expect(out).not.toHaveProperty("hostname");
    expect(out).not.toHaveProperty("branch");
    expect(HOST_ID).toMatch(/^[0-9a-f]{12}$/);
  });

  it("ID fields must look like IDs: whitespace-bearing text is dropped", () => {
    const out = sanitizeAxiomEvent({
      _type: "error",
      service: `${PERSON} free text`,
      error_type: "not an identifier",
    } as never);
    expect(out).toEqual({ _type: "error" });
  });

  it("drops unknown event types", () => {
    expect(sanitizeAxiomEvent({ _type: "transcript", text: PROMPT } as never)).toBeNull();
  });
});

describe("send path — all five helpers, adversarial", () => {
  it("nothing but allowlisted IDs and metrics reaches the client", () => {
    logError({
      service: "claudegolem",
      error_message: SHORT_PROMPT,
      error_type: "uncaught_exception",
      stack: STACK,
      metadata: { [PROMPT]: 1, [PERSON]: 1 },
    } as never);
    logMessagePipeline({
      message_id: "tg-2",
      golem_name: "claudegolem",
      phase: "respond",
      latency_ms: 1,
      success: false,
      error_type: "processing_error",
      error_message: SHORT_PROMPT,
    });
    logServiceEvent({
      service: "cloud-worker",
      event: "run",
      status: "success",
      duration_ms: 3,
      metadata: { summary: PROMPT, [PROMPT]: 7, [PERSON]: 8, matched: 4 },
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
      error: SHORT_PROMPT,
      prompt: PROMPT,
    } as never);
    logCCUsage({
      model: "claude-opus-5-5",
      project: "golems",
      input_tokens: 1,
      output_tokens: 1,
      session_id: "fixture-session",
      hostname: HOST,
      branch: `feat/${PERSON}`,
      transcript: PROMPT,
    } as never);

    expect(ingested.length).toBe(5);
    const sent = JSON.stringify(ingested);
    const leakedKeys = ['"stack":', '"branch":', '"hostname":', '"error_message":', '"error":', '"prompt":', '"transcript":', '"summary":'];
    for (const marker of ["PROMPT-TEXT-FIXTURE", PERSON, "fixtureFrame", ...leakedKeys]) {
      expect(sent).not.toContain(marker);
    }
    const [err, pipe, svc, llm, cc] = ingested.map((batch) => batch[0] as Record<string, unknown>);
    expect(err).not.toHaveProperty("metadata");
    expect(pipe).toMatchObject({ error_type: "processing_error" });
    expect(svc.metadata).toEqual({ matched: 4 });
    expect(llm).toMatchObject({ success: false });
    expect(cc).toMatchObject({ host_id: HOST_ID, session_id: "fixture-session" });
  });
});
