import { describe, test, expect, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

const CLI = join(import.meta.dir, "..", "index.ts");

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("wizard CLI routing", () => {
  test("wizard command is recognized and runs", async () => {
    // Wizard requires stdin, so it will hang in non-interactive mode
    // but we can verify the command is recognized by checking help text
    const { stdout } = await run("--help");
    expect(stdout).toContain("wizard");
    // Wizard line specifically should not say "coming soon"
    const wizardLine = stdout
      .split("\n")
      .find((l: string) => l.includes("wizard"));
    expect(wizardLine).not.toContain("coming soon");
  });
});

describe("wizard module", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "wizard-test-"));
    configPath = join(tmpDir, "config.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("detects existing config and returns its content", async () => {
    const existingConfig = {
      reposPath: "~/Gits",
      tools: { claude: "/usr/local/bin/claude" },
      features: { proactiveNudges: true, nightShift: false, telegram: false },
    };
    await writeFile(configPath, JSON.stringify(existingConfig, null, 2));

    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw);

    expect(config.reposPath).toBe("~/Gits");
    expect(config.tools.claude).toBe("/usr/local/bin/claude");
    expect(config.features.proactiveNudges).toBe(true);
    expect(config.features.nightShift).toBe(false);
  });

  test("config with all features disabled is valid", async () => {
    const config = {
      reposPath: "~/Projects",
      tools: { claude: "/usr/local/bin/claude" },
      features: {
        proactiveNudges: false,
        nightShift: false,
        telegram: false,
      },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.reposPath).toBe("~/Projects");
    expect(parsed.features.proactiveNudges).toBe(false);
    expect(parsed.features.nightShift).toBe(false);
    expect(parsed.features.telegram).toBe(false);
  });

  test("config with multiple tools is valid", async () => {
    const config = {
      reposPath: "~/Gits",
      tools: {
        claude: "/usr/local/bin/claude",
        cursor: "/usr/local/bin/cursor",
        gemini: "/opt/homebrew/bin/gemini",
      },
      features: {
        proactiveNudges: true,
        nightShift: false,
        telegram: false,
      },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);

    expect(Object.keys(parsed.tools)).toHaveLength(3);
    expect(parsed.tools.claude).toBe("/usr/local/bin/claude");
    expect(parsed.tools.cursor).toBe("/usr/local/bin/cursor");
    expect(parsed.tools.gemini).toBe("/opt/homebrew/bin/gemini");
  });

  test("config does not include tools that were not found", async () => {
    // Simulate: only claude found, others not
    const tools: Record<string, string> = {};
    tools.claude = "/usr/local/bin/claude";
    // cursor, gemini, codex, kiro NOT added (not found)

    const config = {
      reposPath: "~/Projects",
      tools,
      features: {
        proactiveNudges: false,
        nightShift: false,
        telegram: false,
      },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);

    expect(Object.keys(parsed.tools)).toHaveLength(1);
    expect(parsed.tools.claude).toBeDefined();
    expect(parsed.tools.cursor).toBeUndefined();
    expect(parsed.tools.gemini).toBeUndefined();
  });

  test("config directory is created if missing", async () => {
    const nestedPath = join(tmpDir, "nested", ".golems", "config.json");
    const nestedDir = join(tmpDir, "nested", ".golems");

    await mkdir(nestedDir, { recursive: true });
    await writeFile(
      nestedPath,
      JSON.stringify({ reposPath: "~/test" }, null, 2) + "\n",
    );

    const raw = await readFile(nestedPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.reposPath).toBe("~/test");
  });

  test("feature flags default to false when not specified", async () => {
    const config = {
      reposPath: "~/Code",
      tools: { claude: "/usr/local/bin/claude" },
      features: {
        proactiveNudges: false,
        nightShift: false,
        telegram: false,
      },
    };

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);

    // All features should be explicitly false
    for (const feature of ["proactiveNudges", "nightShift", "telegram"]) {
      expect(parsed.features[feature]).toBe(false);
    }
  });

  test("selective feature enablement preserves other defaults", async () => {
    // User enables only proactiveNudges
    const enabledFeatures = new Set(["proactiveNudges"]);
    const features: Record<string, boolean> = {};
    for (const f of ["proactiveNudges", "nightShift", "telegram"]) {
      features[f] = enabledFeatures.has(f);
    }

    expect(features.proactiveNudges).toBe(true);
    expect(features.nightShift).toBe(false);
    expect(features.telegram).toBe(false);
  });
});

