export interface GithubFile {
  name: string;
  path: string;
  download_url: string;
}

interface GithubEntry {
  name: string;
  type: "file" | "dir";
  path: string;
  download_url: string | null;
  url: string;
}

interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
}

interface GithubTree {
  tree: GithubTreeEntry[];
  truncated: boolean;
}

const REPO = "EtanHey/golems";
const BASE = `https://api.github.com/repos/${REPO}/contents`;
const TREES = `https://api.github.com/repos/${REPO}/git/trees`;
const SKILLS_PATH = "skills/golem-powers";
const SKILL_MANIFEST = "SKILL.md";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<T>;
}

// AIDEV-NOTE: one definition of "a skill", shared with
// scripts/check-skill-library.mjs: a directory under skills/golem-powers that
// carries a top-level SKILL.md, with dot- and underscore-prefixed names
// excluded. Listing every directory instead counted _archive, _shared, and the
// *-workspace helper dirs, so `skills list` reported 95 where the README and
// check-skill-library.mjs both said 88.
// The recursive tree API answers this in ONE request; the contents API would
// need one call per directory to see whether a SKILL.md is there.
export async function listSkills(): Promise<string[]> {
  const tree = await fetchJson<GithubTree>(
    `${TREES}/HEAD:${encodeURIComponent(SKILLS_PATH)}?recursive=1`,
  );
  if (tree.truncated) {
    throw new Error(
      "GitHub returned a truncated tree for skills/golem-powers; refusing to list a partial skill set",
    );
  }
  const names = new Set<string>();
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const parts = entry.path.split("/");
    if (parts.length !== 2 || parts[1] !== SKILL_MANIFEST) continue;
    const name = parts[0];
    if (name.startsWith(".") || name.startsWith("_")) continue;
    names.add(name);
  }
  return [...names].sort();
}

async function collectFiles(url: string): Promise<GithubFile[]> {
  const entries = await fetchJson<GithubEntry[]>(url);
  const files: GithubFile[] = [];
  for (const entry of entries) {
    if (entry.type === "file" && entry.download_url) {
      files.push({
        name: entry.name,
        path: entry.path,
        download_url: entry.download_url,
      });
    } else if (entry.type === "dir") {
      const nested = await collectFiles(entry.url);
      files.push(...nested);
    }
  }
  return files;
}

export function validateSkillName(name: string): void {
  if (
    !name ||
    name !== name.trim() ||
    name.includes("/") ||
    name.includes("\\") ||
    name === "." ||
    name === ".."
  ) {
    throw new Error(`Invalid skill name: ${name}`);
  }
}

export async function getSkillFiles(skill: string): Promise<GithubFile[]> {
  validateSkillName(skill);
  return collectFiles(`${BASE}/${SKILLS_PATH}/${encodeURIComponent(skill)}`);
}

export async function downloadFile(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  return res.text();
}
