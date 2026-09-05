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

const REPO = "EtanHey/golems";
const BASE = `https://api.github.com/repos/${REPO}/contents`;
const SKILLS_PATH = "skills/golem-powers";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function listSkills(): Promise<string[]> {
  const entries = await fetchJson<GithubEntry[]>(`${BASE}/${SKILLS_PATH}`);
  return entries.filter((e) => e.type === "dir").map((e) => e.name);
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
