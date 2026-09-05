import { describe, it, expect } from "bun:test";

/**
 * Test that llm.ts exports the correct LLM facade interface.
 */

describe("LLM facade (llm.ts)", () => {
  it("exports runLLM function", async () => {
    const mod = await import("@golems/shared/lib/llm");
    expect(typeof mod.runLLM).toBe("function");
  });

  it("exports runLLMJSON function", async () => {
    const mod = await import("@golems/shared/lib/llm");
    expect(typeof mod.runLLMJSON).toBe("function");
  });

  it("exports source helpers with runLLM/runLLMJSON", async () => {
    const mod = await import("@golems/shared/lib/llm");
    expect(typeof mod.forJobGolem.runLLM).toBe("function");
    expect(typeof mod.forJobGolem.runLLMJSON).toBe("function");
    expect(typeof mod.forEmailGolem.runLLM).toBe("function");
    expect(typeof mod.forNightShift.runLLM).toBe("function");
  });

  it("exports embedding functions", async () => {
    const mod = await import("@golems/shared/lib/llm");
    expect(typeof mod.getEmbedding).toBe("function");
    expect(typeof mod.batchEmbed).toBe("function");
    expect(typeof mod.cosineSimilarity).toBe("function");
    expect(typeof mod.findSimilar).toBe("function");
  });

  it("exports backward-compat aliases", async () => {
    const mod = await import("@golems/shared/lib/llm");
    expect(typeof mod.runOllama).toBe("function");
    expect(typeof mod.runOllamaJSON).toBe("function");
    expect(mod.runOllama).toBe(mod.runLLM);
    expect(mod.runOllamaJSON).toBe(mod.runLLMJSON);
  });
});
