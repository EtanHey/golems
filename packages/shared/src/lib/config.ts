/**
 * Centralized Golems Configuration
 *
 * Reads from ~/.golems/config.yaml with sensible defaults.
 * All golem services use this instead of scattered hardcoded paths.
 *
 * Config search order:
 * 1. Environment variables (highest priority)
 * 2. ~/.golems/config.yaml
 * 3. Built-in defaults
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const HOME = process.env.HOME;
if (!HOME) throw new Error("HOME environment variable is required");
const CONFIG_DIR = join(HOME, ".golems");
const CONFIG_FILE = join(CONFIG_DIR, "config.yaml");

// ─── Types ─────────────────────────────────────────────────────────

export type SeatCli = "claude" | "codex" | "cursor" | "gemini" | "kiro";
export type SeatRole = "lead" | "worker" | "orc";

export interface SeatLaunchers {
  claude: string;
  codex: string;
  cursor: string;
  gemini: string;
  kiro: string;
}

export interface SeatOrgTree {
  parent: string | null;
  directReports: string[];
}

export interface SeatEntry {
  /** Owning repo key/folder that spawn gates validate against */
  repo: string;
  /** repoGolem launchers for this seat */
  launchers: SeatLaunchers;
  /** Canonical lane name */
  lane: string;
  /** Non-canonical lane names normalized by lane-alias lint */
  aliases: string[];
  /** Fleet role for routing and geometry */
  role: SeatRole;
  /** Direct-report topology for dispatch gates */
  orgTree: SeatOrgTree;
}

export type SeatRegistry = Record<string, SeatEntry>;

export interface GolemsConfig {
  /** Base path for all git repos */
  reposPath: string;

  /** State directory for runtime data */
  stateDir: string;

  /** Tool binary paths (absolute, for launchd compatibility) */
  tools: {
    claude: string;
    gemini: string;
    gh: string;
    cursor: string;
    codex: string;
    kiro: string;
  };

  /** NightShift settings */
  nightshift: {
    /** Repo rotation order */
    rotation: string[];
    /** Claude timeout in ms */
    timeout: number;
    /** Enable Gemini pre-scan */
    geminiPreScan: boolean;
    /** Enable self-healing fix list */
    selfHealing: boolean;
  };

  /** Telegram settings */
  telegram: {
    /** Bot token (prefer env var TELEGRAM_BOT_TOKEN) */
    token?: string;
    /** Notification server port */
    notifyPort: number;
  };

  /** Observability (Axiom log drain) */
  observability: {
    /** Axiom dataset name (set after creating account at axiom.co) */
    axiomDataset?: string;
    /** Axiom API token (prefer env var AXIOM_TOKEN) */
    axiomToken?: string;
    /** Enable log drain to Axiom */
    enabled: boolean;
  };

  /** Cost tracking */
  costs: {
    /** Path to JSONL cost log */
    logPath: string;
    /** Monthly budget alert threshold in USD */
    budgetAlertUSD: number;
  };

  /** Feature flags */
  features: {
    emailGolem: boolean;
    jobGolem: boolean;
    recruiterGolem: boolean;
    tellerGolem: boolean;
    nightShift: boolean;
    soltome: boolean;
  };

  /** Canonical seat -> repo -> launcher -> lane -> org-tree registry */
  seatRegistry: SeatRegistry;
}

// ─── Defaults ──────────────────────────────────────────────────────

const SEAT_CLI_SUFFIXES: Record<SeatCli, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  kiro: "Kiro",
};

const REQUIRED_SEAT_LAUNCHERS: SeatCli[] = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "kiro",
];

function strippedLauncherPrefix(repo: string): string {
  return repo.replace(/-/g, "");
}

