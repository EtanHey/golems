import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const VERIFY_ACCOUNT_TEST = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "skills",
  "golem-powers",
  "_shared",
  "research",
  "__tests__",
  "verify-account.test.sh",
);

const DRIVE_PATHS_TEST = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "skills",
  "golem-powers",
  "_shared",
  "research",
  "__tests__",
  "drive-paths.test.sh",
);

async function runShellTest(scriptPath: string) {
  const proc = Bun.spawn(["bash", scriptPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("research shared helpers", () => {
  test("verify-account shell suite passes", async () => {
    const { stdout, stderr, exitCode } = await runShellTest(VERIFY_ACCOUNT_TEST);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("verify-account.test.sh PASS");
  }, { timeout: 15_000 });

  test("drive-paths shell suite passes", async () => {
    const { stdout, stderr, exitCode } = await runShellTest(DRIVE_PATHS_TEST);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("drive-paths.test.sh PASS");
  });
});
