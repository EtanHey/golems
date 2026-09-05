import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  loadConfig,
  autoDetectTools,
  DEFAULT_CONFIG_PATH,
  type GolemConfig,
} from "./config";
import { listInstalledSkillEntries } from "./list";
import { installAllSkills, DEFAULT_COMMANDS_DIR } from "./install";
import {
  SKILL_MCP_MAP,
  getConfiguredMcps,
  recommendMcps as sharedRecommendMcps,
} from "./mcp-map";

// Re-export for backward compat
export { SKILL_MCP_MAP };

/** Check for MCP recommendations based on installed skills (update-specific wrapper). */
export async function recommendMcps(
  installedSkills: Set<string>,
  reposPath: string,
): Promise<string[]> {
  const configured = await getConfiguredMcps(reposPath);
  const recs = sharedRecommendMcps(installedSkills, configured);
  return [...new Set(recs.map((r) => r.mcp))];
}

export interface UpdateOptions {
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
  configPath?: string;
  commandsDir?: string;
}

export interface ToolsDiff {
  added: string[];
  removed: string[];
  pathChanged: string[];
}

export interface ConfigMigration {
  config: FullConfig;
  changes: string[];
}

export interface UpdateResult {
  toolsDiff: ToolsDiff;
  configMigration: ConfigMigration;
  skillsUpdated: number;
  skillsSkippedLocal: number;
  mcpRecommendations: string[];
}

/** Full config shape including features (superset of GolemConfig) */
export interface FullConfig extends GolemConfig {
  features?: Record<string, boolean>;
}

const EXPECTED_FEATURES = [
  "proactiveNudges",
  "nightShift",
  "telegram",
] as const;

// --- Pure functions (testable) ---

/**
 * Compare current tools in config with freshly detected tools.
 * Returns the diff: added, removed, path-changed.
 */
export function diffTools(
  current: Record<string, string>,
  detected: Record<string, string>,
): ToolsDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const pathChanged: string[] = [];

  // Check for new or changed tools
  for (const [name, path] of Object.entries(detected)) {
    if (!(name in current)) {
      added.push(name);
    } else if (current[name] !== path) {
      pathChanged.push(name);
    }
  }

  // Check for removed tools
  for (const name of Object.keys(current)) {
    if (!(name in detected)) {
      removed.push(name);
    }
  }

  return { added, removed, pathChanged };
}

/**
 * Migrate config to latest schema. Adds missing fields with defaults.
 * Never removes user values — only adds what's missing.
 */
export function migrateConfig(config: FullConfig): ConfigMigration {
  const changes: string[] = [];
  const migrated = { ...config };

  // Ensure features field exists
  if (!migrated.features) {
    migrated.features = {};
    changes.push("Added missing field: features");
  }

  // Ensure all expected features exist (default to false)
  for (const feature of EXPECTED_FEATURES) {
    if (!(feature in migrated.features)) {
      migrated.features[feature] = false;
      if (!changes.includes("Added missing field: features")) {
        changes.push(`Added missing feature: ${feature}`);
      }
    }
  }

  return { config: migrated, changes };
}

// --- I/O functions ---

export function printUpdateHelp(): void {
  console.log(`golems-cli update — Re-sync CLIs, config, skills, and MCP recommendations

Usage: golems-cli update [options]

Idempotent. Safe to run anytime — checks what changed and updates accordingly.

Steps:
  1. Re-detect installed AI CLIs
  2. Migrate config schema (add new fields from newer versions)
  3. Update installed skills (re-download latest from GitHub)
  4. Check MCP recommendations for installed skills
  5. Show summary of changes

Options:
  --yes, -y      Auto-accept all prompts (for cron/automation)
  --dry-run      Show what would change without changing anything
  --verbose      Show detailed diffs of config changes
  --help, -h     Show this help`);
}

/**
 * Main update command. Orchestrates all 5 steps.
 */
