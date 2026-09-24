import { describe, expect, it } from "bun:test";

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
