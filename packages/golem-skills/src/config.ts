import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** Returns the platform-appropriate CLI lookup command. */
export function getWhichCommand(): string {
  return process.platform === "win32" ? "where" : "which";
}

/** Checks whether Claude Desktop app is installed (macOS .app or Windows exe). */
export async function detectClaudeDesktop(): Promise<boolean> {
  if (process.platform === "darwin") {
    try {
      await access("/Applications/Claude.app");
      return true;
    } catch {
      return false;
    }
  }
  if (process.platform === "win32") {
    try {
      const appPath = join(
        homedir(),
        "AppData",
        "Local",
        "Programs",
        "Claude",
        "Claude.exe",
      );
      await access(appPath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export interface GolemConfig {
  reposPath?: string;
  tools?: Record<string, string>;
}

export const DEFAULT_CONFIG_PATH = join(homedir(), ".golems", "config.json");

export async function loadConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<GolemConfig | null> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as GolemConfig;
  } catch {
    return null;
  }
}

export async function createDefaultConfig(
  configPath: string,
  defaults: GolemConfig,
): Promise<void> {
  try {
    await access(configPath);
    return; // already exists
  } catch {
    // create it
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(defaults, null, 2) + "\n");
}

export async function autoDetectTools(): Promise<Record<string, string>> {
  const tools: Record<string, string> = {};
  const candidates: Record<string, string[]> = {
    claude: ["claude"],
    gemini: ["gemini"],
    cursor: ["cursor"],
    codex: ["codex"],
    "kiro-cli": ["kiro-cli"],
    windsurf: ["windsurf"],
    aider: ["aider"],
    copilot: ["github-copilot-cli"],
    cline: ["cline"],
  };

  for (const [key, names] of Object.entries(candidates)) {
    for (const name of names) {
      const proc = Bun.spawnSync([getWhichCommand(), name]);
      if (proc.exitCode === 0) {
        // `where` on Windows may return multiple lines; take the first match
        const firstHit = proc.stdout
          .toString()
          .split("\n")
          .map((l) => l.trim())
          .find(Boolean);
        if (firstHit) tools[key] = firstHit;
        break;
      }
    }
  }

  return tools;
}
