import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { evaluatePrunedSeats } from "../doctor";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

describe("seat registry prune report", () => {
  it("passes when the config prunes no default seat", () => {
    const result = evaluatePrunedSeats([]);
    expect(result.status).toBe("pass");
    expect(result.name).toBe("Seat registry");
  });

  it("names every pruned default seat and why", () => {
    const result = evaluatePrunedSeats([
      { seat: "aftercodeClaude", reason: "orcClaude.orgTree.directReports in your config omits it" },
      { seat: "dashboardClaude", reason: "its parent dashboardLead was pruned" },
    ]);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("aftercodeClaude (orcClaude.orgTree.directReports in your config omits it)");
    expect(result.message).toContain("dashboardClaude (its parent dashboardLead was pruned)");
    expect(result.fix).toContain("directReports");
  });
});

describe("doctor without HOME", () => {
  // @golems/shared/lib/config throws at import when HOME is unset; the doctor
  // must still load and report, so the seat-registry check imports it lazily.
  it("loads the doctor module when HOME is unset", () => {
    const env = { ...process.env };
    delete env.HOME;
    const doctor = join(import.meta.dir, "../doctor.ts");
    const result = spawnSync(
      process.execPath,
      ["-e", `await import(${JSON.stringify(doctor)}); console.log("doctor loaded");`],
      { encoding: "utf8", env },
    );
    expect(result.stderr).not.toContain("HOME environment variable is required");
    expect(result.stdout).toContain("doctor loaded");
  });

  // Axiom's import of the config module throws first; Bun then hands the
  // seat-registry import a half-initialized module, so without a HOME
  // pre-check the row read "Cannot access 'cachedConfig' before initialization".
  it("reports HOME not set on the seat-registry row", () => {
    const env = { ...process.env };
    delete env.HOME;
    const result = spawnSync(process.execPath, [join(import.meta.dir, "../doctor.ts")], {
      encoding: "utf8",
      env,
      timeout: 60_000,
    });
    const row = result.stdout.split("\n").find((line) => line.startsWith("Seat registry"));
    expect(row).toBeDefined();
    expect(row).toContain("HOME not set");
    expect(result.stdout).not.toContain("cachedConfig");
  }, 60_000);
});
