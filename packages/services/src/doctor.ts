#!/usr/bin/env bun

/**
 * Golems Health Check - Diagnostic command
 * Usage: bun run src/doctor.ts
 *
 * Checks:
 * - Telegram bot process
 * - Ollama HTTP endpoint
 * - Notification server (port 3847)
 * - Launchd jobs registration
 * - State file existence
 * - .env file existence
 * - Supabase connectivity (if configured)
 */

import { promises as fs, existsSync } from "fs";
import { execSync } from "child_process";

// Color codes
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  fix?: string;
}

const results: CheckResult[] = [];

// Auto-detect LLM backend: MLX on Apple Silicon (macOS arm64), Ollama otherwise
const isAppleSilicon = process.arch === "arm64" && process.platform === "darwin";
const defaultGlmBackend = isAppleSilicon ? "mlx" : "ollama";
const GLM_BACKEND = process.env.GLM_BACKEND || defaultGlmBackend;

// Helper: format check output
function checkmark(status: "pass" | "fail" | "warn"): string {
  switch (status) {
    case "pass":
      return `${colors.green}✓${colors.reset}`;
    case "fail":
      return `${colors.red}✗${colors.reset}`;
    case "warn":
      return `${colors.yellow}⚠${colors.reset}`;
  }
}

// Helper: HTTP request with timeout
async function httpCheck(
  url: string,
  timeoutMs: number = 2000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      method: "GET",
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// Helper: run shell command
function runCommand(cmd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return { success: true, output };
  } catch (error) {
    return { success: false, output: error instanceof Error ? error.message : "" };
  }
}

// Check 1: Telegram bot
async function checkTelegramBot() {
  const result = runCommand("pgrep -f 'telegram-bot|bun.*bot' | head -1");
  if (result.success && result.output.trim()) {
    results.push({
      name: "Telegram Bot",
      status: "pass",
      message: `Running (PID: ${result.output.trim()})`,
    });
  } else {
    results.push({
      name: "Telegram Bot",
      status: "fail",
      message: "Not running",
      fix: "cd ~/Gits/golems/packages/claude && bun src/telegram-bot.ts",
    });
  }
}

// Check 2: Ollama (required when GLM_BACKEND=ollama, optional otherwise)
async function checkOllama() {
  const online = await httpCheck("http://127.0.0.1:11434/api/version", 2000);
  const isConfigured = GLM_BACKEND === "ollama";
  if (online) {
    results.push({
      name: "Ollama",
      status: "pass",
      message: `Responding on 127.0.0.1:11434${isConfigured ? " (configured backend)" : " (available as fallback)"}`,
    });
  } else {
    results.push({
      name: "Ollama",
      status: isConfigured ? "fail" : "warn",
      message: `Not responding on 127.0.0.1:11434${isConfigured ? " (configured backend!)" : " (MLX is primary)"}`,
      fix: isConfigured ? "golems start ollama" : "ollama serve  (optional fallback for MLX)",
    });
  }
}

// Check 2a: Ollama GLM model (required for Ollama backend, warn for MLX fallback)
async function checkOllamaModel() {
  // Match any GLM variant: glm4, glm-4.7-flash, glm4:latest, etc.
  const modelCheck = runCommand("ollama list 2>/dev/null | grep -qi 'glm'");
  const isConfigured = GLM_BACKEND === "ollama";
  if (modelCheck.success) {
    results.push({
      name: "Ollama GLM Model",
      status: "pass",
      message: `GLM model available${isConfigured ? " for BrainLayer enrichment" : " (Ollama fallback ready)"}`,
    });
  } else {
    results.push({
      name: "Ollama GLM Model",
      status: "warn",
      message: isConfigured
        ? "No GLM model found — needed for BrainLayer enrichment"
        : "No GLM model found — Ollama fallback won't work without it",
      fix: "ollama pull glm4",
    });
  }
}

