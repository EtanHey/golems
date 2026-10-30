import { expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");

for (const helper of [false, true]) {
  it(`pre-push preserves child isolation with production markers (helper=${helper})`, () => {
    const cwd = mkdtempSync(join(tmpdir(), "test-hook-"));
    try {
      writeFileSync(join(cwd, ".git"), "gitdir: synthetic\n");
      writeFileSync(join(cwd, ".env"), "GOLEMS_ENV_SENTINEL=synthetic\nSUPABASE_SERVICE_KEY=synthetic-key\n");
      // Keep the real command, Bun config and preloads, selecting only the regression.
      const config = readFileSync(join(root, "bunfig.toml"), "utf8")
        .replace("./packages/shared/src/test-preload.ts", join(root, "packages/shared/src/test-preload.ts"));
      writeFileSync(join(cwd, "bunfig.toml"), config);
      writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: {
        test: `bun test --no-env-file ${join(import.meta.dir, "llm-default-backend.test.ts")} --test-name-pattern 'eval children'`,
      } }));
      if (helper) {
        const dir = join(cwd, "Gits/golems/.worktrees/hooks-live/scripts/hooks");
        mkdirSync(dir, { recursive: true });
        copyFileSync(join(root, "scripts/hooks/heavy-suite.py"), join(dir, "heavy-suite.py"));
      }
      const result = Bun.spawnSync(["bash", join(root, ".githooks/pre-push")], {
        cwd, stdin: "ignore", timeout: 30_000,
        env: { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd, NODE_ENV: "production", BUN_ENV: "production", SUPABASE_URL: "http://127.0.0.1:9", GOLEMS_HEAVY_SUITE_HELD: "synthetic-nested-fixture" },
      });
      expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
      expect(result.stderr.toString()).toContain("1 pass");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }, 30_000);
}
