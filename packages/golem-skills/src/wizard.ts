import { writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import {
  loadConfig,
  autoDetectTools,
  detectClaudeDesktop,
  DEFAULT_CONFIG_PATH,
  type GolemConfig,
} from "./config";
import {
  installSkill,
  installAllSkills,
  DEFAULT_COMMANDS_DIR,
} from "./install";
import { listRemoteSkills } from "./list";
import { SKILL_MCP_MAP, getConfiguredMcps, recommendMcps } from "./mcp-map";

// --- Execution mode detection (Task 4) ---

export type ExecutionMode = "cli" | "skill";

/** Detect if running as a Claude Code skill (CLAUDE_CODE env) vs CLI. */
export function detectExecutionMode(): ExecutionMode {
  return process.env.CLAUDE_CODE ? "skill" : "cli";
}

// Re-export for backward compat (tests import from wizard)
export { SKILL_MCP_MAP, recommendMcps } from "./mcp-map";

// --- Fallback skill categories (Task 5) ---

const FALLBACK_SKILL_CATEGORIES: Record<string, string[]> = {
  Development: [
    "commit",
    "github",
    "pr-loop",
    "test-plan",
    "coderabbit",
    "simplify",
  ],
  Research: ["research", "youtube-pipeline", "call-debrief"],
  Operations: ["coach", "catchup", "ecosystem-health", "orchestrator-status"],
  Infrastructure: ["1password", "railway", "convex", "vercel"],
  Voice: ["voice-sessions"],
  Content: ["video-showcase", "presentation-builder"],
};

/** Tries remote registry, falls back to static list. Adds "Other" for uncategorized. */
export async function getSkillCategories(): Promise<Record<string, string[]>> {
  try {
    const remoteSkills = await listRemoteSkills();
    if (remoteSkills.length === 0) return { ...FALLBACK_SKILL_CATEGORIES };

    const categorized = new Set<string>();
    for (const skills of Object.values(FALLBACK_SKILL_CATEGORIES)) {
      for (const s of skills) categorized.add(s);
    }

    const other = remoteSkills.filter((s) => !categorized.has(s));
    const result = { ...FALLBACK_SKILL_CATEGORIES };
    if (other.length > 0) result.Other = other;
    return result;
  } catch {
    return { ...FALLBACK_SKILL_CATEGORIES };
  }
}

async function runMcpRecommendationStep(): Promise<void> {
  let installedSkills: string[];
  try {
    const entries = await readdir(DEFAULT_COMMANDS_DIR, {
      withFileTypes: true,
    });
    installedSkills = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    installedSkills = [];
  }

  if (installedSkills.length === 0) return;

  const configuredMcps = await getConfiguredMcps();
  const recs = recommendMcps(installedSkills, configuredMcps);

  if (recs.length === 0) {
    console.log("MCP servers: all recommended MCPs are already configured.\n");
    return;
  }

  console.log("Recommended MCP servers for your installed skills:\n");
  const required = recs.filter((r) => r.type === "required");
  const complement = recs.filter((r) => r.type === "complement");

  if (required.length > 0) {
    console.log("  Required:");
    for (const r of required) {
      console.log(`    - ${r.mcp} (needed by ${r.skill})`);
    }
  }
  if (complement.length > 0) {
    console.log("  Optional:");
    for (const r of complement) {
      console.log(`    - ${r.mcp} (enhances ${r.skill})`);
    }
  }
  console.log(
    "\nConfigure MCPs in ~/.claude/.mcp.json or via: npx golems-cli mcp\n",
  );
}

// --- Claude Code helpers (Task 8) ---

function hasClaudeCode(tools: Record<string, string>): boolean {
  return !!tools.claude;
}

function getClaudeCodeInstallInstructions(): string {
  const lines = [
    "Claude Code CLI is required for golem skills.",
    "Skills are SKILL.md files in ~/.claude/skills/ — they only work with Claude Code.",
    "",
    "To install Claude Code:",
  ];
  if (process.platform === "darwin") {
    lines.push("  brew install claude          # macOS (recommended)");
    lines.push("  npm install -g @anthropic-ai/claude-code  # alternative");
  } else if (process.platform === "win32") {
    lines.push("  npm install -g @anthropic-ai/claude-code  # Windows");
    lines.push("  # WSL recommended: install inside WSL for best experience");
  } else {
    lines.push("  npm install -g @anthropic-ai/claude-code  # Linux");
  }
  lines.push("", "Then run this wizard again.");
  return lines.join("\n");
}

const FEATURES = ["proactiveNudges", "nightShift", "telegram"] as const;

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  proactiveNudges: "Coach sends periodic check-ins and reminders",
  nightShift: "Autonomous improvement loop runs at 3am",
  telegram: "Receive notifications via Telegram bot",
};

