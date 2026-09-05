import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { listSkills } from "../github";

// AIDEV-NOTE: parity gate for the visitor's first command. `golems-cli skills
// list` must report the same number the README quotes, and the README number is
// whatever scripts/check-skill-library.mjs counts. Both sides answer to one
// rule: a directory under skills/golem-powers carrying a top-level SKILL.md,
// with dot- and underscore-prefixed names excluded. This test drives the real
// GitHub client over a fake API backed by the real repo tree, so it fails the
// moment the two definitions drift apart again.

const repoRoot = resolve(import.meta.dir, "..", "..", "..", "..");
const SKILLS_PATH = "skills/golem-powers";

interface TreeEntry {
  path: string;
  type: "blob" | "tree";
}

function contentsPayload(relPath: string) {
  const abs = join(repoRoot, relPath);
  return readdirSync(abs).map((name) => {
    const isDir = statSync(join(abs, name)).isDirectory();
    return {
      name,
      type: isDir ? "dir" : "file",
      path: `${relPath}/${name}`,
      download_url: isDir ? null : `https://raw.example/${relPath}/${name}`,
      url: `https://api.github.com/repos/EtanHey/golems/contents/${relPath}/${name}`,
    };
  });
}

function treePayload(relPath: string) {
  const tree: TreeEntry[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const path = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) {
        tree.push({ path, type: "tree" });
        walk(full, path);
      } else {
        tree.push({ path, type: "blob" });
      }
    }
  };
  walk(join(repoRoot, relPath), "");
  return { sha: "fake-tree-sha", truncated: false, tree };
}

/** Skill names by the check-skill-library.mjs rule, computed from the repo. */
function skillsOnDisk(): string[] {
  const root = join(repoRoot, SKILLS_PATH);
  return readdirSync(root)
    .filter((name) => !name.startsWith(".") && !name.startsWith("_"))
    .filter((name) => statSync(join(root, name)).isDirectory())
    .filter((name) => {
      try {
        return statSync(join(root, name, "SKILL.md")).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** The number check-skill-library.mjs itself prints — the README's source. */
async function checkSkillLibraryCount(): Promise<number> {
  const proc = Bun.spawn(["node", "scripts/check-skill-library.mjs"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`check-skill-library.mjs failed (${exitCode}): ${stderr}`);
  }
  const match = stdout.match(/\bskills=(\d+)\b/);
  if (!match) {
    throw new Error(`could not parse skill count from: ${stdout}`);
  }
  return Number(match[1]);
}

describe("skills list / check-skill-library parity", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Fake GitHub, served from the real repo tree. Answers both the contents
    // API and the git trees API so the assertion is about the count, not about
    // which endpoint the client happens to use.
    global.fetch = mock(async (url: string | URL | Request) => {
      const raw = typeof url === "string" ? url : url.toString();
      const parsed = new URL(raw);
      const path = decodeURIComponent(parsed.pathname);

      const contents = path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
      if (contents) {
        return new Response(JSON.stringify(contentsPayload(contents[1])), {
          status: 200,
        });
      }

      const tree = path.match(/^\/repos\/[^/]+\/[^/]+\/git\/trees\/(.+)$/);
      if (tree) {
        const treeish = tree[1];
        const relPath = treeish.includes(":")
          ? treeish.slice(treeish.indexOf(":") + 1)
          : SKILLS_PATH;
        return new Response(JSON.stringify(treePayload(relPath)), {
          status: 200,
        });
      }

      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("listSkills() count equals the check-skill-library count", async () => {
    const expected = await checkSkillLibraryCount();
    const skills = await listSkills();
    expect(skills.length).toBe(expected);
  });

  test("listSkills() returns exactly the dirs carrying a top-level SKILL.md", async () => {
    const skills = await listSkills();
    expect([...skills].sort()).toEqual(skillsOnDisk());
  });

  test("listSkills() excludes non-skill directories", async () => {
    const skills = await listSkills();
    const onDisk = readdirSync(join(repoRoot, SKILLS_PATH));
    const nonSkills = onDisk.filter((name) => !skillsOnDisk().includes(name));

    // The repo carries these today: _archive, _shared, and *-workspace helper
    // dirs with no SKILL.md. Whatever they are, none may be listed.
    expect(nonSkills.length).toBeGreaterThan(0);
    for (const name of nonSkills) {
      expect(skills).not.toContain(name);
    }
  });
});
