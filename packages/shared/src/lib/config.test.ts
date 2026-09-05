import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { deepMerge } from "./config";

type TestSeatEntry = {
  repo: string;
  launchers: {
    claude: string;
    codex: string;
    cursor: string;
    gemini: string;
    kiro: string;
  };
  lane: string;
  aliases: string[];
  role: "lead" | "worker" | "orc";
  orgTree: {
    parent: string | null;
    directReports: string[];
  };
};

type ConfigModule = typeof import("./config") & {
  getSeat?: (name: string) => TestSeatEntry | undefined;
  isDirectReport?: (parentSeat: string, childSeat: string) => boolean;
  resolveLaneAlias?: (alias: string) => string | undefined;
  resolveLauncher?: (seatName: string, cli: string) => string;
};

async function registryApi(): Promise<Required<ConfigModule>> {
  const config = (await import("./config")) as ConfigModule;
  expect(typeof config.getSeat).toBe("function");
  expect(typeof config.isDirectReport).toBe("function");
  expect(typeof config.resolveLaneAlias).toBe("function");
  expect(typeof config.resolveLauncher).toBe("function");
  return config as Required<ConfigModule>;
}

const sampleSeat: TestSeatEntry = {
  repo: "golems",
  launchers: {
    claude: "golemsClaude",
    codex: "golemsCodex",
    cursor: "golemsCursor",
    gemini: "golemsGemini",
    kiro: "golemsKiro",
  },
  lane: "golems",
  aliases: [],
  role: "worker",
  orgTree: {
    parent: "golemsLead",
    directReports: [],
  },
};

const configModuleUrl = pathToFileURL(join(import.meta.dir, "config.ts")).href;

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output);
}

function runConfigModuleWithHome(options: {
  yaml?: string;
  code: string;
}): { stdout: string; stderr: string; exitCode: number | null; home: string } {
  const home = mkdtempSync(join(tmpdir(), "golems-seat-registry-"));
  const configDir = join(home, ".golems");
  mkdirSync(configDir, { recursive: true });

  if (options.yaml !== undefined) {
    writeFileSync(join(configDir, "config.yaml"), options.yaml);
  }

  const result = Bun.spawnSync({
    cmd: ["bun", "-e", options.code],
    env: { ...process.env, HOME: home },
  });

  return {
    stdout: decodeOutput(result.stdout),
    stderr: decodeOutput(result.stderr),
    exitCode: result.exitCode,
    home,
  };
}