function buildLaunchers(
  repo: string,
  launcherPrefix = strippedLauncherPrefix(repo),
): SeatLaunchers {
  return {
    claude: `${launcherPrefix}${SEAT_CLI_SUFFIXES.claude}`,
    codex: `${launcherPrefix}${SEAT_CLI_SUFFIXES.codex}`,
    cursor: `${launcherPrefix}${SEAT_CLI_SUFFIXES.cursor}`,
    gemini: `${launcherPrefix}${SEAT_CLI_SUFFIXES.gemini}`,
    kiro: `${launcherPrefix}${SEAT_CLI_SUFFIXES.kiro}`,
  };
}

function makeSeat(options: {
  repo: string;
  lane: string;
  role: SeatRole;
  parent: string | null;
  directReports?: string[];
  aliases?: string[];
  launcherPrefix?: string;
}): SeatEntry {
  return {
    repo: options.repo,
    launchers: buildLaunchers(options.repo, options.launcherPrefix),
    lane: options.lane,
    aliases: options.aliases ?? [],
    role: options.role,
    orgTree: {
      parent: options.parent,
      directReports: options.directReports ?? [],
    },
  };
}

const DEFAULT_SEAT_REGISTRY: SeatRegistry = {
  orcClaude: makeSeat({
    repo: "orc",
    lane: "orc",
    role: "orc",
    parent: null,
    aliases: ["HappyCamper", "Cantaloupe-AI", "happyCampr"],
    directReports: [
      "golemsLead",
      "skillcreatorLead",
      "cmuxlayerLead",
      "dashboardLead",
      "brainClaude",
      "coachClaude",
      "voiceClaude",
      "aftercodeClaude",
      "taskowlClaude",
    ],
  }),
  golemsLead: makeSeat({
    repo: "golems",
    lane: "golems",
    role: "lead",
    parent: "orcClaude",
    directReports: ["golemsClaude"],
  }),
  golemsClaude: makeSeat({
    repo: "golems",
    lane: "golems",
    role: "worker",
    parent: "golemsLead",
  }),
  skillcreatorLead: makeSeat({
    repo: "skill-creator",
    lane: "skill-creator",
    role: "lead",
    parent: "orcClaude",
    aliases: ["skillcreator"],
    launcherPrefix: "skillcreator",
    directReports: ["skillCreatorClaude", "evalLead"],
  }),
  skillCreatorClaude: makeSeat({
    repo: "skill-creator",
    lane: "skill-creator",
    role: "worker",
    parent: "skillcreatorLead",
    aliases: ["skillCreator"],
    launcherPrefix: "skillcreator",
  }),
  evalLead: makeSeat({
    repo: "eval",
    lane: "eval",
    role: "lead",
    parent: "skillcreatorLead",
  }),
  cmuxlayerLead: makeSeat({
    repo: "cmuxlayer",
    lane: "cmuxlayer",
    role: "lead",
    parent: "orcClaude",
    directReports: ["cmuxlayerClaude"],
  }),
  cmuxlayerClaude: makeSeat({
    repo: "cmuxlayer",
    lane: "cmuxlayer",
    role: "worker",
    parent: "cmuxlayerLead",
  }),
  dashboardLead: makeSeat({
    repo: "golems-dashboard",
    lane: "dashboard",
    role: "lead",
    parent: "orcClaude",
    launcherPrefix: "dashboard",
    directReports: ["dashboardClaude"],
  }),
  dashboardClaude: makeSeat({
    repo: "golems-dashboard",
    lane: "dashboard",
    role: "worker",
    parent: "dashboardLead",
    launcherPrefix: "dashboard",
  }),
  brainClaude: makeSeat({
    repo: "brainlayer",
    lane: "brainlayer",
    role: "lead",
    parent: "orcClaude",
    aliases: ["brain"],
  }),
  coachClaude: makeSeat({
    repo: "coach",
    lane: "coach",
    role: "lead",
    parent: "orcClaude",
  }),
  voiceClaude: makeSeat({
    repo: "voicelayer",
    lane: "voicelayer",
    role: "lead",
    parent: "orcClaude",
    aliases: ["voice"],
  }),
  aftercodeClaude: makeSeat({
    repo: "aftercode",
    lane: "aftercode",
    role: "lead",
    parent: "orcClaude",
  }),
  taskowlClaude: makeSeat({
    repo: "TaskOwl-app",
    lane: "taskowl",
    role: "lead",
    parent: "orcClaude",
    launcherPrefix: "taskowl",
  }),
};

