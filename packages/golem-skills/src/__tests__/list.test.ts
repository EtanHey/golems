import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listInstalledSkillEntries,
  listInstalledSkills,
  listRemoteSkills,
} from "../list";

describe("list module", () => {
  let tmpDir: string;
  let commandsDir: string;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "golem-list-test-"));
    commandsDir = join(tmpDir, "commands");
    await mkdir(commandsDir, { recursive: true });
    originalFetch = global.fetch;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    global.fetch = originalFetch;
  });

  describe("listInstalledSkills()", () => {
    test("returns empty array when commands dir is empty", async () => {
      const skills = await listInstalledSkills(commandsDir);
      expect(skills).toEqual([]);
    });

    test("returns skill names for each subdirectory", async () => {
      await mkdir(join(commandsDir, "cmux"));
      await mkdir(join(commandsDir, "pr-loop"));
      await mkdir(join(commandsDir, "skill-creator"));

      const skills = await listInstalledSkills(commandsDir);
      expect(skills.sort()).toEqual(["cmux", "pr-loop", "skill-creator"]);
    });

    test("returns empty array when commands dir does not exist", async () => {
      const skills = await listInstalledSkills(join(tmpDir, "nonexistent"));
      expect(skills).toEqual([]);
    });

    test("classifies symlinked skill directories as local", async () => {
      const checkoutSkill = join(tmpDir, "checkout", "local-skill");
      await mkdir(join(commandsDir, "remote-skill"));
      await mkdir(checkoutSkill, { recursive: true });
      await symlink(checkoutSkill, join(commandsDir, "local-skill"));

      const entries = await listInstalledSkillEntries(commandsDir);

      expect(entries.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: "local-skill", source: "local" },
        { name: "remote-skill", source: "github" },
      ]);
    });
  });

  describe("listRemoteSkills()", () => {
    test("returns skill names from GitHub API", async () => {
      global.fetch = mock(
        async () =>
          new Response(
            JSON.stringify([
              {
                name: "cmux-agents",
                type: "dir",
                path: "skills/golem-powers/cmux-agents",
              },
              {
                name: "pr-loop",
                type: "dir",
                path: "skills/golem-powers/pr-loop",
              },
              {
                name: "README.md",
                type: "file",
                path: "skills/golem-powers/README.md",
              },
            ]),
            { status: 200 },
          ),
      ) as typeof fetch;

      const skills = await listRemoteSkills();
      expect(skills).toEqual(["cmux-agents", "pr-loop"]);
    });
  });
});
