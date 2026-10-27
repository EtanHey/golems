import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Bun module mocks are process-wide: process-guards mocks logError itself,
// and message-pipeline-logging replaces the SDK. Keep the real send path and
// its capture client together in a fresh process, outside those module caches.
it("Axiom privacy: all sanitizer and five-helper send-path checks", () => {
  const result = spawnSync(
    process.execPath,
    ["test", join(import.meta.dir, "axiom-privacy.fixture.ts")],
    { encoding: "utf8", timeout: 10_000 },
  );

  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