const DEFAULTS: GolemsConfig = {
  reposPath: `${HOME}/Gits`,
  stateDir: `${HOME}/.golems-zikaron`,
  tools: {
    claude: `${HOME}/.local/bin/claude`,
    gemini: `${HOME}/.nvm/versions/node/v22.0.0/bin/gemini`,
    gh: "/usr/local/bin/gh",
    cursor: `${HOME}/.local/bin/cursor`,
    codex: `${HOME}/.nvm/versions/node/v22.0.0/bin/npx`,
    kiro: `${HOME}/.local/bin/kiro-cli`,
  },
  nightshift: {
    rotation: ["golems", "brainlayer", "voicelayer"],
    timeout: 300000,
    geminiPreScan: true,
    selfHealing: true,
  },
  telegram: {
    notifyPort: 3847,
  },
  observability: {
    enabled: false,
  },
  costs: {
    logPath: `${HOME}/.golems-zikaron/api_costs.jsonl`,
    budgetAlertUSD: 10,
  },
  features: {
    emailGolem: true,
    jobGolem: true,
    recruiterGolem: true,
    tellerGolem: true,
    nightShift: true,
    soltome: true,
  },
  seatRegistry: DEFAULT_SEAT_REGISTRY,
};

// ─── Loader ────────────────────────────────────────────────────────

let cachedConfig: GolemsConfig | null = null;

