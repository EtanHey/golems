import {
  mkdir,
  writeFile,
  chmod,
  lstat,
  realpath,
  readlink,
} from "node:fs/promises";
import { basename, join, dirname, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { getSkillFiles, downloadFile, validateSkillName } from "./github";

export interface InstallOptions {
  commandsDir?: string;
  force?: boolean;
}

export interface InstallResult {
  name: string;
  installed: boolean;
  skipped: boolean;
  source: "github" | "local";
  filesWritten: number;
  error?: string;
}

// AIDEV-NOTE: ~/.claude/skills/ is the ONLY install target. Claude Code reads
// ~/.claude/skills/<name>/SKILL.md one level deep, but walks ~/.claude/commands/**/*.md
// recursively — a symlink there exposes every workflows/, references/ and evals/ file
// as a listed "skill", blowing the 40k-char skill-listing budget.
export const DEFAULT_SKILLS_DIR = join(homedir(), ".claude", "skills");
// Re-export for backward compatibility — existing code imports DEFAULT_COMMANDS_DIR
export const DEFAULT_COMMANDS_DIR = DEFAULT_SKILLS_DIR;

async function installedSource(
  skillDir: string,
): Promise<"github" | "local" | undefined> {
  try {
    return (await lstat(skillDir)).isSymbolicLink() ? "local" : "github";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function resolvePathForWrite(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        const linkTarget = resolve(dirname(path), await readlink(path));
        return resolvePathForWrite(linkTarget);
      }
    } catch (lstatError) {
      if ((lstatError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw lstatError;
      }
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await resolvePathForWrite(parent), basename(path));
  }
}

async function assertWriteContained(
  resolvedSkillsDir: string,
  destinationPath: string,
): Promise<void> {
  const resolvedDestination = await resolvePathForWrite(destinationPath);
  const relativeDestination = relative(
    resolvedSkillsDir,
    resolvedDestination,
  );
  if (
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${sep}`)
  ) {
    throw new Error(
      `Refusing to install outside resolved skills root ${resolvedSkillsDir}: ${resolvedDestination}`,
    );
  }
}

export async function installSkill(
  name: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const skillsDir = options.commandsDir ?? DEFAULT_SKILLS_DIR;
  const force = options.force ?? false;
  validateSkillName(name);
  const skillDir = join(skillsDir, name);
  const existingSource = await installedSource(skillDir);

  if (!force && existingSource) {
    return {
      name,
      installed: false,
      skipped: true,
      source: existingSource,
      filesWritten: 0,
    };
  }

  await mkdir(skillsDir, { recursive: true });
  const resolvedSkillsDir = await realpath(skillsDir);
  await assertWriteContained(resolvedSkillsDir, skillDir);

  const files = await getSkillFiles(name);
  let filesWritten = 0;

  for (const file of files) {
    const relPath = file.path.replace(`skills/golem-powers/${name}/`, "");
    const destPath = join(skillDir, relPath);
    await assertWriteContained(resolvedSkillsDir, destPath);
    await mkdir(dirname(destPath), { recursive: true });
    const content = await downloadFile(file.download_url);
    await writeFile(destPath, content, "utf8");

    // Make shell scripts executable
    if (relPath.endsWith(".sh")) {
      await chmod(destPath, 0o755);
    }

    filesWritten++;
  }

  return {
    name,
    installed: true,
    skipped: false,
    source: "github",
    filesWritten,
  };
}

export async function installAllSkills(
  skillNames: string[],
  options: InstallOptions = {},
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  for (const name of skillNames) {
    try {
      results.push(await installSkill(name, options));
    } catch (error) {
      const skillsDir = options.commandsDir ?? DEFAULT_SKILLS_DIR;
      const source =
        (await installedSource(join(skillsDir, name)).catch(() => undefined)) ??
        "github";
      results.push({
        name,
        installed: false,
        skipped: false,
        source,
        filesWritten: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
