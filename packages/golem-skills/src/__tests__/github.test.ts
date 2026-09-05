import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { listSkills, getSkillFiles, downloadFile } from "../github";

describe("github client", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("listSkills()", () => {
    const treeResponse = (
      tree: { path: string; type: string }[],
      truncated = false,
    ) =>
      new Response(JSON.stringify({ sha: "t", truncated, tree }), {
        status: 200,
      });

    test("returns only directories carrying a top-level SKILL.md", async () => {
      global.fetch = mock(async () =>
        treeResponse([
          { path: "cmux-agents", type: "tree" },
          { path: "cmux-agents/SKILL.md", type: "blob" },
          { path: "pr-loop", type: "tree" },
          { path: "pr-loop/SKILL.md", type: "blob" },
          { path: "pr-loop/scripts", type: "tree" },
          { path: "pr-loop/scripts/run.sh", type: "blob" },
          // a helper directory with no SKILL.md of its own
          { path: "pr-loop-workspace", type: "tree" },
          { path: "pr-loop-workspace/notes.md", type: "blob" },
          // a nested SKILL.md must not register its parent chain
          { path: "cmux-agents/sub/SKILL.md", type: "blob" },
          { path: "README.md", type: "blob" },
        ]),
      ) as typeof fetch;

      const skills = await listSkills();
      expect(skills).toEqual(["cmux-agents", "pr-loop"]);
    });

    test("excludes dot- and underscore-prefixed directories", async () => {
      global.fetch = mock(async () =>
        treeResponse([
          { path: "_archive", type: "tree" },
          { path: "_archive/SKILL.md", type: "blob" },
          { path: ".hidden", type: "tree" },
          { path: ".hidden/SKILL.md", type: "blob" },
          { path: "cmux", type: "tree" },
          { path: "cmux/SKILL.md", type: "blob" },
        ]),
      ) as typeof fetch;

      const skills = await listSkills();
      expect(skills).toEqual(["cmux"]);
    });

    test("throws on non-200 response", async () => {
      global.fetch = mock(
        async () => new Response("Not Found", { status: 404 }),
      ) as typeof fetch;

      await expect(listSkills()).rejects.toThrow("GitHub API error: 404");
    });

    test("throws rather than report a truncated skill set", async () => {
      global.fetch = mock(async () =>
        treeResponse([{ path: "cmux/SKILL.md", type: "blob" }], true),
      ) as typeof fetch;

      await expect(listSkills()).rejects.toThrow("truncated");
    });

    test("reads the skills tree in a single request", async () => {
      const calledUrls: string[] = [];
      global.fetch = mock(async (url: string | URL | Request) => {
        calledUrls.push(typeof url === "string" ? url : url.toString());
        return treeResponse([]);
      }) as typeof fetch;

      await listSkills();
      expect(calledUrls).toEqual([
        "https://api.github.com/repos/EtanHey/golems/git/trees/HEAD:skills%2Fgolem-powers?recursive=1",
      ]);
    });
  });

  describe("getSkillFiles()", () => {
    test("returns flat list of files for a skill", async () => {
      global.fetch = mock(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("golem-powers/cmux") && !u.includes("scripts")) {
          return new Response(
            JSON.stringify([
              {
                name: "SKILL.md",
                type: "file",
                path: "skills/golem-powers/cmux/SKILL.md",
                download_url: "https://raw.githubusercontent.com/.../SKILL.md",
              },
              {
                name: "scripts",
                type: "dir",
                path: "skills/golem-powers/cmux/scripts",
                url: "https://api.github.com/repos/EtanHey/golems/contents/skills/golem-powers/cmux/scripts",
              },
            ]),
            { status: 200 },
          );
        }
        if (u.includes("scripts")) {
          return new Response(
            JSON.stringify([
              {
                name: "run.sh",
                type: "file",
                path: "skills/golem-powers/cmux/scripts/run.sh",
                download_url: "https://raw.githubusercontent.com/.../run.sh",
              },
            ]),
            { status: 200 },
          );
        }
        return new Response("[]", { status: 200 });
      }) as typeof fetch;

      const files = await getSkillFiles("cmux");
      expect(files.map((f) => f.name)).toContain("SKILL.md");
      expect(files.map((f) => f.name)).toContain("run.sh");
    });
  });

  describe("downloadFile()", () => {
    test("returns file content as string", async () => {
      const content = "# My Skill\nHello world";
      global.fetch = mock(
        async () => new Response(content, { status: 200 }),
      ) as typeof fetch;

      const result = await downloadFile(
        "https://raw.githubusercontent.com/...",
      );
      expect(result).toBe(content);
    });

    test("throws on download failure", async () => {
      global.fetch = mock(
        async () => new Response("Server Error", { status: 500 }),
      ) as typeof fetch;

      await expect(
        downloadFile("https://raw.githubusercontent.com/..."),
      ).rejects.toThrow("Failed to download file: 500");
    });
  });
});