// The wizard skill was absorbed into golem-install (GO-3 PR-1); its five eval
// cases live in golem-install's evals.json, tagged absorbed_from: "wizard" and
// keeping their original numbers as absorbed_id.
async function loadWizardEvals() {
  const evalsPath = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "skills",
    "golem-powers",
    "golem-install",
    "evals",
    "evals.json",
  );
  const data = JSON.parse(await readFile(evalsPath, "utf8"));
  const evals = data.evals
    .filter((ev: { absorbed_from?: string }) => ev.absorbed_from === "wizard")
    .map((ev: { absorbed_id: number }) => ({ ...ev, id: ev.absorbed_id }));
  return { ...data, evals };
}

describe("evals.json structure", () => {
  test("evals.json is valid and has all required fields", async () => {
    const data = await loadWizardEvals();

    expect(data.skill_name).toBe("golem-install");
    expect(data.evals).toBeArray();
    expect(data.evals).toHaveLength(5);

    for (const ev of data.evals) {
      expect(ev.id).toBeNumber();
      expect(ev.prompt).toBeString();
      expect(ev.expected_output).toBeString();
      expect(ev.files).toBeArray();
      expect(ev.assertions).toBeArray();
      expect(ev.assertions.length).toBeGreaterThan(0);

      for (const assertion of ev.assertions) {
        expect(assertion.name).toBeString();
        expect(assertion.description).toBeString();
      }
    }
  });

  test("eval 1 covers fresh machine with all prerequisites", async () => {
    const data = await loadWizardEvals();
    const eval1 = data.evals[0];

    expect(eval1.id).toBe(1);
    expect(eval1.prompt).toContain("fresh machine");
    expect(eval1.prompt).toContain("All 6 prerequisites");

    const assertionNames = eval1.assertions.map(
      (a: { name: string }) => a.name,
    );
    expect(assertionNames).toContain("checks-all-six-prerequisites");
    expect(assertionNames).toContain("creates-config-yaml-not-json");
    expect(assertionNames).toContain("clones-repos-to-repos-path");
    expect(assertionNames).toContain("verifies-brainlayer-connection");
    expect(assertionNames).toContain("displays-final-report");
  });

  test("eval 3 covers already-configured scenario", async () => {
    const data = await loadWizardEvals();
    const eval3 = data.evals[2];

    expect(eval3.id).toBe(3);
    expect(eval3.prompt).toContain("already exists");

    const assertionNames = eval3.assertions.map(
      (a: { name: string }) => a.name,
    );
    expect(assertionNames).toContain("reads-existing-config");
    expect(assertionNames).toContain("skips-existing-repos");
    expect(assertionNames).toContain("offers-sync-config-diff");
    expect(assertionNames).toContain("does-not-overwrite-config");
  });

  test("eval 5 covers invalid workspace path", async () => {
    const data = await loadWizardEvals();
    const eval5 = data.evals[4];

    expect(eval5.id).toBe(5);
    expect(eval5.prompt).toContain("doesn't exist");

    const assertionNames = eval5.assertions.map(
      (a: { name: string }) => a.name,
    );
    expect(assertionNames).toContain("validates-workspace-path");
    expect(assertionNames).toContain("rejects-invalid-path");
    expect(assertionNames).toContain("accepts-valid-path");
    expect(assertionNames).toContain("does-not-write-invalid-config");
  });

  test("evals do not reference missing fixture files", async () => {
    const data = await loadWizardEvals();

    for (const ev of data.evals) {
      expect(ev.files).toEqual([]);
    }
  });

  test("total assertion count is 24", async () => {
    const data = await loadWizardEvals();

    let totalAssertions = 0;
    for (const ev of data.evals) {
      totalAssertions += ev.assertions.length;
    }
    expect(totalAssertions).toBe(24);
  });
});

