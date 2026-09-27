import { describe, expect, it } from "bun:test";

import { evaluateAxiom } from "../doctor";

const ENV_FILE = "/home/fixture/.config/golems/axiom.env";

describe("doctor Axiom row", () => {
  it("warns when observability is disabled", () => {
    const row = evaluateAxiom({
      enabled: false,
      token: null,
      tokenSource: null,
      dataset: "golems",
      envFilePath: ENV_FILE,
    });
    expect(row.status).toBe("warn");
    expect(row.fix).toContain("observability.enabled");
  });

  it("names the env file in the fix when no token resolves", () => {
    const row = evaluateAxiom({
      enabled: true,
      token: null,
      tokenSource: null,
      dataset: "golems",
      envFilePath: ENV_FILE,
    });
    expect(row.status).toBe("warn");
    expect(row.fix).toContain(ENV_FILE);
    expect(row.fix).toContain("AXIOM_TOKEN");
  });

  it("passes with the dataset and token source, never the token", () => {
    const row = evaluateAxiom({
      enabled: true,
      token: "xaat-fixture-token",
      tokenSource: "env-file",
      dataset: "golems",
      envFilePath: ENV_FILE,
    });
    expect(row.status).toBe("pass");
    expect(row.message).toContain("dataset: golems");
    expect(row.message).toContain("env-file");
    expect(JSON.stringify(row)).not.toContain("xaat-fixture-token");
  });
});