describe("seatRegistry", () => {
  test("resolves repoGolem launchers with hyphens stripped from repo keys", async () => {
    const { getSeat, resolveLauncher } = await registryApi();
    const seat = getSeat("skillCreatorClaude");

    expect(seat?.repo).toBe("skill-creator");
    expect(resolveLauncher("skillCreatorClaude", "claude")).toBe(
      "skillcreatorClaude",
    );
    expect(resolveLauncher("skillcreatorLead", "codex")).toBe(
      "skillcreatorCodex",
    );
  });

  test("allows only direct org-tree reports, rejecting skip-level dispatches", async () => {
    const { isDirectReport } = await registryApi();

    expect(isDirectReport("orcClaude", "skillcreatorLead")).toBe(true);
    expect(isDirectReport("skillcreatorLead", "evalLead")).toBe(true);
    expect(isDirectReport("orcClaude", "evalLead")).toBe(false);
  });

  test("normalizes known lane aliases to canonical lanes", async () => {
    const { resolveLaneAlias } = await registryApi();

    expect(resolveLaneAlias("HappyCamper")).toBe("orc");
    expect(resolveLaneAlias("Cantaloupe-AI")).toBe("orc");
    expect(resolveLaneAlias("golems")).toBe("golems");
    expect(resolveLaneAlias("unknown-lane")).toBeUndefined();
  });

  test("deepMerge keeps default seats while adding per-machine registry overrides", () => {
    const merged = deepMerge(
      { seatRegistry: { golemsClaude: sampleSeat } },
      {
        seatRegistry: {
          localOnlySeat: {
            ...sampleSeat,
            repo: "local-repo",
            lane: "local",
          },
        },
      },
    );

    expect(merged.seatRegistry.golemsClaude.repo).toBe("golems");
    expect(merged.seatRegistry.localOnlySeat.repo).toBe("local-repo");
    expect(merged.seatRegistry.localOnlySeat.launchers.claude).toBe(
      "golemsClaude",
    );
  });

  test("marks worker seats correctly and covers cmuxlayer/dashboard workers", () => {
    const result = runConfigModuleWithHome({
      code: `
        import { getSeat, resolveLauncher } from ${JSON.stringify(configModuleUrl)};
        console.log(JSON.stringify({
          golemsRole: getSeat("golemsClaude")?.role,
          skillCreatorRole: getSeat("skillCreatorClaude")?.role,
          cmuxlayerRepo: getSeat("cmuxlayerClaude")?.repo,
          dashboardRepo: getSeat("dashboardClaude")?.repo,
          cmuxlayerLauncher: resolveLauncher("cmuxlayerClaude", "claude"),
          dashboardLauncher: resolveLauncher("dashboardClaude", "claude")
        }));
      `,
    });

    try {
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as Record<string, string>;
      expect(parsed.golemsRole).toBe("worker");
      expect(parsed.skillCreatorRole).toBe("worker");
      expect(parsed.cmuxlayerRepo).toBe("cmuxlayer");
      expect(parsed.dashboardRepo).toBe("golems-dashboard");
      expect(parsed.cmuxlayerLauncher).toBe("cmuxlayerClaude");
      expect(parsed.dashboardLauncher).toBe("dashboardClaude");
    } finally {
      rmSync(result.home, { recursive: true, force: true });
    }
  });

  test("rejects child parent links missing from parent directReports", () => {
    const result = runConfigModuleWithHome({
      yaml: `
seatRegistry:
  golemsLead:
    orgTree:
      directReports: []
`,
      code: `
        import { loadConfig } from ${JSON.stringify(configModuleUrl)};
        loadConfig();
      `,
    });

    try {
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("directReports does not include golemsClaude");
    } finally {
      rmSync(result.home, { recursive: true, force: true });
    }
  });

  test("rejects aliases that shadow canonical seats or lanes", () => {
    const seatCollision = runConfigModuleWithHome({
      yaml: `
seatRegistry:
  orcClaude:
    aliases:
      - golemsClaude
`,
      code: `
        import { loadConfig } from ${JSON.stringify(configModuleUrl)};
        loadConfig();
      `,
    });

    try {
      expect(seatCollision.exitCode).not.toBe(0);
      expect(seatCollision.stderr).toContain("shadows canonical seat golemsClaude");
    } finally {
      rmSync(seatCollision.home, { recursive: true, force: true });
    }

    const laneCollision = runConfigModuleWithHome({
      yaml: `
seatRegistry:
  orcClaude:
    aliases:
      - golems
`,
      code: `
        import { loadConfig } from ${JSON.stringify(configModuleUrl)};
        loadConfig();
      `,
    });

    try {
      expect(laneCollision.exitCode).not.toBe(0);
      expect(laneCollision.stderr).toContain("shadows canonical lane golems");
    } finally {
      rmSync(laneCollision.home, { recursive: true, force: true });
    }
  });

  test("initConfig writes the registry mirror as commented illustrative YAML", () => {
    const result = runConfigModuleWithHome({
      code: `
        import { initConfig } from ${JSON.stringify(configModuleUrl)};
        initConfig();
      `,
    });

    try {
      expect(result.exitCode).toBe(0);
      const configText = readFileSync(
        join(result.home, ".golems", "config.yaml"),
        "utf-8",
      );
      expect(configText).toContain("# seatRegistry:");
      expect(configText).not.toMatch(/^seatRegistry:/m);
      expect(configText).not.toMatch(/^  orcClaude:/m);
    } finally {
      rmSync(result.home, { recursive: true, force: true });
    }
  });
});