export function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  overrides: Partial<T>,
): T {
  const result = { ...defaults };
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const val = overrides[key];
    if (
      val !== undefined &&
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof defaults[key] === "object" &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(
        defaults[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`[Config] ${path} must be a string`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`[Config] ${path} must be an array of strings`);
  }
  return [...value];
}

function requireSeatRole(value: unknown, path: string): SeatRole {
  if (value !== "lead" && value !== "worker" && value !== "orc") {
    throw new Error(`[Config] ${path} must be lead, worker, or orc`);
  }
  return value;
}

function validateSeatLaunchers(value: unknown, path: string): SeatLaunchers {
  if (!isRecord(value)) {
    throw new Error(`[Config] ${path} must be an object`);
  }

  const launchers: Partial<SeatLaunchers> = {};
  for (const cli of REQUIRED_SEAT_LAUNCHERS) {
    launchers[cli] = requireString(value[cli], `${path}.${cli}`);
  }

  const { claude, codex, cursor, gemini, kiro } = launchers;
  if (!claude || !codex || !cursor || !gemini || !kiro) {
    throw new Error(`[Config] ${path} is missing required launchers`);
  }

  return { claude, codex, cursor, gemini, kiro };
}

function validateSeatOrgTree(value: unknown, path: string): SeatOrgTree {
  if (!isRecord(value)) {
    throw new Error(`[Config] ${path} must be an object`);
  }

  const parent = value.parent;
  if (parent !== null && typeof parent !== "string") {
    throw new Error(`[Config] ${path}.parent must be a string or null`);
  }

  return {
    parent,
    directReports: requireStringArray(
      value.directReports,
      `${path}.directReports`,
    ),
  };
}

function validateSeatEntry(value: unknown, path: string): SeatEntry {
  if (!isRecord(value)) {
    throw new Error(`[Config] ${path} must be an object`);
  }

  return {
    repo: requireString(value.repo, `${path}.repo`),
    launchers: validateSeatLaunchers(value.launchers, `${path}.launchers`),
    lane: requireString(value.lane, `${path}.lane`),
    aliases: requireStringArray(value.aliases, `${path}.aliases`),
    role: requireSeatRole(value.role, `${path}.role`),
    orgTree: validateSeatOrgTree(value.orgTree, `${path}.orgTree`),
  };
}

function validateSeatRegistry(value: unknown): SeatRegistry {
  if (!isRecord(value)) {
    throw new Error("[Config] seatRegistry must be an object");
  }

  const registry: SeatRegistry = {};
  for (const [seatName, seatValue] of Object.entries(value)) {
    const seat = validateSeatEntry(seatValue, `seatRegistry.${seatName}`);
    registry[seatName] = seat;
  }

  const canonicalSeats = new Set(Object.keys(registry));
  const canonicalLanes = new Set(
    Object.values(registry).map((seat) => seat.lane),
  );
  const aliases = new Map<string, string>();

  for (const [seatName, seat] of Object.entries(registry)) {
    for (const alias of seat.aliases) {
      if (canonicalSeats.has(alias)) {
        throw new Error(
          `[Config] seatRegistry.${seatName}.aliases contains ${alias}, which shadows canonical seat ${alias}`,
        );
      }
      if (canonicalLanes.has(alias)) {
        throw new Error(
          `[Config] seatRegistry.${seatName}.aliases contains ${alias}, which shadows canonical lane ${alias}`,
        );
      }

      const existingLane = aliases.get(alias);
      if (existingLane && existingLane !== seat.lane) {
        throw new Error(
          `[Config] seatRegistry alias ${alias} maps to both ${existingLane} and ${seat.lane}`,
        );
      }
      aliases.set(alias, seat.lane);
    }
  }

  for (const [seatName, seat] of Object.entries(registry)) {
    const parent = seat.orgTree.parent;
    if (parent !== null) {
      const parentSeat = registry[parent];
      if (!parentSeat) {
        throw new Error(
          `[Config] seatRegistry.${seatName}.orgTree.parent references unknown seat ${parent}`,
        );
      }
      if (!parentSeat.orgTree.directReports.includes(seatName)) {
        throw new Error(
          `[Config] seatRegistry.${seatName}.orgTree.parent is ${parent}, but seatRegistry.${parent}.orgTree.directReports does not include ${seatName}`,
        );
      }
    }

    for (const childName of seat.orgTree.directReports) {
      const child = registry[childName];
      if (!child) {
        throw new Error(
          `[Config] seatRegistry.${seatName}.orgTree.directReports references unknown seat ${childName}`,
        );
      }
      if (child.orgTree.parent !== seatName) {
        throw new Error(
          `[Config] seatRegistry.${seatName}.orgTree.directReports includes ${childName}, but child parent is ${child.orgTree.parent}`,
        );
      }
    }
  }

  return registry;
}

function validateFileConfig(value: unknown): Partial<GolemsConfig> {
  if (!isRecord(value)) {
    throw new Error(`[Config] ${CONFIG_FILE} must contain a YAML object`);
  }
  return value as Partial<GolemsConfig>;
}

function normalizeConfig(config: GolemsConfig): GolemsConfig {
  return {
    ...config,
    seatRegistry: validateSeatRegistry(
      config.seatRegistry ?? DEFAULTS.seatRegistry,
    ),
  };
}

/**
 * Load config from ~/.golems/config.yaml merged with defaults.
 * Caches result for the process lifetime.
 */
export function loadConfig(): GolemsConfig {
  if (cachedConfig) {
    cachedConfig = normalizeConfig(cachedConfig);
    return cachedConfig;
  }

  let fileConfig: Partial<GolemsConfig> = {};

  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      fileConfig = validateFileConfig(parseYaml(raw) || {});
    } catch (err) {
      console.warn(`[Config] Failed to parse ${CONFIG_FILE}:`, err);
    }
  }

  // Environment variable overrides
  const envOverrides: Partial<GolemsConfig> = {};
  if (process.env.REPOS_PATH) envOverrides.reposPath = process.env.REPOS_PATH;
  if (process.env.GOLEMS_STATE_DIR)
    envOverrides.stateDir = process.env.GOLEMS_STATE_DIR;

  const mergedConfig = deepMerge(
    deepMerge(DEFAULTS, fileConfig),
    envOverrides,
  );
  cachedConfig = normalizeConfig(mergedConfig);
  return cachedConfig;
}

