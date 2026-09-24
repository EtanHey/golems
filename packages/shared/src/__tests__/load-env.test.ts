import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const originalCwd = process.cwd();
const originalWarn = console.warn;
const originalRailwayEnvironment = process.env.RAILWAY_ENVIRONMENT;

afterEach(() => {
  process.chdir(originalCwd);
  console.warn = originalWarn;
  if (originalRailwayEnvironment === undefined) {
    delete process.env.RAILWAY_ENVIRONMENT;
  } else {
    process.env.RAILWAY_ENVIRONMENT = originalRailwayEnvironment;
  }
});

describe("loadEnv", () => {
  it("warns about missing .env even when the retired Railway env marker is set", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "golems-load-env-"));
    const warnings: string[] = [];

    process.chdir(tempDir);
    process.env.RAILWAY_ENVIRONMENT = "production";
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      // loadEnv also walks up from its own file, so importing it in place finds
      // any .env above the checkout (a worktree under a configured repo has one).
      // A copy in the temp dir has no .env ancestors on either search path.
      const isolatedModule = join(tempDir, "load-env.ts");
      copyFileSync(join(import.meta.dir, "..", "lib", "load-env.ts"), isolatedModule);
      const { loadEnv } = await import(`${isolatedModule}?railway-retired=${Date.now()}`);

      expect(loadEnv()).toBe(false);
      expect(warnings.some((warning) => warning.includes("No .env file found"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
