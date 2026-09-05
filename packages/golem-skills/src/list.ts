import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { listSkills } from "./github";
import { DEFAULT_COMMANDS_DIR } from "./install";

export interface InstalledSkillEntry {
  name: string;
  source: "github" | "local";
}

export async function listInstalledSkillEntries(
  commandsDir: string = DEFAULT_COMMANDS_DIR,
): Promise<InstalledSkillEntry[]> {
  try {
    const entries = await readdir(commandsDir);
    const skills: InstalledSkillEntry[] = [];
    for (const entry of entries) {
      const entryStat = await lstat(join(commandsDir, entry));
      if (entryStat.isSymbolicLink()) {
        skills.push({ name: entry, source: "local" });
      } else if (entryStat.isDirectory()) {
        skills.push({ name: entry, source: "github" });
      }
    }
    return skills;
  } catch {
    return [];
  }
}

export async function listInstalledSkills(
  commandsDir: string = DEFAULT_COMMANDS_DIR,
): Promise<string[]> {
  const entries = await listInstalledSkillEntries(commandsDir);
  return entries.map((entry) => entry.name);
}

export async function listRemoteSkills(): Promise<string[]> {
  return listSkills();
}