function loadSeatRegistry(): SeatRegistry {
  const config = loadConfig();
  return validateSeatRegistry(config.seatRegistry ?? DEFAULTS.seatRegistry);
}

export function getSeat(name: string): SeatEntry | undefined {
  return loadSeatRegistry()[name];
}

export function resolveLauncher(seatName: string, cli: SeatCli): string {
  const seat = getSeat(seatName);
  if (!seat) {
    throw new Error(`[Config] Unknown seat: ${seatName}`);
  }

  const launcher = seat.launchers[cli];
  if (!launcher) {
    throw new Error(`[Config] Seat ${seatName} has no launcher for ${cli}`);
  }

  return launcher;
}

export function isDirectReport(parentSeat: string, childSeat: string): boolean {
  const parent = getSeat(parentSeat);
  const child = getSeat(childSeat);
  if (!parent || !child) return false;

  return (
    parent.orgTree.directReports.includes(childSeat) &&
    child.orgTree.parent === parentSeat
  );
}

export function resolveLaneAlias(alias: string): string | undefined {
  const normalized = alias.trim();
  if (!normalized) return undefined;

  for (const [seatName, seat] of Object.entries(loadSeatRegistry())) {
    if (
      seatName === normalized ||
      seat.lane === normalized ||
      seat.aliases.includes(normalized)
    ) {
      return seat.lane;
    }
  }

  return undefined;
}

function defaultSeatRegistryYaml(options?: { commented?: boolean }): string {
  return stringifyYaml(DEFAULTS.seatRegistry)
    .trimEnd()
    .split("\n")
    .map((line) => (options?.commented ? `#   ${line}` : `  ${line}`))
    .join("\n");
}

/** Reset cached config (for testing) */
export function resetConfig(): void {
  cachedConfig = null;
}

/**
 * Generate a default config.yaml if one doesn't exist.
 * Called by `golems wizard` or `golems init`.
 */
export function initConfig(): string {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (existsSync(CONFIG_FILE)) {
    return `Config already exists at ${CONFIG_FILE}`;
  }

  const defaultYaml = `# Golems Configuration
# See: https://etanhey.github.io/golems/docs/configuration

# Base path for git repos
reposPath: "${HOME}/Gits"

# Runtime state directory
stateDir: "${HOME}/.golems-zikaron"

# CLI tool paths (absolute for launchd compatibility)
tools:
  claude: "${HOME}/.local/bin/claude"
  gemini: "${HOME}/.nvm/versions/node/v22.0.0/bin/gemini"
  gh: "/usr/local/bin/gh"
  cursor: "${HOME}/.local/bin/cursor"
  codex: "${HOME}/.nvm/versions/node/v22.0.0/bin/npx"
  kiro: "${HOME}/.local/bin/kiro-cli"

# NightShift configuration
nightshift:
  rotation:
    - songscript
    - zikaron
    - claude-golem
  timeout: 300000     # 5 minutes
  geminiPreScan: true
  selfHealing: true

# Telegram bot
telegram:
  notifyPort: 3847

# Observability (Axiom log drain)
# Sign up at axiom.co (free tier: 500MB/day)
# Then set axiomDataset and AXIOM_TOKEN env var
observability:
  enabled: false
  # axiomDataset: "golems"

# API cost tracking
costs:
  logPath: "${HOME}/.golems-zikaron/api_costs.jsonl"
  budgetAlertUSD: 10    # Alert when monthly costs exceed this

# Feature flags (enable/disable golems)
features:
  emailGolem: true
  jobGolem: true
  recruiterGolem: true
  tellerGolem: true
  nightShift: true
  soltome: true

# Canonical fleet seat registry defaults live in packages/shared/src/lib/config.ts.
# Uncomment this illustrative mirror only for per-machine overrides.
# seatRegistry:
${defaultSeatRegistryYaml({ commented: true })}
`;

  writeFileSync(CONFIG_FILE, defaultYaml);
  return `Created ${CONFIG_FILE}`;
}
