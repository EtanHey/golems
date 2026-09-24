import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { evaluatePrunedSeats } from "../doctor";

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
});
