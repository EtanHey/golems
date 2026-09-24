import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { deepMerge } from "@golems/shared/lib/config";

describe("config", () => {
  const testDir = join(tmpdir(), `golems-config-test-${Date.now()}`);
  const configDir = join(testDir, ".golems");
  const configFile = join(configDir, "config.yaml");

  beforeEach(() => {
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("deepMerge merges nested objects", () => {
    const defaults = {
      a: 1,
      b: { c: 2, d: 3 },
      e: [1, 2],
    };
    const overrides = {
      a: 10,
      b: { c: 20 },
    };

    const merged = deepMerge(defaults, overrides as Partial<typeof defaults>);
    expect(merged.a).toBe(10);
    expect(merged.b.c).toBe(20);
    expect(merged.b.d).toBe(3); // preserved from defaults
    expect(merged.e).toEqual([1, 2]); // arrays not deep-merged
  });

  test("deepMerge preserves defaults when overrides are empty", () => {
    const defaults = { x: 1, y: { z: 2 } };
    const merged = deepMerge(defaults, {});
    expect(merged).toEqual(defaults);
  });

  test("deepMerge handles array overrides", () => {
    const defaults = { items: [1, 2, 3] };
    const overrides = { items: [4, 5] };
    const merged = deepMerge(defaults, overrides);
    expect(merged.items).toEqual([4, 5]); // arrays replaced, not merged
  });

  test("YAML config is parsed correctly", async () => {
    const { parse } = await import("yaml");

    const yaml = `
reposPath: "/custom/path"
nightshift:
  rotation:
    - repo-a
    - repo-b
  timeout: 60000
features:
  soltome: false
`;
    const parsed = parse(yaml);
    expect(parsed.reposPath).toBe("/custom/path");
    expect(parsed.nightshift.rotation).toEqual(["repo-a", "repo-b"]);
    expect(parsed.nightshift.timeout).toBe(60000);
    expect(parsed.features.soltome).toBe(false);
  });

  // Live ~/.golems/config.yaml shape (2026-09-24): it overrides orcClaude with its
  // own directReports, so a seat that exists only in the code defaults and names
  // orcClaude as parent fails validateSeatRegistry and loadConfig() throws.
  test("loadConfig accepts a file registry that overrides orcClaude.directReports", () => {
    const yaml = `seatRegistry:
  orcClaude:
    repo: orc
    launchers: { claude: orcClaude, codex: orcCodex, cursor: orcCursor, gemini: orcGemini, kiro: orcKiro }
    lane: orc
    aliases: [HappyCamper, Cantaloupe-AI, happyCampr]
    role: orc
    orgTree:
      parent: null
      directReports: [golemsLead, skillcreatorLead, cmuxlayerLead, dashboardLead, brainClaude, coachClaude, voiceClaude, aftercodeClaude]
`;
    writeFileSync(configFile, yaml);
    const configModule = join(import.meta.dir, "../lib/config.ts");
    const result = spawnSync(
      process.execPath,
      ["-e", `const { loadConfig } = await import(${JSON.stringify(configModule)}); console.log(Object.keys(loadConfig().seatRegistry).length);`],
      { encoding: "utf8", env: { ...process.env, HOME: testDir } },
    );
    expect(result.stderr).not.toContain("does not include");
    expect(result.status).toBe(0);
  });

  function loadConfigUnderHome(yaml: string) {
    writeFileSync(configFile, yaml);
    const configModule = join(import.meta.dir, "../lib/config.ts");
    return spawnSync(
      process.execPath,
      ["-e", `const { loadConfig } = await import(${JSON.stringify(configModule)}); console.log(JSON.stringify(Object.keys(loadConfig().seatRegistry)));`],
      { encoding: "utf8", env: { ...process.env, HOME: testDir } },
    );
  }

  const orcOverride = (directReports: string[]) => `seatRegistry:
  orcClaude:
    repo: orc
    launchers: { claude: orcClaude, codex: orcCodex, cursor: orcCursor, gemini: orcGemini, kiro: orcKiro }
    lane: orc
    aliases: [HappyCamper, Cantaloupe-AI, happyCampr]
    role: orc
    orgTree:
      parent: null
      directReports: [${directReports.join(", ")}]
`;

  // A default seat the file never mentions must not break a file that overrides
  // its parent's directReports: the file is the source of truth, so the
  // default-only seat (and its default-only descendants) is dropped.
  test("loadConfig drops default-only children a file override of their parent omits", () => {
    const result = loadConfigUnderHome(
      orcOverride(["golemsLead", "skillcreatorLead", "cmuxlayerLead", "brainClaude", "coachClaude", "voiceClaude"]),
    );
    expect(result.stderr).not.toContain("does not include");
    expect(result.status).toBe(0);
    const seats: string[] = JSON.parse(result.stdout);
    expect(seats).not.toContain("aftercodeClaude");
    expect(seats).not.toContain("dashboardLead");
    expect(seats).not.toContain("dashboardClaude");
    expect(seats).toContain("golemsClaude");
  });

  test("loadConfig stays strict for a seat the file itself declares", () => {
    const result = loadConfigUnderHome(
      orcOverride(["golemsLead", "skillcreatorLead", "cmuxlayerLead", "dashboardLead", "brainClaude", "coachClaude", "voiceClaude", "aftercodeClaude"]) +
        `  newClaude:
    repo: new
    launchers: { claude: newClaude, codex: newCodex, cursor: newCursor, gemini: newGemini, kiro: newKiro }
    lane: new
    aliases: []
    role: lead
    orgTree:
      parent: orcClaude
      directReports: []
`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not include newClaude");
  });

  function runConfigCode(yaml: string, body: string) {
    writeFileSync(configFile, yaml);
    const configModule = join(import.meta.dir, "../lib/config.ts");
    return spawnSync(
      process.execPath,
      ["-e", `const config = await import(${JSON.stringify(configModule)}); ${body}`],
      { encoding: "utf8", env: { ...process.env, HOME: testDir } },
    );
  }

  const omitDashboardAndAftercode = [
    "golemsLead", "skillcreatorLead", "cmuxlayerLead", "brainClaude", "coachClaude", "voiceClaude",
  ];

  test("getPrunedDefaultSeats names each pruned default seat and why", () => {
    const result = runConfigCode(
      orcOverride(omitDashboardAndAftercode),
      "console.log(JSON.stringify(config.getPrunedDefaultSeats()));",
    );
    expect(result.status).toBe(0);
    const pruned: Array<{ seat: string; reason: string }> = JSON.parse(result.stdout);
    expect(pruned).toContainEqual({
      seat: "aftercodeClaude",
      reason: "orcClaude.orgTree.directReports in your config omits it",
    });
    expect(pruned).toContainEqual({
      seat: "dashboardLead",
      reason: "orcClaude.orgTree.directReports in your config omits it",
    });
    expect(pruned).toContainEqual({ seat: "dashboardClaude", reason: "its parent dashboardLead was pruned" });
  });

  test("an unknown-seat error names the prune when the missing seat was pruned", () => {
    const result = runConfigCode(
      orcOverride(omitDashboardAndAftercode) +
        `  dashboardClaude:
    orgTree:
      parent: dashboardLead
`,
      "config.loadConfig();",
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("references unknown seat dashboardLead");
    expect(result.stderr).toContain(
      "dashboardLead is a default seat pruned because orcClaude.orgTree.directReports in your config omits it",
    );
  });

  test("config file can be written and read back", () => {
    const yaml = `reposPath: "/test/path"\n`;
    writeFileSync(configFile, yaml);
    expect(existsSync(configFile)).toBe(true);
  });
});