function ask(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function countInstalledSkills(): Promise<number> {
  try {
    const entries = await readdir(DEFAULT_COMMANDS_DIR);
    return entries.length;
  } catch {
    return 0;
  }
}

// SKILL_CATEGORIES kept as alias for backward compat (tests reference it)
const SKILL_CATEGORIES: Record<string, string[]> = FALLBACK_SKILL_CATEGORIES;

async function listInstalledSkillNames(): Promise<Set<string>> {
  try {
    const entries = await readdir(DEFAULT_COMMANDS_DIR);
    return new Set(entries);
  } catch {
    return new Set();
  }
}

async function installSkillsInteractive(): Promise<void> {
  const installChoice = await ask(
    "Install skills?\n  (a)ll — install all skills\n  (r)ecommended — install popular skills\n  (b)rowse — browse by category\n  (s)kip — install later\nChoice [s]: ",
  );

  const recommended = ["commit", "coach", "github", "catchup", "research"];
  const failedInstalls: string[] = [];

  if (
    installChoice.toLowerCase() === "a" ||
    installChoice.toLowerCase() === "all"
  ) {
    console.log("\nInstalling all skills...");
    try {
      const allSkillNames = await listRemoteSkills();
      const results = await installAllSkills(allSkillNames);
      const failures = results.filter((result) => result.error);
      for (const failure of failures) {
        console.error(`  ${failure.name}: failed (${failure.error})`);
        failedInstalls.push(failure.name);
      }
      console.log(
        failures.length === 0
          ? "All skills installed."
          : `Skill install finished with ${failures.length} failure(s).`,
      );
    } catch (err) {
      console.error(`Failed to install all skills: ${(err as Error).message}`);
      failedInstalls.push("all");
    }
  } else if (
    installChoice.toLowerCase() === "r" ||
    installChoice.toLowerCase() === "recommended"
  ) {
    console.log("\nInstalling recommended skills...");
    for (const skill of recommended) {
      try {
        const result = await installSkill(skill);
        if (result?.skipped) {
          console.log(`  ${skill}: already installed (skipping)`);
        } else {
          console.log(`  ${skill}: installed`);
        }
      } catch (err) {
        console.error(`  ${skill}: failed (${(err as Error).message})`);
        failedInstalls.push(skill);
      }
    }
  } else if (
    installChoice.toLowerCase() === "b" ||
    installChoice.toLowerCase() === "browse"
  ) {
    const installed = await listInstalledSkillNames();
    const categories = await getSkillCategories();
    console.log("\nAvailable skills by category:\n");
    for (const [category, skills] of Object.entries(categories)) {
      console.log(`  ${category}:`);
      for (const skill of skills) {
        const status = installed.has(skill) ? " [installed]" : "";
        console.log(`    - ${skill}${status}`);
      }
    }
    console.log();
    const picks = await ask(
      "Enter skill names to install (comma-separated), or press Enter to skip: ",
    );
    if (picks) {
      for (const name of picks
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        try {
          const result = await installSkill(name);
          if (result?.skipped) {
            console.log(`  ${name}: already installed (skipping)`);
          } else {
            console.log(`  ${name}: installed`);
          }
        } catch (err) {
          console.error(`  ${name}: failed (${(err as Error).message})`);
          failedInstalls.push(name);
        }
      }
    }
  } else {
    console.log(
      "\nSkipping skill installation. Install later with: npx golems-cli skills install <name>",
    );
  }

  if (failedInstalls.length > 0) {
    console.log(
      `\nNote: ${failedInstalls.length} skill(s) failed to install: ${failedInstalls.join(", ")}`,
    );
    console.log("Retry with: npx golems-cli skills install <name>");
  }
}

export async function runWizard(): Promise<void> {
  // Skill mode: emit guidance and exit (no interactive prompts)
  if (detectExecutionMode() === "skill") {
    console.log(
      "Running as a Claude Code skill. Use the CLI for interactive setup:\n  npx golems-cli wizard",
    );
    return;
  }

  console.log("=== Golems Setup Wizard ===\n");

  // Step 1: Check existing config
  const existingConfig = await loadConfig();
  if (existingConfig) {
    console.log("Existing configuration found at ~/.golems/config.json:\n");
    console.log(JSON.stringify(existingConfig, null, 2));
    console.log();

    const choice = await ask(
      "Would you like to (r)econfigure, (a)dd skills, or (s)kip? [s]: ",
    );
    if (
      choice.toLowerCase() === "a" ||
      choice.toLowerCase() === "add" ||
      choice.toLowerCase() === "add skills"
    ) {
      // Always re-detect tools live (config may be stale)
      const detectedTools = await autoDetectTools();
      if (!hasClaudeCode(detectedTools)) {
        console.log(
          "\nClaude Code CLI is required to install skills.\n" +
            getClaudeCodeInstallInstructions(),
        );
        return;
      }
      await installSkillsInteractive();
      await runMcpRecommendationStep();
      return;
    }
    if (
      choice.toLowerCase() !== "r" &&
      choice.toLowerCase() !== "reconfigure"
    ) {
      console.log("Keeping current configuration. Wizard complete.");
      return;
    }
    console.log();
  }

  // Step 2: Detect platform and CLIs
  const platform = process.platform;
  console.log(`Platform: ${platform}\n`);
  console.log("Detecting installed AI CLIs...\n");
  const tools = await autoDetectTools();
  const toolCount = Object.keys(tools).length;

  const allClis = [
    "claude",
    "cursor",
    "gemini",
    "codex",
    "kiro-cli",
    "windsurf",
    "aider",
    "copilot",
    "cline",
  ];
  for (const cli of allClis) {
    const path = tools[cli];
    console.log(`  ${cli.padEnd(10)}: ${path || "not found"}`);
  }
  console.log(`\nFound ${toolCount} of ${allClis.length} supported CLIs.\n`);

  // Claude Desktop detection
  const hasDesktop = await detectClaudeDesktop();
  if (hasDesktop && !tools.claude) {
    console.log(
      "Claude Desktop detected but Claude Code CLI not found.\n" +
        "Skills require the CLI, not just the Desktop app.\n",
    );
  }

  // Claude Code gate — skills require Claude Code
  if (!tools.claude) {
    console.log(getClaudeCodeInstallInstructions());

    const proceed = await ask(
      "\nWould you like to continue setup anyway (config only, no skills)? [n]: ",
    );
    if (proceed.toLowerCase() !== "y" && proceed.toLowerCase() !== "yes") {
      console.log("Install Claude Code first, then re-run the wizard.");
      return;
    }
    console.log(
      "\nContinuing with config-only setup (skills will not be available until Claude Code is installed).\n",
    );
  }

  // Step 3: Ask workspace root
  let reposPath = "";
  while (!reposPath) {
    const input = await ask(
      "Where is your workspace root? (e.g., ~/Gits, ~/Projects): ",
    );
    if (!input) {
      console.log("Workspace root is required.\n");
      continue;
    }

    const expanded = input.replace(/^~/, homedir());
    if (await isDirectory(expanded)) {
      reposPath = input;
    } else {
      console.log(
        `Path "${input}" does not exist or is not a directory. Please provide a valid directory.\n`,
      );
    }
  }
  console.log();

  // Step 4: Ask about opt-in features
  console.log("Opt-in features (all OFF by default):\n");
  for (let i = 0; i < FEATURES.length; i++) {
    const name = FEATURES[i];
    console.log(`  ${i + 1}. ${name} — ${FEATURE_DESCRIPTIONS[name]} — OFF`);
  }
  console.log();

  const featureInput = await ask(
    "Enter numbers to enable (e.g., '1,3') or press Enter to keep all OFF: ",
  );

  const enabledFeatures = new Set<string>();
  if (featureInput) {
    for (const part of featureInput.split(",")) {
      const idx = parseInt(part.trim(), 10);
      if (idx >= 1 && idx <= FEATURES.length) {
        enabledFeatures.add(FEATURES[idx - 1]);
      }
    }
  }

  const features: Record<string, boolean> = {};
  for (const f of FEATURES) {
    features[f] = enabledFeatures.has(f);
  }
  console.log();

  // Step 5: Write config
  const config: GolemConfig & { features?: Record<string, boolean> } = {
    reposPath,
    tools,
    features,
  };

  const configDir = join(homedir(), ".golems");
  await mkdir(configDir, { recursive: true });
  await writeFile(DEFAULT_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");

  console.log("Config written to ~/.golems/config.json:\n");
  console.log(JSON.stringify(config, null, 2));
  console.log();

  // Step 6: Install skills
  if (tools.claude) {
    await installSkillsInteractive();
  } else {
    console.log(
      "Skipping skill installation (Claude Code not detected).\n" +
        "Install Claude Code first, then run: npx golems-cli skills install <name>\n",
    );
  }

  // Step 7: MCP recommendations
  if (tools.claude) {
    await runMcpRecommendationStep();
  }

  // Summary
  const skillCount = await countInstalledSkills();
  const enabledList = Object.entries(features)
    .map(([k, v]) => `${k}: ${v ? "ON" : "OFF"}`)
    .join(", ");
  const toolNames = Object.keys(tools).join(", ") || "none";

  console.log("=== Golems Setup Complete ===\n");
  console.log(`Config:     ~/.golems/config.json`);
  console.log(`Workspace:  ${reposPath}`);
  console.log(`Tools:      ${toolNames} (${toolCount} detected)`);
  console.log(`Features:   ${enabledList}`);
  console.log(`Skills:     ${skillCount} installed`);
  console.log();
  console.log("Next steps:");
  console.log("  - Run /wizard again to reconfigure");
  console.log("  - Install more skills: npx golems-cli skills install <name>");
  console.log("  - List available skills: npx golems-cli skills list");
}