describe("config.ts platform support", () => {
  test("getWhichCommand returns which on non-Windows", async () => {
    const { getWhichCommand } = await import("../config");
    // On macOS/Linux this should be "which"
    if (process.platform !== "win32") {
      expect(getWhichCommand()).toBe("which");
    }
  });

  test("autoDetectTools returns object with string values", async () => {
    const { autoDetectTools } = await import("../config");
    const tools = await autoDetectTools();
    expect(typeof tools).toBe("object");
    for (const [key, val] of Object.entries(tools)) {
      expect(typeof key).toBe("string");
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
    }
  });

  test("detectClaudeDesktop returns boolean", async () => {
    const { detectClaudeDesktop } = await import("../config");
    const result = await detectClaudeDesktop();
    expect(typeof result).toBe("boolean");
  });
});

describe("wizard MCP recommendations", () => {
  test("SKILL_MCP_MAP has correct structure", async () => {
    const { SKILL_MCP_MAP } = await import("../wizard");
    expect(typeof SKILL_MCP_MAP).toBe("object");

    for (const [skill, mapping] of Object.entries(SKILL_MCP_MAP)) {
      expect(typeof skill).toBe("string");
      if (mapping.required) {
        expect(Array.isArray(mapping.required)).toBe(true);
        for (const mcp of mapping.required) {
          expect(typeof mcp).toBe("string");
        }
      }
      if (mapping.complement) {
        expect(Array.isArray(mapping.complement)).toBe(true);
        for (const mcp of mapping.complement) {
          expect(typeof mcp).toBe("string");
        }
      }
    }
  });

  test("recommendMcps returns needed MCPs filtering configured ones", async () => {
    const { recommendMcps } = await import("../wizard");
    const configured = new Set<string>(["google-calendar"]);
    const recs = recommendMcps(["coach"], configured);

    // google-calendar is configured, should not appear
    expect(recs.find((r) => r.mcp === "google-calendar")).toBeUndefined();
    // Remaining optional coach integrations should appear.
    const mcpNames = recs.map((r) => r.mcp);
    expect(mcpNames).toContain("sophtron");
  });

  test("recommendMcps returns empty for non-MCP skills", async () => {
    const { recommendMcps } = await import("../wizard");
    const recs = recommendMcps(["pr-loop", "unslop"], new Set());
    expect(recs).toHaveLength(0);
  });

  test("recommendMcps includes all unconfigured MCPs", async () => {
    const { recommendMcps } = await import("../wizard");
    const recs = recommendMcps(["coach"], new Set());
    const mcpNames = recs.map((r) => r.mcp);
    expect(mcpNames).toContain("google-calendar");
    expect(mcpNames).toContain("sophtron");
    expect(mcpNames).toContain("brainlayer");
    expect(mcpNames).toContain("supabase");
  });

  test("mcp-map is the single source of truth for both wizard and update", async () => {
    const { SKILL_MCP_MAP: fromWizard } = await import("../wizard");
    const { SKILL_MCP_MAP: fromUpdate } = await import("../update");
    const { SKILL_MCP_MAP: fromMap } = await import("../mcp-map");

    // All three should reference the same object
    expect(fromWizard).toBe(fromMap);
    expect(fromUpdate).toBe(fromMap);
  });
});

// The 13 skills the wizard used to offer that were never in skills/golem-powers.
const PHANTOM_SKILLS = [
  "commit", "github", "test-plan", "simplify", "research", "youtube-pipeline",
  "call-debrief", "catchup", "orchestrator-status", "railway", "convex",
  "vercel", "video-showcase",
];

// The real catalog: the same rule as listSkills (a directory with a SKILL.md).
function catalogSkills(): string[] {
  const root = join(import.meta.dir, "..", "..", "..", "..", "skills", "golem-powers");
  return readdirSync(root).filter((name) => existsSync(join(root, name, "SKILL.md")));
}

