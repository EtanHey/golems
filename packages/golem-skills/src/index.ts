#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  installSkill,
  installAllSkills,
  DEFAULT_COMMANDS_DIR,
} from "./install";
import {
  listInstalledSkillEntries,
  listInstalledSkills,
  listRemoteSkills,
} from "./list";
import { validateSkillName } from "./github";
import {
  loadConfig,
  createDefaultConfig,
  autoDetectTools,
  DEFAULT_CONFIG_PATH,
} from "./config";
import { runWizard } from "./wizard";
import { runUpdate, printUpdateHelp } from "./update";

const VERSION = "0.1.0";

// "update" excluded — it's now a top-level command
const SKILLS_SUBCOMMANDS = ["install", "list", "uninstall", "status"];

function printHelp() {
  console.log(`golems-cli v${VERSION} — The Golems ecosystem CLI

Usage: golems-cli <command> [options]

Commands:
  skills    Copy skill files to ~/.claude/skills/
  update    Re-sync CLIs, config, skills, and MCP recommendations
  mcp       Add MCP servers to .mcp.json + install deps (coming soon)
  agent     Composite install: skills + MCPs + CLAUDE.md + launcher (coming soon)
  wizard    Interactive setup wizard

Options:
  --version, -v  Show version
  --help, -h     Show help

Examples:
  golems-cli skills install commit
  golems-cli skills list
  golems-cli skills install --all`);
}

function printSkillsHelp() {
  console.log(`golems-cli skills — Install and manage golem-powers skills

Usage: golems-cli skills <command> [options]

Commands:
  install <skill>   Install a skill
  install --all     Install all available skills
  list              List available skills (remote)
  list --installed  List installed skills (local)
  update            Update all installed skills
  uninstall <skill> Remove a skill
  status            Show installed skills with counts

Options:
  --force          Overwrite existing installations
  --skills-dir     Override ~/.claude/skills/ path
                   (--commands-dir is a deprecated alias)`);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2); // skip bun + script
  const positional = args.filter((a) => !a.startsWith("-"));
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const namespace = positional[0];
  const subcommand = positional[1];

  let commandsDir = DEFAULT_COMMANDS_DIR;
  // --commands-dir is the deprecated alias; both point at ~/.claude/skills/
  for (const flag of ["--skills-dir", "--commands-dir"]) {
    const dirIdx = args.indexOf(flag);
    if (dirIdx !== -1 && args[dirIdx + 1]) {
      commandsDir = args[dirIdx + 1];
      break;
    }
  }

  return {
    namespace,
    subcommand,
    // For skills: skill name is positional[2] (golems-cli skills install <name>)
    skill: positional[2],
    all: flags.has("--all"),
    force: flags.has("--force"),
    installed: flags.has("--installed"),
    help: flags.has("--help") || flags.has("-h"),
    version: flags.has("--version") || flags.has("-v"),
    yes: flags.has("--yes") || flags.has("-y"),
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
    update: flags.has("--update"),
    commandsDir,
  };
}

async function ensureConfig(): Promise<void> {
  const existing = await loadConfig();
  if (!existing) {
    console.log("First run — detecting tools...");
    const tools = await autoDetectTools();
    await createDefaultConfig(DEFAULT_CONFIG_PATH, {
      reposPath: "~/Gits",
      tools,
    });
    console.log(`Created config at ${DEFAULT_CONFIG_PATH}`);
    const toolNames = Object.keys(tools);
    if (toolNames.length > 0) {
      console.log(`Detected: ${toolNames.join(", ")}`);
    }
  }
}

async function cmdSkillsInstall(opts: ReturnType<typeof parseArgs>) {
  await ensureConfig();

  if (opts.all) {
    console.log("Fetching skill list from GitHub...");
    const skills = await listRemoteSkills();
    console.log(`Installing ${skills.length} skills...`);
    const results = await installAllSkills(skills, {
      commandsDir: opts.commandsDir,
      force: opts.force,
    });
    for (const result of results.filter((r) => r.error)) {
      console.error(`  ${result.name}: failed (${result.error})`);
    }
    const installed = results.filter((r) => r.installed).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => r.error).length;
    console.log(
      `Done. ${installed} installed, ${skipped} skipped, ${failed} failed.`,
    );
    return;
  }

  if (!opts.skill) {
    console.error("Error: provide a skill name or use --all");
    process.exit(1);
  }

  console.log(`Installing ${opts.skill}...`);
  const result = await installSkill(opts.skill, {
    commandsDir: opts.commandsDir,
    force: opts.force,
  });

  if (result.skipped) {
    console.log(`${opts.skill} already installed. Use --force to overwrite.`);
    return;
  }

  console.log(`Installed ${opts.skill} (${result.filesWritten} files)`);

  // Print INSTALL_PROMPT.md if present
  try {
    const promptFile = join(opts.commandsDir, opts.skill, "INSTALL_PROMPT.md");
    const prompt = await readFile(promptFile, "utf8");
    console.log("\n--- Paste this into Claude to complete setup ---\n");
    console.log(prompt);
  } catch {
    // no prompt file — fine
  }
}

async function cmdSkillsList(opts: ReturnType<typeof parseArgs>) {
  if (opts.installed) {
    const skills = await listInstalledSkills(opts.commandsDir);
    if (skills.length === 0) {
      console.log("No skills installed. Run: golems-cli skills install --all");
      return;
    }
    console.log(`Installed skills (${skills.length}):\n`);
    for (const skill of skills.sort()) {
      console.log(`  ${skill}`);
    }
    return;
  }

  console.log("Fetching skill list from GitHub...");
  const remote = await listRemoteSkills();
  const installed = await listInstalledSkills(opts.commandsDir);
  const installedSet = new Set(installed);

  console.log(`\nAvailable skills (${remote.length}):\n`);
  for (const skill of remote.sort()) {
    const marker = installedSet.has(skill) ? "+" : " ";
    console.log(`  [${marker}] ${skill}`);
  }
  console.log(`\n${installed.length}/${remote.length} installed`);
}

