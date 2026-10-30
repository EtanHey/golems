import { testBun } from "../test-bun";
/**
 * PR-10b (lead ruling 2026-09-25): the dead Ollama paths go, the live one stays.
 * Direct Ollama is still the default backend, because it is what the email
 * scorer, teller and content router run on today (Homebrew Ollama
 * on the Mac). Switching the default is Etan's question gL2, not this PR.
 */

import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// These tests spawn bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

const LLM = join(import.meta.dir, "..", "lib", "llm.ts");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Run runLLM in a child bun with a stub `ollama` first on PATH. */
function runLLMWith(env: Record<string, string>, cwd?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "llm-default-"));
  dirs.push(dir);
  const stub = join(dir, "ollama");
  writeFileSync(stub, '#!/bin/sh\ncat >/dev/null\necho "OLLAMA_STUB:$1:$2"\n');
  chmodSync(stub, 0o755);
  const childEnv: Record<string, string> = {
    PATH: `${dir}:${process.env.PATH}`,
    HOME: dir,
    TMPDIR: dir,
    GOLEMS_STATE_DIR: dir,
    ...env,
  };
  const proc = Bun.spawnSync(
    [...testBun, "-e", `
      let requests = 0;
      globalThis.fetch = async () => { requests++; return new Response("[]", { status: 201 }); };
      const { runLLM } = await import(${JSON.stringify(LLM)});
      const result = await runLLM("hi", "test");
      process.on("exit", () => console.log("RESULT=" + ${cwd ? 'JSON.stringify({ requests, envLoaded: !!process.env.GOLEMS_ENV_SENTINEL })' : 'result'}));
    `],
    { env: childEnv, cwd },
  );
  const out = proc.stdout.toString();
  return out.split("\n").find((l) => l.startsWith("RESULT=")) ?? `NO RESULT: ${out}${proc.stderr.toString()}`;
}

describe("LLM default backend after the Ollama cleanup", () => {
  it("eval children neither load checkout dotenv nor send provider requests", () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-checkout-"));
    dirs.push(dir);
    writeFileSync(join(dir, ".git"), "gitdir: synthetic\n");
    writeFileSync(join(dir, ".env"), "GOLEMS_ENV_SENTINEL=synthetic\nSUPABASE_URL=http://127.0.0.1:9\nSUPABASE_SERVICE_KEY=synthetic-key\n");
    expect(runLLMWith({}, dir)).toBe('RESULT={"requests":0,"envLoaded":false}');
  });

  it("with LLM_BACKEND unset, runLLM still runs the local `ollama` CLI (same as master)", () => {
    expect(runLLMWith({})).toMatch(/^RESULT=OLLAMA_STUB:run:/);
  });

  it("a retired LLM_BACKEND=glm falls back to the direct Ollama default", () => {
    expect(runLLMWith({ LLM_BACKEND: "glm" })).toMatch(/^RESULT=OLLAMA_STUB:run:/);
  });

  it("OLLAMA_SANDBOXED=1 no longer routes through a validation queue", () => {
    expect(runLLMWith({ OLLAMA_SANDBOXED: "1" })).toMatch(/^RESULT=OLLAMA_STUB:run:/);
  });

  it("llm.ts no longer imports the sandboxed, GLM or embedding paths", () => {
    const source = readFileSync(LLM, "utf8");
    expect(source).not.toMatch(/ollama-sandboxed|glm-llm|getEmbedding|batchEmbed|findSimilar|cosineSimilarity/);
  });

  it("every live caller goes through the shared facade, so it keeps the default", () => {
    const root = join(import.meta.dir, "..", "..", "..");
    const callers = {
      "shared/src/email/scorer.ts": /from "\.\.\/lib\/llm"/,
      "teller/src/alerts.ts": /from "@golems\/shared\/lib\/llm"/,
      "teller/src/categorizer.ts": /from "@golems\/shared\/lib\/llm"/,
      "content/src/pipeline/router.ts": /from "@golems\/shared\/lib\/llm"/,
    };
    for (const [file, pattern] of Object.entries(callers)) {
      expect(readFileSync(join(root, file), "utf8")).toMatch(pattern);
    }
  });
});
