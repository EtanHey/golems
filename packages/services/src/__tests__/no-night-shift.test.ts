import { describe, expect, it } from "bun:test";
import { join } from "node:path";

// Etan gL = A (2026-09-25): Night Shift is retired. Nothing that runs may name
// it again: package source, launchd, package manifests, repo scripts.
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

describe("Night Shift is retired", () => {
  it("no runnable code, plist or manifest mentions it", () => {
    const git = Bun.spawnSync(
      [
        "git", "grep", "-niE", "night[-_ ]?shift",
        "--", "packages/*/src/**", "packages/*/package.json", "packages/*/.claude-plugin/**",
        "launchd/**", "scripts/*.ts", "bin/**", ":!*.test.ts", ":!**/__tests__/**",
      ],
      { cwd: REPO_ROOT },
    );
    const hits = git.stdout.toString().split("\n").filter(Boolean);
    expect(hits).toEqual([]);
  });
});