// Check 2b: MLX Server (required when GLM_BACKEND=mlx, optional otherwise)
async function checkMLX() {
  const online = await httpCheck("http://127.0.0.1:8080/v1/models", 2000);
  const isConfigured = GLM_BACKEND === "mlx";
  if (online) {
    results.push({
      name: "MLX Server",
      status: "pass",
      message: `Responding on 127.0.0.1:8080${isConfigured ? " (configured backend)" : ""}`,
    });
  } else {
    results.push({
      name: "MLX Server",
      status: isConfigured ? "fail" : "warn",
      message: isConfigured
        ? "Not running — configured as primary backend (Ollama used as fallback)"
        : "Not running (optional — Ollama is configured backend)",
      fix: isConfigured
        ? "launchctl load ~/Library/LaunchAgents/com.golems.mlx-server.plist"
        : "python3 -m mlx_lm.server --model mlx-community/Qwen2.5-Coder-14B-Instruct-4bit --port 8080",
    });
  }
}

// Check 3: Notification server (TCP connect test — no side effects)
async function checkNotificationServer() {
  const portOpen = runCommand("lsof -i :3847 -sTCP:LISTEN | grep -q LISTEN");
  if (portOpen.success) {
    results.push({
      name: "Notification Server",
      status: "pass",
      message: "Listening on port 3847",
    });
  } else {
    results.push({
      name: "Notification Server",
      status: "fail",
      message: "Not listening on port 3847",
      fix: "golems start telegram  (includes notification server)",
    });
  }
}

// Check 4: Launchd jobs
async function checkLaunchd() {
  // Map service names to their launchd label prefixes
  const golems: Array<{ name: string; label: string }> = [
    { name: "telegram", label: "com.golemszikaron.telegram" },
    { name: "nightshift", label: "com.golemszikaron.nightshift" },
    { name: "briefing", label: "com.golemszikaron.briefing" },
    { name: "healthcheck", label: "com.golemszikaron.healthcheck" },
    { name: "compactor", label: "com.golemszikaron.compactor" },
    { name: "session-archiver", label: "com.golems.session-archiver" },
    { name: "auto-index", label: "com.golems.auto-index" },
  ];
  const launchResult = runCommand("launchctl list 2>/dev/null | grep -E 'golem|zikaron' || true");
  const loadedOutput = launchResult.output;

  const missingServices = golems.filter((g) => !loadedOutput.includes(g.label));

  if (missingServices.length === 0) {
    results.push({
      name: "Launchd Jobs",
      status: "pass",
      message: `All ${golems.length} services loaded`,
    });
  } else {
    results.push({
      name: "Launchd Jobs",
      status: "warn",
      message: `${missingServices.length}/${golems.length} not loaded: ${missingServices.map(s => s.name).join(", ")}`,
      fix: missingServices.map(s => `launchctl load ~/Library/LaunchAgents/${s.label}.plist`).join("\n  "),
    });
  }
}

// Check 5: State file
async function checkStateFile() {
  const stateFile = `${process.env.HOME}/.golems-zikaron/state.json`;
  try {
    await fs.access(stateFile);
    const content = await fs.readFile(stateFile, "utf-8");
    const state = JSON.parse(content);
    results.push({
      name: "State File",
      status: "pass",
      message: `Exists (target: ${state.nightShiftTarget || "none"})`,
    });
  } catch {
    results.push({
      name: "State File",
      status: "warn",
      message: "Missing or invalid JSON",
      fix: `mkdir -p ~/.golems-zikaron && echo '{"nightShiftTarget":"songscript"}' > ~/.golems-zikaron/state.json`,
    });
  }
}

// Check 6: .env file
async function checkEnvFile() {
  const envFile = `${process.cwd()}/.env`;
  try {
    await fs.access(envFile);
    const content = await fs.readFile(envFile, "utf-8");
    const lines = content.split("\n").filter((l) => l && !l.startsWith("#"));
    results.push({
      name: ".env File",
      status: "pass",
      message: `Found (${lines.length} variables)`,
    });
  } catch {
    results.push({
      name: ".env File",
      status: "warn",
      message: "Missing .env in package root",
      fix: "cp .env.example .env  (or create with TELEGRAM_BOT_TOKEN, etc.)",
    });
  }
}

