import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";

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

// --- CLI Routing Tests ---

describe("golems-cli update — routing", () => {
  test("'update' is listed in help text", async () => {
    const { stdout } = await run("--help");
    expect(stdout).toContain("update");
  });

  test("'update --help' shows update help", async () => {
    const { stdout, exitCode } = await run("update", "--help");
    expect(stdout).toContain("update");
    expect(stdout).toContain("--yes");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--verbose");
    expect(exitCode).toBe(0);
  });

  test("'wizard --update' aliases to update command", async () => {
    // Both should produce similar output when run with --dry-run against same config
    const tmpHome = await mkdtemp(join(tmpdir(), "update-alias-"));
    try {
      // Create a minimal config so update has something to work with
      const configDir = join(tmpHome, ".golems");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "config.json"),
        JSON.stringify({ reposPath: tmpHome, tools: {} }, null, 2),
      );
      // Create empty commands dir
      await mkdir(join(tmpHome, ".claude", "commands"), { recursive: true });

      const proc = Bun.spawn(["bun", CLI, "wizard", "--update", "--dry-run"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: tmpHome },
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Should run update flow, not wizard flow
      expect(stdout).not.toContain("Golems Setup Wizard");
      expect(stdout).toContain("Golems Update");
    } finally {
      await rm(tmpHome, { recursive: true, force: true });
    }
  });
});

// --- Pure Logic Tests ---

