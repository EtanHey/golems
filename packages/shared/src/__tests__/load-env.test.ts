import { describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadEnv", () => {
  it("prevents the no-env-file test command from inheriting startup dotenv values", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "golems-env-startup-"));
    try {
      copyFileSync(join(import.meta.dir, "../../../..", "bunfig.toml"), join(tempDir, "bunfig.toml"));
      writeFileSync(join(tempDir, ".env"), "GOLEMS_ENV_SENTINEL=synthetic\n");
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ scripts: {
        test: `bun --no-env-file -e 'console.log(process.env.GOLEMS_ENV_SENTINEL ?? "absent")'`,
      } }));
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "run", "test"], {
        cwd: tempDir,
        env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, PATH: process.env.PATH ?? "", NODE_ENV: "test", SUPABASE_URL: "http://127.0.0.1:9" },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe("absent");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("warns about missing .env even when the retired Railway env marker is set", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "golems-load-env-"));
    try {
      const isolatedModule = join(tempDir, "load-env.ts");
      copyFileSync(join(import.meta.dir, "..", "lib", "load-env.ts"), isolatedModule);
      copyFileSync(join(import.meta.dir, "..", "lib", "test-mode.ts"), join(tempDir, "test-mode.ts"));
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
        const { loadEnv } = await import(${JSON.stringify(isolatedModule)});
        console.log(loadEnv());
      `], { cwd: tempDir, env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production", RAILWAY_ENVIRONMENT: "production", SUPABASE_URL: "http://127.0.0.1:9" } });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe("false");
      expect(result.stderr.toString()).toContain("No .env file found");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not load .env in test mode, even with Supabase opt-in", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "golems-load-env-"));
    try {
      for (const name of ["load-env.ts", "test-mode.ts"]) {
        copyFileSync(join(import.meta.dir, "..", "lib", name), join(tempDir, name));
      }
      writeFileSync(join(tempDir, ".env"), "GOLEMS_ENV_SENTINEL=synthetic\n");
      for (const mode of [{ NODE_ENV: "test" }, { NODE_ENV: "production", BUN_ENV: "test" }]) {
        const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
          const { loadEnv } = await import(${JSON.stringify(join(tempDir, "load-env.ts"))});
          console.log(loadEnv() === false && process.env.GOLEMS_ENV_SENTINEL === undefined);
        `], {
          cwd: tempDir,
          env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...mode, GOLEMS_ALLOW_LIVE_SUPABASE_IN_TESTS: "1", SUPABASE_URL: "http://127.0.0.1:9" },
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString().trim()).toBe("true");
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  for (const topology of ["nested-worktree", "t3-worktree", "own-env", "root-checkout"]) {
    it(`respects the checkout boundary outside tests: ${topology}`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "golems-env-topology-"));
      try {
        const root = join(tempDir, "Gits", "golems");
        const checkout = topology === "root-checkout" ? root : topology === "t3-worktree"
          ? join(tempDir, ".t3", "worktrees", "golems", "worker")
          : join(root, ".worktrees", "worker");
        const lib = join(checkout, "packages", "shared", "src", "lib");
        mkdirSync(root, { recursive: true });
        mkdirSync(lib, { recursive: true });
        writeFileSync(join(root, ".env"), "GOLEMS_ENV_SENTINEL=parent\n");
        writeFileSync(join(checkout, ".git"), "gitdir: synthetic\n");
        if (topology === "own-env") writeFileSync(join(checkout, ".env"), "GOLEMS_ENV_SENTINEL=own\n");
        for (const name of ["load-env.ts", "test-mode.ts"]) {
          copyFileSync(join(import.meta.dir, "..", "lib", name), join(lib, name));
        }
        for (const cwd of [checkout, tempDir]) {
          const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", `
            await import(${JSON.stringify(join(lib, "load-env.ts"))});
            console.log(process.env.GOLEMS_ENV_SENTINEL ?? "absent");
          `], { cwd, env: { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:9" } });
          expect(result.exitCode).toBe(0);
          expect(result.stdout.toString().trim()).toBe(
            topology === "own-env" ? "own" : topology === "root-checkout" ? "parent" : "absent",
          );
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }
});
