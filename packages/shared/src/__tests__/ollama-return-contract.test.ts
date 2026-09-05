import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  batchEmbed as batchDirectEmbeddings,
  getEmbedding as getDirectEmbedding,
  runOllama,
  runOllamaJSON,
} from "@golems/shared/lib/ollama-helper";
import {
  batchEmbed as batchSandboxedEmbeddings,
  getEmbedding as getSandboxedEmbedding,
} from "@golems/shared/lib/ollama-sandboxed";

const originalFetch = globalThis.fetch;
const originalSpawn = Bun.spawn;

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const data = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Bun.spawn = originalSpawn;
});

describe("Ollama helper failure return contract", () => {
  it("returns null when the Ollama process exits unsuccessfully", async () => {
    Bun.spawn = (() => ({
      exited: Promise.resolve(1),
      stdout: streamFrom(""),
      stderr: streamFrom("ollama unavailable"),
    })) as unknown as typeof Bun.spawn;

    expect(await runOllama("hello")).toBeNull();
  });

  it("returns null when the direct embedding API rejects the request", async () => {
    globalThis.fetch = mock(async () =>
      new Response("service unavailable", { status: 503 })
    ) as unknown as typeof globalThis.fetch;

    expect(await getDirectEmbedding("hello")).toBeNull();
  });

  it("returns null when the direct embedding API cannot be reached", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;

    expect(await getDirectEmbedding("hello")).toBeNull();
  });

  it("returns null when the sandboxed embedding API rejects the request", async () => {
    globalThis.fetch = mock(async () =>
      new Response("service unavailable", { status: 503 })
    ) as unknown as typeof globalThis.fetch;

    expect(await getSandboxedEmbedding("hello")).toBeNull();
  });

  it("returns null when the sandboxed embedding API cannot be reached", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;

    expect(await getSandboxedEmbedding("hello")).toBeNull();
  });
});

describe("Ollama helper callers", () => {
  it("returns null from runOllamaJSON without reporting a JSON parse error", async () => {
    const originalConsoleError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    Bun.spawn = (() => ({
      exited: Promise.resolve(1),
      stdout: streamFrom(""),
      stderr: streamFrom("ollama unavailable"),
    })) as unknown as typeof Bun.spawn;

    try {
      expect(await runOllamaJSON("hello")).toBeNull();
      expect(
        errors.some(([message]) => message === "[Ollama] JSON parse error:"),
      ).toBe(false);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("fails the direct embedding batch when one element fails", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return requestCount === 1
        ? Response.json({ embedding: [0.1] })
        : new Response("service unavailable", { status: 503 });
    }) as unknown as typeof globalThis.fetch;

    expect(await batchDirectEmbeddings(["first", "second"])).toBeNull();
  });

  it("fails the sandboxed embedding batch when one element fails", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return requestCount === 1
        ? Response.json({ embedding: [0.1] })
        : new Response("service unavailable", { status: 503 });
    }) as unknown as typeof globalThis.fetch;

    expect(await batchSandboxedEmbeddings(["first", "second"])).toBeNull();
  });

  it("preserves a valid empty embedding as successful data", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ embedding: [] })
    ) as unknown as typeof globalThis.fetch;

    expect(await getDirectEmbedding("hello")).toEqual([]);
    expect(await batchDirectEmbeddings(["hello"])).toEqual([[]]);
    expect(await getSandboxedEmbedding("hello")).toEqual([]);
    expect(await batchSandboxedEmbeddings(["hello"])).toEqual([[]]);
  });

  it("propagates a direct Ollama failure through the LLM facade", async () => {
    const previousBackend = process.env.LLM_BACKEND;
    const previousSandbox = process.env.OLLAMA_SANDBOXED;
    delete process.env.LLM_BACKEND;
    delete process.env.OLLAMA_SANDBOXED;
    Bun.spawn = (() => ({
      exited: Promise.resolve(1),
      stdout: streamFrom(""),
      stderr: streamFrom("ollama unavailable"),
    })) as unknown as typeof Bun.spawn;

    try {
      const { runLLM } = await import(`../lib/llm.ts?null-contract=${Date.now()}`);
      expect(await runLLM("hello")).toBeNull();
    } finally {
      if (previousBackend === undefined) delete process.env.LLM_BACKEND;
      else process.env.LLM_BACKEND = previousBackend;
      if (previousSandbox === undefined) delete process.env.OLLAMA_SANDBOXED;
      else process.env.OLLAMA_SANDBOXED = previousSandbox;
    }
  });
});