describe("diffTools", () => {
  // Import the pure function
  let diffTools: typeof import("../update").diffTools;

  beforeEach(async () => {
    const mod = await import("../update");
    diffTools = mod.diffTools;
  });

  test("detects newly added tools", () => {
    const current = { claude: "/usr/bin/claude" };
    const detected = {
      claude: "/usr/bin/claude",
      gemini: "/usr/bin/gemini",
    };
    const diff = diffTools(current, detected);
    expect(diff.added).toContain("gemini");
    expect(diff.removed).toHaveLength(0);
    expect(diff.pathChanged).toHaveLength(0);
  });

  test("detects removed tools", () => {
    const current = {
      claude: "/usr/bin/claude",
      gemini: "/usr/bin/gemini",
    };
    const detected = { claude: "/usr/bin/claude" };
    const diff = diffTools(current, detected);
    expect(diff.removed).toContain("gemini");
    expect(diff.added).toHaveLength(0);
  });

  test("detects path-changed tools", () => {
    const current = { claude: "/usr/local/bin/claude" };
    const detected = { claude: "/opt/homebrew/bin/claude" };
    const diff = diffTools(current, detected);
    expect(diff.pathChanged).toContain("claude");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  test("returns empty diff when nothing changed", () => {
    const tools = { claude: "/usr/bin/claude", gemini: "/usr/bin/gemini" };
    const diff = diffTools(tools, tools);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.pathChanged).toHaveLength(0);
  });
});

describe("migrateConfig", () => {
  let migrateConfig: typeof import("../update").migrateConfig;

  beforeEach(async () => {
    const mod = await import("../update");
    migrateConfig = mod.migrateConfig;
  });

  test("adds missing features field", () => {
    const config = { reposPath: "~/Gits", tools: {} };
    const result = migrateConfig(config);
    expect(result.config.features).toBeDefined();
    expect(result.changes).toContain("Added missing field: features");
  });

  test("preserves existing feature values", () => {
    const config = {
      reposPath: "~/Gits",
      tools: {},
      features: { nightShift: true, proactiveNudges: false, telegram: false },
    };
    const result = migrateConfig(config);
    expect(result.config.features!.nightShift).toBe(true);
    expect(result.changes).toHaveLength(0);
  });

  test("adds missing individual features", () => {
    const config = {
      reposPath: "~/Gits",
      tools: {},
      features: { nightShift: true },
    };
    const result = migrateConfig(config as any);
    expect(result.config.features!.proactiveNudges).toBe(false);
    expect(result.config.features!.telegram).toBe(false);
    // nightShift preserved
    expect(result.config.features!.nightShift).toBe(true);
  });

  test("returns no changes for up-to-date config", () => {
    const config = {
      reposPath: "~/Gits",
      tools: {},
      features: { nightShift: false, proactiveNudges: false, telegram: false },
    };
    const result = migrateConfig(config);
    expect(result.changes).toHaveLength(0);
  });
});

// --- Integration Tests (with temp filesystem) ---

describe("runUpdate — dry-run mode", () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "update-test-"));
    const configDir = join(tmpHome, ".golems");
    await mkdir(configDir, { recursive: true });
    await mkdir(join(tmpHome, ".claude", "commands"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  test("dry-run does not modify config file", async () => {
    const configPath = join(tmpHome, ".golems", "config.json");
    const originalConfig = { reposPath: tmpHome, tools: {} };
    await writeFile(configPath, JSON.stringify(originalConfig, null, 2));

    const proc = Bun.spawn(["bun", CLI, "update", "--dry-run"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Config should be unchanged
    const afterConfig = JSON.parse(await readFile(configPath, "utf8"));
    expect(afterConfig).toEqual(originalConfig);

    // Output should indicate dry-run
    expect(stdout).toContain("dry");
  });

  test("update with no config prints error", async () => {
    // No config file — should tell user to run wizard first
    const noConfigHome = await mkdtemp(join(tmpdir(), "update-noconfig-"));
    try {
      const proc = Bun.spawn(["bun", CLI, "update"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: noConfigHome },
      });
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(stdout + stderr).toContain("wizard");
      expect(exitCode).toBe(1);
    } finally {
      await rm(noConfigHome, { recursive: true, force: true });
    }
  });

  test("update detects tool changes", async () => {
    const configPath = join(tmpHome, ".golems", "config.json");
    // Config with a tool that definitely exists (bun) and one that doesn't (fake-tool)
    const config = {
      reposPath: tmpHome,
      tools: { "fake-tool": "/usr/bin/fake-tool" },
    };
    await writeFile(configPath, JSON.stringify(config, null, 2));

    const proc = Bun.spawn(["bun", CLI, "update", "--dry-run", "--verbose"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Should report that fake-tool was removed from detected tools
    // (it won't be found by `which`)
    expect(stdout).toContain("fake-tool");
  });

  test("update shows summary", async () => {
    const configPath = join(tmpHome, ".golems", "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ reposPath: tmpHome, tools: {} }, null, 2),
    );

    const proc = Bun.spawn(["bun", CLI, "update", "--dry-run"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: tmpHome },
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Should have a summary section
    expect(stdout).toContain("Summary");
  });
});

describe("runUpdate — local skill safety", () => {
  test("updates real directories but skips symlinks without touching checkout files", async () => {
    const tmpHome = await mkdtemp(join(tmpdir(), "update-symlink-safety-"));
    const originalFetch = global.fetch;
    const originalLog = console.log;
    const logs: string[] = [];

    try {
      const skillsDir = join(tmpHome, ".claude", "skills");
      const checkoutSkill = join(tmpHome, "checkout", "local-skill");
      const configPath = join(tmpHome, ".golems", "config.json");
      await mkdir(join(skillsDir, "remote-skill"), { recursive: true });
      await mkdir(checkoutSkill, { recursive: true });
      await mkdir(join(tmpHome, ".golems"), { recursive: true });
      await writeFile(
        join(skillsDir, "remote-skill", "SKILL.md"),
        "old remote content",
      );
      await writeFile(
        join(checkoutSkill, "SKILL.md"),
        "uncommitted checkout content",
      );
      await symlink(checkoutSkill, join(skillsDir, "local-skill"));
      await writeFile(
        configPath,
        JSON.stringify({ reposPath: tmpHome, tools: {} }),
      );

      global.fetch = (async (url: string | URL | Request) => {
        const value = url.toString();
        if (value.includes("contents/skills/golem-powers/remote-skill")) {
          return new Response(
            JSON.stringify([
              {
                name: "SKILL.md",
                type: "file",
                path: "skills/golem-powers/remote-skill/SKILL.md",
                download_url: "https://example.test/remote-skill/SKILL.md",
                url: "",
              },
            ]),
            { status: 200 },
          );
        }
        if (value === "https://example.test/remote-skill/SKILL.md") {
          return new Response("new remote content", { status: 200 });
        }
        return new Response("Not Found", { status: 404 });
      }) as typeof fetch;
      console.log = (...args: unknown[]) => logs.push(args.join(" "));

      const { runUpdate } = await import("../update");
      const result = await runUpdate({
        yes: true,
        dryRun: false,
        verbose: false,
        configPath,
        commandsDir: skillsDir,
      });

      expect(result.skillsUpdated).toBe(1);
      expect(result.skillsSkippedLocal).toBe(1);
      expect(await readFile(join(checkoutSkill, "SKILL.md"), "utf8")).toBe(
        "uncommitted checkout content",
      );
      expect(
        await readFile(join(skillsDir, "remote-skill", "SKILL.md"), "utf8"),
      ).toBe("new remote content");
      expect(logs).toContain("  remote-skill: updated");
      expect(logs).toContain("  local-skill: skipped-local");
      expect(logs).toContain("  Updated 1 skills; skipped 1 local.");
    } finally {
      console.log = originalLog;
      global.fetch = originalFetch;
      await rm(tmpHome, { recursive: true, force: true });
    }
  });
});

describe("runUpdate — flags", () => {
  test("--yes flag is accepted", async () => {
    const tmpHome = await mkdtemp(join(tmpdir(), "update-yes-"));
    try {
      const configDir = join(tmpHome, ".golems");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "config.json"),
        JSON.stringify({ reposPath: tmpHome, tools: {} }, null, 2),
      );
      await mkdir(join(tmpHome, ".claude", "commands"), { recursive: true });

      const proc = Bun.spawn(["bun", CLI, "update", "--yes", "--dry-run"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: tmpHome },
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Should not prompt, should complete
      expect(exitCode).toBe(0);
    } finally {
      await rm(tmpHome, { recursive: true, force: true });
    }
  });

  test("-y is alias for --yes", async () => {
    const tmpHome = await mkdtemp(join(tmpdir(), "update-y-"));
    try {
      const configDir = join(tmpHome, ".golems");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "config.json"),
        JSON.stringify({ reposPath: tmpHome, tools: {} }, null, 2),
      );
      await mkdir(join(tmpHome, ".claude", "commands"), { recursive: true });

      const proc = Bun.spawn(["bun", CLI, "update", "-y", "--dry-run"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: tmpHome },
      });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    } finally {
      await rm(tmpHome, { recursive: true, force: true });
    }
  });
});
