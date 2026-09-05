import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const launchdRoot = join(repoRoot, "launchd");

describe("launchd templates are portable", () => {
  test("tracked plist templates contain no developer home path", () => {
    for (const name of readdirSync(launchdRoot).filter((entry) => entry.endsWith(".plist"))) {
      const content = readFileSync(join(launchdRoot, name), "utf8");
      expect(content, name).not.toContain("/Users/example");
    }
  });

  test("renderer expands home and checkout tokens", () => {
    const scratch = mkdtempSync(join(tmpdir(), "golems-launchd-"));
    const source = join(launchdRoot, "com.golemszikaron.briefing.plist");
    const destination = join(scratch, basename(source));

    try {
      const result = Bun.spawnSync([
        "bash",
        join(launchdRoot, "render-plist.sh"),
        source,
        destination,
      ], {
        cwd: repoRoot,
        env: { ...process.env, HOME: "/Users/example", GOLEMS_ROOT: "/opt/golems" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const rendered = readFileSync(destination, "utf8");
      expect(rendered).toContain("/Users/example");
      expect(rendered).toContain("/opt/golems/packages/services/src/briefing.ts");
      expect(rendered).not.toMatch(/@[A-Z][A-Z0-9_]*@/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
