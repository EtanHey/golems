import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { runGLM } from "@golems/shared/lib/glm-llm";
import { runMLX } from "@golems/shared/lib/mlx-llm";
import {
  _resetProviders,
  runCloudFree,
} from "@golems/shared/lib/vercel-llm";

const originalFetch = globalThis.fetch;
const originalBackend = process.env.LLM_BACKEND;
const originalGoogleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const originalGroqApiKey = process.env.GROQ_API_KEY;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function mockProviderFailure(errorBody: object): typeof globalThis.fetch {
  return mock(async (input: RequestInfo | URL) => {
    if (String(input).includes("axiom")) return Response.json({});
    return Response.json(errorBody, { status: 400 });
  }) as unknown as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("LLM_BACKEND", originalBackend);
  restoreEnv("GOOGLE_GENERATIVE_AI_API_KEY", originalGoogleApiKey);
  restoreEnv("GROQ_API_KEY", originalGroqApiKey);
  _resetProviders();
});

describe("GLM return contract", () => {
  it("returns null when the API request fails", async () => {
    globalThis.fetch = mockProviderFailure({
      error: {
        code: 400,
        message: "bad request",
        status: "INVALID_ARGUMENT",
      },
    });

    expect(await runGLM("hello", "test")).toBeNull();
  });

  it("preserves a valid empty generation", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ response: "", eval_count: 0 }),
    ) as unknown as typeof globalThis.fetch;

    expect(await runGLM("hello", "test")).toBe("");
  });
});

describe("MLX return contract", () => {
  it("returns null when the API request fails", async () => {
    globalThis.fetch = mockProviderFailure({
      error: {
        message: "bad request",
        type: "invalid_request_error",
      },
    });

    expect(await runMLX("hello", "test")).toBeNull();
  });

  it("preserves a valid empty generation", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        choices: [{ message: { content: "" } }],
        usage: { prompt_tokens: 1, completion_tokens: 0 },
      }),
    ) as unknown as typeof globalThis.fetch;

    expect(await runMLX("hello", "test")).toBe("");
  });
});

describe("GLM MCP fallback contract", () => {
  it("does not fall back when MLX returns a valid empty generation", () => {
    const source = readFileSync(
      new URL("../glm/mcp-server.ts", import.meta.url),
      "utf8",
    );
    const rawFallback = source.slice(
      source.indexOf("async function runLocalWithFallback"),
      source.indexOf("async function runLocalJSONWithFallback"),
    );

    expect(rawFallback).toContain("if (result !== null) return result;");
  });
});

describe("Gemini return contract", () => {
  it("returns null when the API request fails", async () => {
    process.env.LLM_BACKEND = "gemini";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    delete process.env.GROQ_API_KEY;
    globalThis.fetch = mockProviderFailure({
      error: {
        code: 400,
        message: "bad request",
        status: "INVALID_ARGUMENT",
      },
    });

    expect(await runCloudFree("hello", "test")).toBeNull();
  });

  it("preserves a valid empty generation", async () => {
    process.env.LLM_BACKEND = "gemini";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    delete process.env.GROQ_API_KEY;
    globalThis.fetch = mock(async () =>
      Response.json({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 0,
          totalTokenCount: 1,
        },
      }),
    ) as unknown as typeof globalThis.fetch;

    expect(await runCloudFree("hello", "test")).toBe("");
  });
});

describe("Groq return contract", () => {
  it("returns null when the API request fails", async () => {
    process.env.LLM_BACKEND = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    globalThis.fetch = mockProviderFailure({
      error: {
        message: "bad request",
        type: "invalid_request_error",
      },
    });

    expect(await runCloudFree("hello", "test")).toBeNull();
  });

  it("preserves a valid empty generation", async () => {
    process.env.LLM_BACKEND = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    globalThis.fetch = mock(async () =>
      Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 0,
          total_tokens: 1,
        },
      }),
    ) as unknown as typeof globalThis.fetch;

    expect(await runCloudFree("hello", "test")).toBe("");
  });
});