// Check 7: Supabase
async function checkSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    results.push({
      name: "Supabase",
      status: "warn",
      message: "Not configured (missing SUPABASE_URL/SUPABASE_ANON_KEY)",
      fix: "Set SUPABASE_URL and SUPABASE_ANON_KEY in .env",
    });
    return;
  }

  try {
    // Simple connectivity test: try to create a client and check health
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseKey,
      },
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok || response.status === 404) {
      results.push({
        name: "Supabase",
        status: "pass",
        message: `Responding (${supabaseUrl})`,
      });
    } else {
      results.push({
        name: "Supabase",
        status: "fail",
        message: `HTTP ${response.status} from ${supabaseUrl}`,
        fix: "Check SUPABASE_URL and SUPABASE_ANON_KEY in .env",
      });
    }
  } catch {
    results.push({
      name: "Supabase",
      status: "fail",
      message: `Connection timeout or error`,
      fix: "Check network connectivity and SUPABASE_URL",
    });
  }
}

// Check 8: Axiom observability
async function checkAxiom() {
  try {
    const { loadConfig } = await import("@golems/shared/lib/config");
    const config = loadConfig();
    const token = process.env.AXIOM_TOKEN || config.observability.axiomToken;
    const enabled = config.observability.enabled;

    if (!enabled) {
      results.push({
        name: "Axiom",
        status: "warn",
        message: "Disabled in config",
        fix: "Set observability.enabled: true in ~/.golems/config.yaml",
      });
    } else if (!token) {
      results.push({
        name: "Axiom",
        status: "warn",
        message: "Enabled but no token configured",
        fix: "Set AXIOM_TOKEN env var or axiomToken in ~/.golems/config.yaml",
      });
    } else {
      results.push({
        name: "Axiom",
        status: "pass",
        message: `Configured (dataset: ${config.observability.axiomDataset || "golems"})`,
      });
    }
  } catch {
    results.push({
      name: "Axiom",
      status: "warn",
      message: "Could not load config",
      fix: "Run: golems wizard",
    });
  }
}

// Check 10: Golem Profiles
async function checkGolemProfiles() {
  const home = process.env.HOME;
  if (!home) {
    results.push({
      name: "Golem Profiles",
      status: "warn",
      message: "HOME not set",
      fix: "Set HOME environment variable",
    });
    return;
  }
  const profilesDir = `${home}/Gits/golem-profiles`;
  const ownerProfile = `${profilesDir}/owner-profile.md`;
  const symlink = `${process.cwd()}/.claude/rules/owner-profile.md`;

  try {
    await fs.access(profilesDir);
  } catch {
    results.push({
      name: "Golem Profiles",
      status: "fail",
      message: "golem-profiles repo not found",
      fix: "scripts/setup-golem-profiles.sh --init",
    });
    return;
  }

  try {
    await fs.access(ownerProfile);
  } catch {
    results.push({
      name: "Golem Profiles",
      status: "fail",
      message: "owner-profile.md missing in golem-profiles",
      fix: "Create ~/Gits/golem-profiles/owner-profile.md from template",
    });
    return;
  }

  try {
    const stat = await fs.lstat(symlink);
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(symlink);
      if (target === ownerProfile) {
        results.push({
          name: "Golem Profiles",
          status: "pass",
          message: "Repo + symlinks OK",
        });
      } else {
        results.push({
          name: "Golem Profiles",
          status: "warn",
          message: `Symlink points to wrong target: ${target}`,
          fix: "scripts/setup-golem-profiles.sh --fix",
        });
      }
    } else {
      results.push({
        name: "Golem Profiles",
        status: "warn",
        message: "owner-profile.md is a regular file (should be symlink)",
        fix: "scripts/setup-golem-profiles.sh --fix",
      });
    }
  } catch {
    results.push({
      name: "Golem Profiles",
      status: "warn",
      message: "Symlink not set up in .claude/rules/",
      fix: "scripts/setup-golem-profiles.sh --fix",
    });
  }
}

