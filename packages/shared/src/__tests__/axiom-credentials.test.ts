import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultAxiomEnvPath,
  resolveAxiomCredentials,
} from "@golems/shared/lib/axiom-credentials";

// Fixture tokens only — never a real token in tests.
const FILE_TOKEN = "xaat-fixture-file-token";
const ENV_TOKEN = "xaat-fixture-env-token";
const CONFIG_TOKEN = "xaat-fixture-config-token";

let home: string;

function writeEnvFile(body: string, path = join(home, ".config", "golems", "axiom.env")): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "axiom-creds-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("defaultAxiomEnvPath", () => {
  it("is ~/.config/golems/axiom.env under HOME", () => {
    expect(defaultAxiomEnvPath({ HOME: home })).toBe(join(home, ".config", "golems", "axiom.env"));
  });

  it("is overridable by GOLEMS_AXIOM_ENV", () => {
    expect(defaultAxiomEnvPath({ HOME: home, GOLEMS_AXIOM_ENV: "/elsewhere/axiom.env" })).toBe(
      "/elsewhere/axiom.env",
    );
  });
});

describe("resolveAxiomCredentials", () => {
  it("prefers AXIOM_TOKEN / AXIOM_DATASET from the process env", () => {
    writeEnvFile(`AXIOM_TOKEN=${FILE_TOKEN}\nAXIOM_DATASET=from-file\n`);
    const creds = resolveAxiomCredentials(
      { enabled: true, axiomToken: CONFIG_TOKEN, axiomDataset: "from-config" },
      { HOME: home, AXIOM_TOKEN: ENV_TOKEN, AXIOM_DATASET: "from-env" },
    );
    expect(creds).toMatchObject({ enabled: true, token: ENV_TOKEN, tokenSource: "env", dataset: "from-env" });
  });

  it("falls back to the env file when the process env has no token", () => {
    writeEnvFile(`AXIOM_TOKEN=${FILE_TOKEN}\nAXIOM_DATASET=from-file\n`);
    const creds = resolveAxiomCredentials(
      { enabled: true, axiomToken: CONFIG_TOKEN, axiomDataset: "from-config" },
      { HOME: home },
    );
    expect(creds).toMatchObject({ token: FILE_TOKEN, tokenSource: "env-file", dataset: "from-file" });
  });

  it("accepts export prefixes, quoted values, comments and blank lines", () => {
    writeEnvFile(`# axiom\n\nexport AXIOM_TOKEN="${FILE_TOKEN}"\n  AXIOM_DATASET='quoted-ds'  \n`);
    const creds = resolveAxiomCredentials({ enabled: true }, { HOME: home });
    expect(creds.token).toBe(FILE_TOKEN);
    expect(creds.dataset).toBe("quoted-ds");
  });

  it("reads the file named by GOLEMS_AXIOM_ENV", () => {
    const custom = writeEnvFile(`AXIOM_TOKEN=${FILE_TOKEN}\n`, join(home, "custom", "ax.env"));
    const creds = resolveAxiomCredentials({ enabled: true }, { HOME: home, GOLEMS_AXIOM_ENV: custom });
    expect(creds.token).toBe(FILE_TOKEN);
    expect(creds.envFilePath).toBe(custom);
  });

  it("takes the dataset from the env file even when the token comes from the process env", () => {
    writeEnvFile(`AXIOM_DATASET=from-file\n`);
    const creds = resolveAxiomCredentials(
      { enabled: true, axiomDataset: "from-config" },
      { HOME: home, AXIOM_TOKEN: ENV_TOKEN },
    );
    expect(creds).toMatchObject({ token: ENV_TOKEN, dataset: "from-file" });
  });

  it("falls back to config, then to the golems dataset", () => {
    expect(
      resolveAxiomCredentials({ enabled: true, axiomToken: CONFIG_TOKEN, axiomDataset: "from-config" }, { HOME: home }),
    ).toMatchObject({ token: CONFIG_TOKEN, tokenSource: "config", dataset: "from-config" });
    expect(resolveAxiomCredentials({ enabled: true, axiomToken: CONFIG_TOKEN }, { HOME: home }).dataset).toBe(
      "golems",
    );
  });

  it("observability.enabled: false wins over every token source (off means off)", () => {
    writeEnvFile(`AXIOM_TOKEN=${FILE_TOKEN}\n`);
    const creds = resolveAxiomCredentials(
      { enabled: false, axiomToken: CONFIG_TOKEN },
      { HOME: home, AXIOM_TOKEN: ENV_TOKEN },
    );
    expect(creds.enabled).toBe(false);
    expect(creds.token).toBeNull();
  });

  it("returns a null token without throwing when the env file is missing", () => {
    const creds = resolveAxiomCredentials({ enabled: true }, { HOME: home });
    expect(creds).toMatchObject({ enabled: true, token: null, tokenSource: null, dataset: "golems" });
  });

  it("returns a null token without throwing when the env file is unreadable", () => {
    // A directory at the path makes readFileSync throw EISDIR on every platform.
    mkdirSync(join(home, ".config", "golems", "axiom.env"), { recursive: true });
    expect(resolveAxiomCredentials({ enabled: true }, { HOME: home }).token).toBeNull();

    if (process.getuid?.() !== 0) {
      const locked = writeEnvFile(`AXIOM_TOKEN=${FILE_TOKEN}\n`, join(home, "locked.env"));
      chmodSync(locked, 0o000);
      expect(resolveAxiomCredentials({ enabled: true }, { HOME: home, GOLEMS_AXIOM_ENV: locked }).token).toBeNull();
    }
  });

  it("never logs the token or the env file contents", () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) =>
      spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      writeEnvFile(`AXIOM_TOKEN=${FILE_TOKEN}\nnot a valid line\n`);
      resolveAxiomCredentials({ enabled: true }, { HOME: home });
      mkdirSync(join(home, "dir.env"));
      resolveAxiomCredentials({ enabled: true }, { HOME: home, GOLEMS_AXIOM_ENV: join(home, "dir.env") });
      const printed = spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
      expect(printed).not.toContain(FILE_TOKEN);
      expect(printed).not.toContain("not a valid line");
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("malformed quoted values in the env file", () => {
  const MALFORMED = [
    `AXIOM_TOKEN="${FILE_TOKEN}`,
    `AXIOM_TOKEN='${FILE_TOKEN}`,
    `AXIOM_TOKEN=${FILE_TOKEN}"`,
    `AXIOM_TOKEN="${FILE_TOKEN}'`,
    `AXIOM_TOKEN="${FILE_TOKEN}"trailing"`,
  ];

  for (const line of MALFORMED) {
    it(`rejects ${JSON.stringify(line.replace(FILE_TOKEN, "<token>"))}: no token`, () => {
      writeEnvFile(`${line}\n`);
      const creds = resolveAxiomCredentials({ enabled: true }, { HOME: home });
      expect(creds.token).toBeNull();
    });
  }

  it("falls back to a valid config token when the file value is malformed", () => {
    writeEnvFile(`AXIOM_TOKEN="${FILE_TOKEN}\n`);
    const creds = resolveAxiomCredentials({ enabled: true, axiomToken: CONFIG_TOKEN }, { HOME: home });
    expect(creds).toMatchObject({ token: CONFIG_TOKEN, tokenSource: "config" });
  });

  it("rejects a malformed dataset too, falling back to golems", () => {
    writeEnvFile(`AXIOM_TOKEN=${FILE_TOKEN}\nAXIOM_DATASET="half-quoted\n`);
    expect(resolveAxiomCredentials({ enabled: true }, { HOME: home }).dataset).toBe("golems");
  });

  it("getAxiom() builds no client from a malformed file (real config loader, subprocess)", () => {
    mkdirSync(join(home, ".golems"), { recursive: true });
    writeFileSync(join(home, ".golems", "config.yaml"), "observability:\n  enabled: true\n");
    writeEnvFile(`AXIOM_TOKEN="${FILE_TOKEN}\n`);
    const env: Record<string, string | undefined> = { ...process.env, HOME: home };
    delete env.AXIOM_TOKEN;
    delete env.AXIOM_DATASET;
    delete env.GOLEMS_AXIOM_ENV;
    const axiom = join(import.meta.dir, "../lib/axiom.ts");
    const result = spawnSync(
      process.execPath,
      ["-e", `const { getAxiom } = await import(${JSON.stringify(axiom)}); console.log("client:" + (getAxiom() === null ? "null" : "built"));`],
      { encoding: "utf8", env },
    );
    expect(result.stdout).toContain("client:null");
    expect(result.stdout + result.stderr).not.toContain(FILE_TOKEN);
  });
});
