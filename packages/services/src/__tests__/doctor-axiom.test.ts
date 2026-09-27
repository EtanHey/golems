import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveAxiomCredentials } from "@golems/shared/lib/axiom-credentials";
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

describe("doctor Axiom row with a malformed env file", () => {
  function withEnvFile(body: string, run: (path: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "doctor-axiom-"));
    try {
      const path = join(dir, "axiom.env");
      writeFileSync(path, body, { mode: 0o600 });
      run(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("warns (not pass) on an unterminated quoted token and names the file", () => {
    withEnvFile('AXIOM_TOKEN="xaat-fixture-unclosed\n', (path) => {
      const row = evaluateAxiom(
        resolveAxiomCredentials({ enabled: true }, { HOME: "/nonexistent", GOLEMS_AXIOM_ENV: path }),
      );
      expect(row.status).toBe("warn");
      expect(row.fix).toContain(path);
      expect(JSON.stringify(row)).not.toContain("xaat-fixture-unclosed");
    });
  });

  it("passes on a valid config token when the file value is malformed", () => {
    withEnvFile('AXIOM_TOKEN="xaat-fixture-unclosed\n', (path) => {
      const row = evaluateAxiom(
        resolveAxiomCredentials(
          { enabled: true, axiomToken: "xaat-fixture-config" },
          { HOME: "/nonexistent", GOLEMS_AXIOM_ENV: path },
        ),
      );
      expect(row.status).toBe("pass");
      expect(row.message).toContain("token from config");
    });
  });
});