// Check enrichment queue depth
async function checkEnrichmentQueue() {
  // Try brainlayer path first (new), fall back to zikaron (legacy)
  const brainlayerDb = `${process.env.HOME}/.local/share/brainlayer/brainlayer.db`;
  const zikaronDb = `${process.env.HOME}/.local/share/zikaron/zikaron.db`;
  const dbPath = existsSync(brainlayerDb) ? brainlayerDb : zikaronDb;
  const cmd = runCommand(
    `python3 -c "import apsw; db=apsw.Connection('${dbPath}', flags=apsw.SQLITE_OPEN_READONLY); print(list(db.cursor().execute('SELECT COUNT(*) FROM chunks WHERE enriched_at IS NULL'))[0][0]); db.close()"`
  );
  if (cmd.success && cmd.output) {
    const unenriched = parseInt(cmd.output.trim(), 10);
    if (isNaN(unenriched)) {
      results.push({
        name: "Enrichment Queue",
        status: "warn",
        message: "Could not parse queue depth",
      });
    } else if (unenriched > 5000) {
      const days = Math.round(unenriched / 1500);
      results.push({
        name: "Enrichment Queue",
        status: "fail",
        message: `${unenriched.toLocaleString()} unenriched — about ${days} days behind`,
        fix: "./scripts/auto-enrich.sh --max-hours 6",
      });
    } else if (unenriched > 1000) {
      results.push({
        name: "Enrichment Queue",
        status: "warn",
        message: `${unenriched.toLocaleString()} unenriched — could use a catch-up run`,
        fix: "./scripts/enrich.sh start",
      });
    } else {
      results.push({
        name: "Enrichment Queue",
        status: "pass",
        message: `Only ${unenriched.toLocaleString()} unenriched — looking good!`,
      });
    }
  } else {
    results.push({
      name: "Enrichment Queue",
      status: "warn",
      message: "Could not check (DB or Python not available)",
    });
  }
}

// Format and print results
function printResults() {
  console.log(`\n${colors.blue}=== GOLEMS HEALTH CHECK ===${colors.reset}\n`);

  // Print table
  console.log(`${colors.gray}Service                       Status   Message${colors.reset}`);
  console.log(`${colors.gray}${"─".repeat(70)}${colors.reset}`);

  results.forEach((r) => {
    const mark = checkmark(r.status);
    const statusStr = r.status.toUpperCase().padEnd(8);
    const message = r.message.padEnd(40);
    console.log(`${r.name.padEnd(30)} ${mark} ${statusStr} ${message}`);
  });

  // Summary
  const passes = results.filter((r) => r.status === "pass").length;
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;

  console.log(`\n${colors.gray}${"─".repeat(70)}${colors.reset}`);
  console.log(
    `Summary: ${colors.green}${passes} pass${colors.reset}, ${colors.yellow}${warns} warn${colors.reset}, ${colors.red}${fails} fail${colors.reset}\n`
  );

  // Print fixes
  const needsFix = results.filter((r) => r.fix);
  if (needsFix.length > 0) {
    console.log(`${colors.yellow}Suggested Fixes:${colors.reset}\n`);
    needsFix.forEach((r) => {
      console.log(`${r.name}:`);
      console.log(`  ${colors.gray}${r.fix}${colors.reset}\n`);
    });
  }

  // Exit code
  const hasFailures = fails > 0;
  process.exit(hasFailures ? 1 : 0);
}

// Main
async function main() {
  console.log("Checking Golems health...\n");
  console.log(`  LLM Backend: ${GLM_BACKEND} (arch: ${process.arch})\n`);

  await checkTelegramBot();
  await checkOllama();
  await checkOllamaModel();
  await checkMLX();
  await checkNotificationServer();
  await checkLaunchd();
  await checkStateFile();
  await checkEnvFile();
  await checkSupabase();
  await checkAxiom();
  await checkGolemProfiles();
  await checkEnrichmentQueue();

  printResults();
}

main().catch((err) => {
  console.error(`${colors.red}Error:${colors.reset}`, err.message);
  process.exit(1);
});