async function cmdSkillsUpdate(opts: ReturnType<typeof parseArgs>) {
  const entries = await listInstalledSkillEntries(opts.commandsDir);
  if (entries.length === 0) {
    console.log("No skills installed.");
    return;
  }
  const updateable = entries.filter((entry) => entry.source === "github");
  const results = await installAllSkills(
    updateable.map((entry) => entry.name),
    {
      commandsDir: opts.commandsDir,
      force: true,
    },
  );
  for (const result of results) {
    const status = result.error
      ? `failed (${result.error})`
      : result.installed
        ? "updated"
        : "skipped";
    console.log(`  ${result.name}: ${status}`);
  }
  for (const entry of entries.filter((entry) => entry.source === "local")) {
    console.log(`  ${entry.name}: skipped-local`);
  }
  const updated = results.filter((result) => result.installed).length;
  const failed = results.filter((result) => result.error).length;
  const skippedLocal = entries.length - updateable.length;
  console.log(`Updated ${updated} skills; skipped ${skippedLocal} local.`);
  if (failed > 0) console.log(`Failed ${failed} skills.`);
}

async function cmdSkillsUninstall(opts: ReturnType<typeof parseArgs>) {
  if (!opts.skill) {
    console.error("Error: provide a skill name");
    process.exit(1);
  }

  validateSkillName(opts.skill);

  const { rm } = await import("node:fs/promises");
  const skillDir = join(opts.commandsDir, opts.skill);

  // Verify resolved path stays within commandsDir
  const resolvedSkillDir = resolve(skillDir);
  const resolvedCommandsDir = resolve(opts.commandsDir);
  if (!resolvedSkillDir.startsWith(resolvedCommandsDir + "/")) {
    console.error("Error: invalid skill path");
    process.exit(1);
  }

  try {
    await rm(skillDir, { recursive: true });
    console.log(`Removed ${opts.skill}`);
  } catch {
    console.error(`${opts.skill} is not installed`);
    process.exit(1);
  }
}

async function cmdSkillsStatus(opts: ReturnType<typeof parseArgs>) {
  const installed = await listInstalledSkills(opts.commandsDir);
  const config = await loadConfig();

  console.log(`golems-cli v${VERSION}\n`);
  console.log(`Config:    ${config ? DEFAULT_CONFIG_PATH : "not created"}`);
  console.log(`Skills:    ${opts.commandsDir}`);
  console.log(`Installed: ${installed.length} skills`);

  if (config?.tools) {
    const tools = Object.entries(config.tools);
    if (tools.length > 0) {
      console.log(`\nDetected tools:`);
      for (const [name, path] of tools) {
        console.log(`  ${name}: ${path}`);
      }
    }
  }
}

async function handleSkills(opts: ReturnType<typeof parseArgs>) {
  if (opts.help || !opts.subcommand) {
    printSkillsHelp();
    return;
  }

  switch (opts.subcommand) {
    case "install":
      await cmdSkillsInstall(opts);
      break;
    case "list":
      await cmdSkillsList(opts);
      break;
    case "update":
      await cmdSkillsUpdate(opts);
      break;
    case "uninstall":
      await cmdSkillsUninstall(opts);
      break;
    case "status":
      await cmdSkillsStatus(opts);
      break;
    default:
      console.error(`Unknown skills command: ${opts.subcommand}`);
      printSkillsHelp();
      process.exit(1);
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help && !opts.namespace) {
    printHelp();
    return;
  }

  if (opts.version && !opts.namespace) {
    console.log(VERSION);
    return;
  }

  if (!opts.namespace) {
    printHelp();
    return;
  }

  // Backward compat: if someone runs `golems-cli install commit` (without `skills`)
  if (SKILLS_SUBCOMMANDS.includes(opts.namespace)) {
    console.log(
      `Did you mean: golems-cli skills ${opts.namespace}${opts.subcommand ? " " + opts.subcommand : ""}?`,
    );
    process.exit(1);
  }

  switch (opts.namespace) {
    case "skills":
      await handleSkills(opts);
      break;
    case "update":
      if (opts.help) {
        printUpdateHelp();
      } else {
        await runUpdate({
          yes: opts.yes,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          commandsDir: opts.commandsDir,
        });
      }
      break;
    case "mcp":
      console.log(
        "golems-cli mcp — Coming soon.\n\n" +
          "MCP servers require: add to .mcp.json, install dependencies, test connection.\n" +
          "Different from skills (file copy) — MCPs need runtime configuration.",
      );
      break;
    case "agent":
      console.log(
        "golems-cli agent — Coming soon.\n\n" +
          "Agents are composite installs that bundle skills + MCPs + CLAUDE.md + launcher\n" +
          "into a single setup. One command to get a full agent running.",
      );
      break;
    case "wizard":
      if (opts.update) {
        // `wizard --update` is an alias for `update`
        await runUpdate({
          yes: opts.yes,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          commandsDir: opts.commandsDir,
        });
      } else if (opts.help) {
        console.log(
          "golems-cli wizard — Interactive setup wizard\n\n" +
            "Detects installed AI CLIs, configures workspace, and installs skills.\n\n" +
            "Usage: golems-cli wizard\n" +
            "       golems-cli wizard --update  (alias for 'golems-cli update')",
        );
      } else {
        await runWizard();
      }
      break;
    default:
      console.error(`Unknown command: ${opts.namespace}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
