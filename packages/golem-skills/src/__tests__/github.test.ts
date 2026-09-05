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
    test("returns array of skill names (directories only)", async () => {
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

      const skills = await listSkills();
      expect(skills).toEqual(["cmux-agents", "pr-loop"]);
    });

    test("throws on non-200 response", async () => {
      global.fetch = mock(
        async () => new Response("Not Found", { status: 404 }),
      ) as typeof fetch;

      await expect(listSkills()).rejects.toThrow("GitHub API error: 404");
    });

    test("calls the correct GitHub URL", async () => {
      let calledUrl = "";
      global.fetch = mock(async (url: string | URL | Request) => {
        calledUrl = typeof url === "string" ? url : url.toString();
        return new Response(JSON.stringify([]), { status: 200 });
      }) as typeof fetch;

      await listSkills();
      expect(calledUrl).toBe(
        "https://api.github.com/repos/EtanHey/golems/contents/skills/golem-powers",
      );
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
