import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { CANON_END, CANON_START, lintCanonDrift } from "../canon-drift-lint.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, "..", "canon-drift-lint.mjs");
const tempDirs = [];

const contractIds = [
  "agent-routing",
  "PR-loop",
  "never-fabricate",
  "done = user-visible",
  "models",
  "launchers",
  "monitors/collabs",
  "orchestration",
];

const canonBlock = `${CANON_START}
# FLEET CANON

1. **agent-routing** - Cursor gathers, Codex implements, Claude orchestrates.
2. **PR-loop** - branch to merge; reports carry PR URLs.
3. **never-fabricate** - read files, run commands, verify outputs before claims.
4. **done = user-visible** - done means the user can see or use the result.
5. **models** - launcher policy owns model selection.
6. **launchers** - repoGolem launcher names are hyphen-stripped.
7. **monitors/collabs** - claim, guard, post DONE, harvest, close.
8. **orchestration** - one workflow per cluster, routed through leads.
${CANON_END}`;

function makeFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "canon-drift-"));
  tempDirs.push(dir);
  const canonPath = path.join(dir, "fleet-canon.md");
  const installedPath = path.join(dir, "CLAUDE.md");
  writeFileSync(
    canonPath,
    [
      "# Fleet Canon Source",
      "",
      canonBlock,
      "",
      "## Overlap Reconciliation",
      "",
      "| Contract | Current homes | Canon action |",
      "|---|---|---|",
      "| agent-routing | skill | canon owns |",
    ].join("\n"),
  );
  return { canonPath, installedPath };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test("not-installed path exits cleanly when installed block is absent", () => {
  const { canonPath, installedPath } = makeFixture();
  writeFileSync(installedPath, "# User CLAUDE\n\nNo fleet canon block yet.\n");

  const result = lintCanonDrift({ canonPath, installedPath, check: true });

  expect(result.status).toBe("not-installed");
  expect(result.ok).toBe(true);
  expect(result.exitCode).toBe(0);
  expect(result.source.sections).toEqual(contractIds);
});

test("in-sync path matches hash and section set via fixture install block", () => {
  const { canonPath, installedPath } = makeFixture();
  writeFileSync(installedPath, `# User CLAUDE\n\n${canonBlock}\n`);

  const result = lintCanonDrift({ canonPath, installedPath, check: true });

  expect(result.status).toBe("in-sync");
  expect(result.ok).toBe(true);
  expect(result.exitCode).toBe(0);
  expect(result.source.hash).toBe(result.installed.hash);
  expect(result.installed.sections).toEqual(contractIds);
});

test("drift path flags mutated installed hash and section set", () => {
  const { canonPath, installedPath } = makeFixture();
  const mutatedBlock = canonBlock
    .replace("done = user-visible", "done is merged")
    .replace("user can see or use the result", "branch is merged");
  writeFileSync(installedPath, `# User CLAUDE\n\n${mutatedBlock}\n`);

  const result = lintCanonDrift({ canonPath, installedPath, check: true });

  expect(result.status).toBe("drift");
  expect(result.ok).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(result.drift.hashMismatch).toBe(true);
  expect(result.drift.missingSections).toEqual(["done = user-visible"]);
  expect(result.drift.extraSections).toEqual(["done is merged"]);
});

test("--check exits zero for not-installed and non-zero for drift", () => {
  const notInstalled = makeFixture();
  writeFileSync(notInstalled.installedPath, "# User CLAUDE\n");

  const okRun = spawnSync(process.execPath, [
    scriptPath,
    "--check",
    "--canon",
    notInstalled.canonPath,
    "--installed",
    notInstalled.installedPath,
  ], { encoding: "utf8" });
  expect(okRun.status).toBe(0);
  expect(okRun.stdout).toContain("not-installed");

  const drift = makeFixture();
  writeFileSync(
    drift.installedPath,
    `# User CLAUDE\n\n${canonBlock.replace("monitors/collabs", "monitors only")}\n`,
  );
  const driftRun = spawnSync(process.execPath, [
    scriptPath,
    "--check",
    "--canon",
    drift.canonPath,
    "--installed",
    drift.installedPath,
  ], { encoding: "utf8" });
  expect(driftRun.status).toBe(1);
  expect(driftRun.stdout).toContain("drift");
});
