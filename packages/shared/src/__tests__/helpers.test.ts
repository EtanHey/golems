import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { _resetClient } from "@golems/shared/lib/cloud-llm";

// Set GOLEMS_STATE_DIR before importing helpers
const testDir = join(tmpdir(), `helpers-test-${Date.now()}`);
process.env.GOLEMS_STATE_DIR = testDir;

import {
  helperLimitReached,
  isHelperAvailable,
  getHelperStatus,
  runHelper,
  type HelperBackend,
} from "@golems/shared/lib/helpers";

const originalFetch = globalThis.fetch;
const originalSpawn = Bun.spawn;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const data = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("helpers rate limiting", () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    globalThis.fetch = originalFetch;
    Bun.spawn = originalSpawn;
    restoreEnv("ANTHROPIC_API_KEY", originalAnthropicApiKey);
    _resetClient(null);
  });

  describe("helperLimitReached", () => {
    test("sets correct resets_at for gemini (midnight UTC)", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("gemini", now);

      const status = getHelperStatus(now);
      expect(status.gemini.available).toBe(false);
      expect(status.gemini.resets_at).toBe("2026-02-08T00:00:00.000Z");
    });

    test("sets correct resets_at for codex (1 minute)", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("codex", now);

      const status = getHelperStatus(now);
      expect(status.codex.available).toBe(false);
      expect(status.codex.resets_at).toBe("2026-02-07T14:31:00.000Z");
    });

    test("sets correct resets_at for haiku (1 minute)", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("haiku", now);

      const status = getHelperStatus(now);
      expect(status.haiku.available).toBe(false);
      expect(status.haiku.resets_at).toBe("2026-02-07T14:31:00.000Z");
    });

    test("sets correct resets_at for cursor (30 days)", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("cursor", now);

      const status = getHelperStatus(now);
      expect(status.cursor.available).toBe(false);
      // 30 days later
      const resetsAt = new Date(status.cursor.resets_at!);
      const diff = resetsAt.getTime() - now.getTime();
      expect(diff).toBe(30 * 24 * 60 * 60_000);
    });

    test("sets correct resets_at for kiro (end of month)", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("kiro", now);

      const status = getHelperStatus(now);
      expect(status.kiro.available).toBe(false);
      // Should be sometime around end of Feb 2026
      const resetsAt = new Date(status.kiro.resets_at!);
      expect(resetsAt.getTime()).toBeGreaterThan(now.getTime());
      // February 2026 has 28 days, so reset should be around Feb 28
      expect(resetsAt.getUTCDate()).toBeGreaterThanOrEqual(28);
    });
  });

  describe("isHelperAvailable", () => {
    test("returns true for non-limited backend", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      expect(isHelperAvailable("gemini", now)).toBe(true);
    });

    test("returns false when limited and resets_at > now", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("codex", now);

      // Check 30 seconds later (still limited)
      const later = new Date("2026-02-07T14:30:30Z");
      expect(isHelperAvailable("codex", later)).toBe(false);
    });

    test("auto-clears when resets_at < now", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("codex", now);

      // Check 2 minutes later (should be cleared)
      const later = new Date("2026-02-07T14:32:00Z");
      expect(isHelperAvailable("codex", later)).toBe(true);
    });

    test("auto-clears gemini after midnight UTC", () => {
      const now = new Date("2026-02-07T23:00:00Z");
      helperLimitReached("gemini", now);

      // Still limited before midnight
      expect(isHelperAvailable("gemini", new Date("2026-02-07T23:59:59Z"))).toBe(false);

      // Available after midnight
      expect(isHelperAvailable("gemini", new Date("2026-02-08T00:00:01Z"))).toBe(true);
    });
  });

  describe("getHelperStatus", () => {
    test("returns all backends", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      const status = getHelperStatus(now);

      expect(Object.keys(status)).toEqual(["gemini", "kiro", "codex", "cursor", "glm", "haiku"]);
    });

    test("all available by default", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      const status = getHelperStatus(now);

      for (const backend of Object.values(status)) {
        expect(backend.available).toBe(true);
        expect(backend.resets_at).toBeNull();
      }
    });

    test("shows limited backends with resets_at", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      helperLimitReached("gemini", now);
      helperLimitReached("cursor", now);

      const status = getHelperStatus(now);
      expect(status.gemini.available).toBe(false);
      expect(status.gemini.resets_at).not.toBeNull();
      expect(status.cursor.available).toBe(false);
      expect(status.cursor.resets_at).not.toBeNull();
      expect(status.kiro.available).toBe(true);
      expect(status.codex.available).toBe(true);
      expect(status.haiku.available).toBe(true);
    });
  });

  describe("fallback chain", () => {
    test("advances after a backend returns null", async () => {
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        if (String(input).includes("axiom")) return Response.json({});
        return new Response("service unavailable", { status: 503 });
      }) as unknown as typeof globalThis.fetch;
      const spawn = mock(() => ({
        stdin: { write: () => 0, end: () => {} },
        stdout: streamFrom("next backend"),
        stderr: streamFrom(""),
        exited: Promise.resolve(0),
        kill: () => {},
      }));
      Bun.spawn = spawn as unknown as typeof Bun.spawn;

      const result = await runHelper("test prompt", {
        backend: "glm",
        source: "test",
      });

      expect(result.backend).toBe("gemini");
      expect(result.output).toBe("next backend");
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    test("throws when every attempted backend returns null", async () => {
      const now = new Date();
      for (const backend of ["gemini", "kiro", "codex", "cursor"] as const) {
        helperLimitReached(backend, now);
      }
      delete process.env.ANTHROPIC_API_KEY;
      _resetClient(null);
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        if (String(input).includes("axiom")) return Response.json({});
        return new Response("service unavailable", { status: 503 });
      }) as unknown as typeof globalThis.fetch;

      await expect(
        runHelper("test prompt", { backend: "glm", source: "test" }),
      ).rejects.toThrow("All backends failed");
    });

    test("skips limited backends", () => {
      const now = new Date("2026-02-07T14:30:00Z");

      // Limit first two in chain
      helperLimitReached("gemini", now);
      helperLimitReached("kiro", now);

      // gemini and kiro should be unavailable
      expect(isHelperAvailable("gemini", now)).toBe(false);
      expect(isHelperAvailable("kiro", now)).toBe(false);

      // codex, cursor, haiku should still be available
      expect(isHelperAvailable("codex", now)).toBe(true);
      expect(isHelperAvailable("cursor", now)).toBe(true);
      expect(isHelperAvailable("haiku", now)).toBe(true);
    });

    test("all backends can be limited", () => {
      const now = new Date("2026-02-07T14:30:00Z");
      const backends: HelperBackend[] = ["gemini", "kiro", "codex", "cursor", "glm", "haiku"];

      for (const b of backends) {
        helperLimitReached(b, now);
      }

      for (const b of backends) {
        expect(isHelperAvailable(b, now)).toBe(false);
      }
    });
  });
});
