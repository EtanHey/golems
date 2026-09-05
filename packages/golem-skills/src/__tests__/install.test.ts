import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  mkdtemp,
  rm,
  readFile,
  mkdir,
  writeFile,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAllSkills, installSkill } from "../install";

describe("installSkill()", () => {
  let tmpDir: string;
  let commandsDir: string;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "golem-skills-install-test-"));
    commandsDir = join(tmpDir, "commands");
    await mkdir(commandsDir, { recursive: true });
    originalFetch = global.fetch;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    global.fetch = originalFetch;
  });

  function mockGitHub(
    skillName: string,
    files: { path: string; content: string }[],
  ) {
    global.fetch = mock(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      // Contents API listing
      if (
        u.includes(`contents/skills/golem-powers/${skillName}`) &&
        !u.includes("raw.githubusercontent")
      ) {
        const entries = files.map((f) => ({
          name: f.path.split("/").pop(),
          type: "file",
          path: `skills/golem-powers/${skillName}/${f.path}`,
          download_url: `https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/${skillName}/${f.path}`,
          url: "",
        }));
        return new Response(JSON.stringify(entries), { status: 200 });
      }
      // Raw file download
      const matchedFile = files.find((f) => u.includes(f.path));
      if (matchedFile) {
        return new Response(matchedFile.content, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;
  }

  test("creates skill directory and writes SKILL.md", async () => {
    mockGitHub("cmux", [{ path: "SKILL.md", content: "# cmux skill" }]);

    await installSkill("cmux", { commandsDir });

    const content = await readFile(
      join(commandsDir, "cmux", "SKILL.md"),
      "utf8",
    );
    expect(content).toBe("# cmux skill");
  });

  test("skips install if skill already exists (no force)", async () => {
    const skillDir = join(commandsDir, "cmux");
    await mkdir(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "existing content");

    let fetchCalled = false;
    global.fetch = mock(async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    await installSkill("cmux", { commandsDir, force: false });

    expect(fetchCalled).toBe(false);
    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    expect(content).toBe("existing content");
  });

  test("overwrites existing skill with force: true", async () => {
    const skillDir = join(commandsDir, "cmux");
    await mkdir(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "old content");

    mockGitHub("cmux", [{ path: "SKILL.md", content: "new content" }]);

    await installSkill("cmux", { commandsDir, force: true });

    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    expect(content).toBe("new content");
  });

  test("refuses to write through a symlinked skill directory", async () => {
    const checkoutSkill = join(tmpDir, "checkout", "cmux");
    await mkdir(checkoutSkill, { recursive: true });
    await writeFile(join(checkoutSkill, "SKILL.md"), "checkout content");
    await symlink(checkoutSkill, join(commandsDir, "cmux"));
    mockGitHub("cmux", [{ path: "SKILL.md", content: "remote content" }]);

    await expect(
      installSkill("cmux", { commandsDir, force: true }),
    ).rejects.toThrow(checkoutSkill);
    expect(await readFile(join(checkoutSkill, "SKILL.md"), "utf8")).toBe(
      "checkout content",
    );
  });

  test("skips an existing symlinked skill directory without force", async () => {
    const checkoutSkill = join(tmpDir, "checkout", "cmux");
    await mkdir(checkoutSkill, { recursive: true });
    await writeFile(join(checkoutSkill, "SKILL.md"), "checkout content");
    await symlink(checkoutSkill, join(commandsDir, "cmux"));

    let fetchCalled = false;
    global.fetch = mock(async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await installSkill("cmux", { commandsDir, force: false });

    expect(result).toMatchObject({
      name: "cmux",
      installed: false,
      skipped: true,
      source: "local",
      filesWritten: 0,
    });
    expect(fetchCalled).toBe(false);
    expect(await readFile(join(checkoutSkill, "SKILL.md"), "utf8")).toBe(
      "checkout content",
    );
  });

  test("records per-skill failures and continues installing the batch", async () => {
    const checkoutSkill = join(tmpDir, "checkout", "bravo");
    await mkdir(checkoutSkill, { recursive: true });
    await writeFile(join(checkoutSkill, "SKILL.md"), "checkout content");
    await symlink(checkoutSkill, join(commandsDir, "bravo"));
    global.fetch = mock(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      const name = u.includes("/alpha")
        ? "alpha"
        : u.includes("/charlie")
          ? "charlie"
          : undefined;
      if (!name) return new Response("Not Found", { status: 404 });
      if (u.includes("raw.githubusercontent")) {
        return new Response(`${name} content`, { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            name: "SKILL.md",
            type: "file",
            path: `skills/golem-powers/${name}/SKILL.md`,
            download_url: `https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/${name}/SKILL.md`,
            url: "",
          },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const results = await installAllSkills(["alpha", "bravo", "charlie"], {
      commandsDir,
      force: true,
    });

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ name: "alpha", installed: true });
    expect(results[1]).toMatchObject({
      name: "bravo",
      installed: false,
      skipped: false,
      source: "local",
    });
    expect(results[1]?.error).toContain(checkoutSkill);
    expect(results[2]).toMatchObject({ name: "charlie", installed: true });
    expect(await readFile(join(commandsDir, "alpha", "SKILL.md"), "utf8")).toBe(
      "alpha content",
    );
    expect(await readFile(join(commandsDir, "charlie", "SKILL.md"), "utf8")).toBe(
      "charlie content",
    );
    expect(await readFile(join(checkoutSkill, "SKILL.md"), "utf8")).toBe(
      "checkout content",
    );
  });

  test("refuses a dangling symlink and names its intended target", async () => {
    const missingTarget = join(tmpDir, "checkout", "moved-cmux");
    await symlink(missingTarget, join(commandsDir, "cmux"));
    mockGitHub("cmux", [{ path: "SKILL.md", content: "remote content" }]);

    await expect(
      installSkill("cmux", { commandsDir, force: true }),
    ).rejects.toThrow(missingTarget);
  });

  test("refuses to overwrite a symlinked destination file", async () => {
    const checkoutFile = join(tmpDir, "checkout", "SKILL.md");
    const skillDir = join(commandsDir, "cmux");
    await mkdir(join(tmpDir, "checkout"), { recursive: true });
    await mkdir(skillDir);
    await writeFile(checkoutFile, "checkout content");
    await symlink(checkoutFile, join(skillDir, "SKILL.md"));
    mockGitHub("cmux", [{ path: "SKILL.md", content: "remote content" }]);

    await expect(
      installSkill("cmux", { commandsDir, force: true }),
    ).rejects.toThrow(checkoutFile);
    expect(await readFile(checkoutFile, "utf8")).toBe("checkout content");
  });

  test("installs through a relocated symlinked skills root", async () => {
    const actualSkillsDir = join(tmpDir, "actual-skills");
    const linkedSkillsDir = join(tmpDir, "linked-skills");
    await mkdir(actualSkillsDir);
    await symlink(actualSkillsDir, linkedSkillsDir);
    mockGitHub("cmux", [{ path: "SKILL.md", content: "remote content" }]);

    const result = await installSkill("cmux", {
      commandsDir: linkedSkillsDir,
    });

    expect(result.installed).toBe(true);
    expect(
      await readFile(join(actualSkillsDir, "cmux", "SKILL.md"), "utf8"),
    ).toBe("remote content");
  });

  test("installs through a relocated parent above the skills root", async () => {
    const actualClaudeDir = join(tmpDir, "dotfiles", ".claude");
    const linkedClaudeDir = join(tmpDir, ".claude");
    const linkedSkillsDir = join(linkedClaudeDir, "skills");
    await mkdir(join(actualClaudeDir, "skills"), { recursive: true });
    await symlink(actualClaudeDir, linkedClaudeDir);
    mockGitHub("cmux", [{ path: "SKILL.md", content: "remote content" }]);

    const result = await installSkill("cmux", {
      commandsDir: linkedSkillsDir,
    });

    expect(result.installed).toBe(true);
    expect(
      await readFile(
        join(actualClaudeDir, "skills", "cmux", "SKILL.md"),
        "utf8",
      ),
    ).toBe("remote content");
  });

  test("refuses to write through a symlinked parent inside a skill", async () => {
    const checkoutDir = join(tmpDir, "checkout", "adapters");
    const skillDir = join(commandsDir, "cmux");
    await mkdir(checkoutDir, { recursive: true });
    await mkdir(skillDir);
    await writeFile(join(checkoutDir, "codex.md"), "checkout content");
    await symlink(checkoutDir, join(skillDir, "adapters"));
    mockGitHub("cmux", [
      { path: "adapters/codex.md", content: "remote content" },
    ]);

    await expect(
      installSkill("cmux", { commandsDir, force: true }),
    ).rejects.toThrow(checkoutDir);
    expect(await readFile(join(checkoutDir, "codex.md"), "utf8")).toBe(
      "checkout content",
    );
  });

  test("returns install result with skill name", async () => {
    mockGitHub("commit", [{ path: "SKILL.md", content: "# commit" }]);

    const result = await installSkill("commit", { commandsDir });

    expect(result.name).toBe("commit");
    expect(result.installed).toBe(true);
  });

  test("returns skipped result when already installed", async () => {
    await mkdir(join(commandsDir, "cmux"));

    const result = await installSkill("cmux", {
      commandsDir,
      force: false,
    });

    expect(result.name).toBe("cmux");
    expect(result.installed).toBe(false);
    expect(result.skipped).toBe(true);
  });
});

// AIDEV-NOTE: Claude Code walks ~/.claude/commands/**/*.md recursively but reads
// ~/.claude/skills/<name>/SKILL.md one level deep. A backfill symlink in commands/
// therefore exposes every workflows/, references/ and evals/ file as a "skill".
// installSkill() must write skills/ only. See PR "XS-1 commands→skills".
describe("installSkill() legacy commands/ backfill", () => {
  test("does not write into $HOME/.claude/commands", async () => {
    const home = await mkdtemp(join(tmpdir(), "golem-skills-home-"));
    const runner = join(home, "run-install.ts");
    const installModule = join(import.meta.dir, "..", "install.ts");

    await writeFile(
      runner,
      `
const files = [{ path: "SKILL.md", content: "# cmux skill" }];
globalThis.fetch = (async (url) => {
  const u = String(url);
  if (u.includes("contents/skills/golem-powers/cmux") && !u.includes("raw.githubusercontent")) {
    return new Response(
      JSON.stringify(
        files.map((f) => ({
          name: f.path,
          type: "file",
          path: "skills/golem-powers/cmux/" + f.path,
          download_url: "https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux/" + f.path,
          url: "",
        })),
      ),
      { status: 200 },
    );
  }
  const hit = files.find((f) => u.includes(f.path));
  return hit ? new Response(hit.content, { status: 200 }) : new Response("Not Found", { status: 404 });
});
const { installSkill } = await import(${JSON.stringify(installModule)});
await installSkill("cmux", { commandsDir: process.env.TARGET_DIR });
`,
      "utf8",
    );

    const target = join(home, ".claude", "skills");
    const proc = Bun.spawn(["bun", runner], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: home, TARGET_DIR: target },
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    try {
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(
        await readFile(join(target, "cmux", "SKILL.md"), "utf8"),
      ).toBe("# cmux skill");
      expect(existsSync(join(home, ".claude", "commands"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
