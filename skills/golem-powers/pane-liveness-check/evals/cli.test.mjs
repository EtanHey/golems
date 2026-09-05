import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(here, "..");
const cli = path.join(here, "..", "scripts", "pane-liveness-check-cli.mjs");

test("CLI help documents JSON mode and read-only behavior", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("--json");
  expect(result.stdout).toContain("read-only");
  expect(result.stdout).toContain("never closes");
});

test("installed symlink wrapper still invokes the CLI main module", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pane-liveness-link-"));
  try {
    const linkedSkill = path.join(root, "pane-liveness-check");
    symlinkSync(skillDir, linkedSkill);
    const result = spawnSync("bash", [path.join(linkedSkill, "scripts", "run.sh"), "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pane-liveness-check");
    expect(result.stdout).toContain("--json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