export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const commandsDir = options.commandsDir ?? DEFAULT_COMMANDS_DIR;
  const { dryRun, verbose } = options;

  // Load existing config — require it exists
  const config = await loadConfig(configPath);
  if (!config) {
    console.error("No config found. Run 'golems-cli wizard' first to set up.");
    process.exit(1);
  }

  if (dryRun) {
    console.log("=== Golems Update (dry-run) ===\n");
  } else {
    console.log("=== Golems Update ===\n");
  }

  // Step 1: Re-detect CLIs
  console.log("Step 1: Detecting installed AI CLIs...");
  const currentTools = config.tools ?? {};
  const detectedTools = await autoDetectTools();
  const toolsDiff = diffTools(currentTools, detectedTools);

  const hasToolChanges =
    toolsDiff.added.length > 0 ||
    toolsDiff.removed.length > 0 ||
    toolsDiff.pathChanged.length > 0;

  if (hasToolChanges) {
    if (toolsDiff.added.length > 0) {
      console.log(`  New CLIs found: ${toolsDiff.added.join(", ")}`);
    }
    if (toolsDiff.removed.length > 0) {
      console.log(`  CLIs no longer found: ${toolsDiff.removed.join(", ")}`);
    }
    if (toolsDiff.pathChanged.length > 0 && verbose) {
      for (const name of toolsDiff.pathChanged) {
        console.log(
          `  ${name}: ${currentTools[name]} → ${detectedTools[name]}`,
        );
      }
    } else if (toolsDiff.pathChanged.length > 0) {
      console.log(`  Path changes: ${toolsDiff.pathChanged.join(", ")}`);
    }
  } else {
    console.log("  No changes detected.");
  }

  // Step 2: Config schema migration
  console.log("\nStep 2: Checking config schema...");
  const fullConfig = config as FullConfig;
  const migration = migrateConfig(fullConfig);

  if (migration.changes.length > 0) {
    for (const change of migration.changes) {
      console.log(`  ${change}`);
    }
  } else {
    console.log("  Config schema up to date.");
  }

  // Apply tool + schema changes to config (unless dry-run)
  if (!dryRun && (hasToolChanges || migration.changes.length > 0)) {
    const updatedConfig = { ...migration.config, tools: detectedTools };
    await writeFile(configPath, JSON.stringify(updatedConfig, null, 2) + "\n");
    console.log("  Config updated.");
  }

  // Step 3: Update installed skills
  console.log("\nStep 3: Updating installed skills...");
  const installedEntries = await listInstalledSkillEntries(commandsDir);
  const installed = installedEntries.map((entry) => entry.name);
  const updateable = installedEntries.filter(
    (entry) => entry.source === "github",
  );
  const local = installedEntries.filter((entry) => entry.source === "local");
  let skillsUpdated = 0;
  const skillsSkippedLocal = local.length;

  if (installedEntries.length === 0) {
    console.log("  No skills installed. Skipping.");
  } else if (dryRun) {
    for (const entry of updateable) {
      console.log(`  ${entry.name}: would-update`);
    }
    for (const entry of local) {
      console.log(`  ${entry.name}: skipped-local`);
    }
    console.log(
      `  Would update ${updateable.length} skills; skip ${local.length} local (dry-run).`,
    );
    skillsUpdated = updateable.length;
  } else {
    const results = await installAllSkills(
      updateable.map((entry) => entry.name),
      {
        commandsDir,
        force: true,
      },
    );
    skillsUpdated = results.filter((r) => r.installed).length;
    for (const result of results) {
      const status = result.error
        ? `failed (${result.error})`
        : result.installed
          ? "updated"
          : "skipped";
      console.log(`  ${result.name}: ${status}`);
    }
    for (const entry of local) {
      console.log(`  ${entry.name}: skipped-local`);
    }
    const failed = results.filter((result) => result.error).length;
    console.log(
      `  Updated ${skillsUpdated} skills; skipped ${skillsSkippedLocal} local.`,
    );
    if (failed > 0) console.log(`  Failed ${failed} skills.`);
  }

  // Step 4: MCP recommendations
  console.log("\nStep 4: Checking MCP recommendations...");
  const reposPath = config.reposPath ?? "~";
  const installedSet = new Set(installed);
  const mcpRecommendations = await recommendMcps(installedSet, reposPath);

  if (mcpRecommendations.length > 0) {
    console.log("  Recommended MCPs not yet configured:");
    for (const mcp of mcpRecommendations) {
      // Find which skills need this MCP
      const skills: string[] = [];
      for (const skill of installed) {
        const mapping = SKILL_MCP_MAP[skill];
        if (!mapping) continue;
        if (
          mapping.required.includes(mcp) ||
          mapping.complement.includes(mcp)
        ) {
          skills.push(skill);
        }
      }
      const usedBy =
        skills.length > 0 ? ` (used by: ${skills.join(", ")})` : "";
      console.log(`    - ${mcp}${usedBy}`);
    }
  } else {
    console.log("  All recommended MCPs configured.");
  }

  // Step 5: Summary
  const result: UpdateResult = {
    toolsDiff,
    configMigration: migration,
    skillsUpdated,
    skillsSkippedLocal,
    mcpRecommendations,
  };

  console.log("\n=== Summary ===");
  const totalChanges =
    toolsDiff.added.length +
    toolsDiff.removed.length +
    toolsDiff.pathChanged.length +
    migration.changes.length;

  if (
    totalChanges === 0 &&
    skillsUpdated === 0 &&
    mcpRecommendations.length === 0
  ) {
    console.log("Everything is up to date.");
  } else {
    if (hasToolChanges) {
      console.log(
        `  Tools: +${toolsDiff.added.length} added, -${toolsDiff.removed.length} removed, ~${toolsDiff.pathChanged.length} changed`,
      );
    }
    if (migration.changes.length > 0) {
      console.log(`  Config: ${migration.changes.length} schema migration(s)`);
    }
    if (skillsUpdated > 0) {
      console.log(`  Skills: ${skillsUpdated} updated`);
    }
    if (skillsSkippedLocal > 0) {
      console.log(`  Skills: ${skillsSkippedLocal} skipped-local`);
    }
    if (mcpRecommendations.length > 0) {
      console.log(
        `  MCPs: ${mcpRecommendations.length} recommendation(s) — run 'golems-cli mcp install <name>'`,
      );
    }
    if (dryRun) {
      console.log("\n  (dry-run — no changes were applied)");
    }
  }

  return result;
}