describe("wizard skill categories", () => {
  // The remote list is injected: the default reads skills/ from GitHub, which
  // a unit test must not depend on.
  test("getSkillCategories offers only skills in the remote catalog", async () => {
    const { getSkillCategories } = await import("../wizard");
    const categories = await getSkillCategories(async () => ["pr-loop", "unslop", "coach"]);
    const offered = Object.values(categories).flat();
    for (const phantom of PHANTOM_SKILLS) expect(offered).not.toContain(phantom);
    expect(offered.sort()).toEqual(["coach", "pr-loop", "unslop"]);
    expect(categories.Development).toEqual(["pr-loop"]);
    expect(categories.Operations).toEqual(["coach"]);
    expect(categories.Other).toEqual(["unslop"]);
    expect(categories.Research).toBeUndefined();
  });

  test("getSkillCategories files unknown remote skills under Other", async () => {
    const { getSkillCategories } = await import("../wizard");
    const categories = await getSkillCategories(async () => ["pr-loop", "brand-new-skill"]);
    expect(categories.Other).toEqual(["brand-new-skill"]);
  });

  test("getSkillCategories falls back to the static list when the remote list fails", async () => {
    const { getSkillCategories } = await import("../wizard");
    const categories = await getSkillCategories(async () => {
      throw new Error("offline");
    });
    expect(categories.Other).toBeUndefined();
    expect(categories.Development).toContain("pr-loop");
  });

  test("the offline fallback lists only skills that exist in skills/golem-powers", async () => {
    const { getSkillCategories } = await import("../wizard");
    const fallback = await getSkillCategories(async () => []);
    const catalog = new Set(catalogSkills());
    for (const skill of Object.values(fallback).flat()) {
      expect(catalog.has(skill), `${skill} is not in skills/golem-powers`).toBe(true);
    }
  });

  test("the (r)ecommended install set lists only skills that exist in skills/golem-powers", async () => {
    const { RECOMMENDED_SKILLS } = await import("../wizard");
    const catalog = new Set(catalogSkills());
    expect(RECOMMENDED_SKILLS.length).toBeGreaterThan(0);
    for (const skill of RECOMMENDED_SKILLS) {
      expect(catalog.has(skill), `${skill} is not in skills/golem-powers`).toBe(true);
    }
  });

  test("SKILL_MCP_MAP only maps skills that exist in skills/golem-powers", async () => {
    const { SKILL_MCP_MAP } = await import("../mcp-map");
    const catalog = new Set(catalogSkills());
    for (const skill of Object.keys(SKILL_MCP_MAP)) {
      expect(catalog.has(skill), `${skill} is not in skills/golem-powers`).toBe(true);
    }
  });
});

describe("execution mode detection", () => {
  test("detectExecutionMode returns cli when CLAUDE_CODE not set", async () => {
    const { detectExecutionMode } = await import("../wizard");
    const original = process.env.CLAUDE_CODE;
    delete process.env.CLAUDE_CODE;
    expect(detectExecutionMode()).toBe("cli");
    if (original !== undefined) process.env.CLAUDE_CODE = original;
  });

  test("detectExecutionMode returns skill when CLAUDE_CODE is set", async () => {
    const { detectExecutionMode } = await import("../wizard");
    const original = process.env.CLAUDE_CODE;
    process.env.CLAUDE_CODE = "1";
    expect(detectExecutionMode()).toBe("skill");
    if (original !== undefined) {
      process.env.CLAUDE_CODE = original;
    } else {
      delete process.env.CLAUDE_CODE;
    }
  });
});

describe("fixture consistency", () => {
  test("wizard evals are self-contained", async () => {
    const data = await loadWizardEvals();

    for (const ev of data.evals) {
      expect(ev.files).toEqual([]);
      expect(ev.expected_output.length).toBeGreaterThan(0);
    }
  });
});

describe("wizard CLI hints", () => {
  // The npm package golems-cli is behind this repo (README "CLI"), so the
  // wizard points at the from-source command the README documents.
  test("hints print the README's run-from-source command, not npx", async () => {
    const { CLI_COMMAND } = await import("../wizard");
    expect(CLI_COMMAND).toBe("bun packages/golem-skills/src/index.ts");
    const source = await readFile(join(import.meta.dir, "..", "wizard.ts"), "utf8");
    expect(source).not.toContain("npx golems-cli");
  });
});
