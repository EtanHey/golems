import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const DISPATCHER = join(REPO, "scripts", "repogolem", "golem-dispatch.zsh");
const CANARY = "SYNTHETIC_ARGV_SECRET_416";
const COMMAND_CANARY = "SYNTHETIC_ARGV_COMMAND_416";
const URL_CANARY = "SYNTHETIC_ARGV_URL_416";
const TIMEOUT_CANARY = "SYNTHETIC_ARGV_TIMEOUT_416";
const NASTY = `${CANARY}_NASTY q"uo'te \\back $dollar \`tick\` ünïcödé 日本 \n second line\ttab`;
const CANARIES = [CANARY, COMMAND_CANARY, URL_CANARY, TIMEOUT_CANARY];

let scratch: string;
let bin: string;
let argvLog: string;

beforeEach(() => {
  scratch = mkdtempSync(join(import.meta.dir, ".repogolem-mcp-argv-"));
  bin = join(scratch, "bin");
  argvLog = join(scratch, "jq.argv");
  mkdirSync(bin);

  const realJq = Bun.which("jq");
  if (!realJq) throw new Error("jq is required for repoGolem MCP argv tests");
  const recorder = join(bin, "jq");
  writeFileSync(
    recorder,
    `#!/bin/sh
for arg do
  printf '%s\n' "$arg"
done >> "$JQ_ARG_LOG"
exec "$REAL_JQ" "$@"
`,
  );
  chmodSync(recorder, 0o700);
  process.env.REAL_JQ = realJq;
});

afterEach(() => {
  delete process.env.REAL_JQ;
  rmSync(scratch, { recursive: true, force: true });
});

function runZsh(script: string, args: string[], env: Record<string, string>) {
  const base = { ...process.env };
  delete base.WEAVE_ALLOW_TMP;
  delete base.GOLEM_ROLE;
  delete base.GOLEM_EFFORT;
  return Bun.spawnSync(["zsh", "-f", "-c", script, "_", ...args], {
    env: {
      ...base,
      PATH: `${bin}:${base.PATH ?? ""}`,
      JQ_ARG_LOG: argvLog,
      TMPDIR: scratch,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function expectCanariesAbsentFromJqArgv() {
  expect(existsSync(argvLog)).toBe(true);
  const argv = readFileSync(argvLog, "utf8");
  for (const canary of CANARIES) expect(argv).not.toContain(canary);
}

function expectCanariesOnlyInPrivateFiles() {
  const pending = [scratch];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const contents = readFileSync(path, "utf8");
      if (!CANARIES.some((canary) => contents.includes(canary))) continue;
      expect(statSync(path).mode & 0o077, `${path} contains a canary but is not private`).toBe(0);
    }
  }
}

function agyRegistry(project: string, names: string[]) {
  const registry = join(scratch, "registry.json");
  const synthetic = { command: `/synthetic/${COMMAND_CANARY}/mcp`, env: { API_KEY: CANARY } };
  writeFileSync(registry, JSON.stringify({
    mcpDefinitions: { synthetic },
    projects: { testrepo: { mcps: ["synthetic"] }, other: { mcps: names } },
  }), { mode: 0o600 });
  writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { synthetic } }), { mode: 0o600 });
  return registry;
}

describe("resolved MCP values stay off jq argv", () => {
  test("Antigravity exact workspace and declared user config maps", () => {
    const home = join(scratch, "home");
    const project = join(scratch, "project");
    const runtime = join(scratch, "runtime");
    mkdirSync(home);
    mkdirSync(project);
    mkdirSync(runtime);
    mkdirSync(join(project, ".agents"));
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    writeFileSync(
      join(project, ".agents", "mcp_config.json"),
      '{"label":"agents","mcpServers":{"existing":{"command":"agents-existing"}}}\n',
    );
    writeFileSync(
      join(home, ".gemini", "config", "mcp_config.json"),
      '{"label":"user","mcpServers":{"existing":{"command":"user-existing"}}}\n',
    );

    const registry = agyRegistry(project, ["existing"]);
    const result = runZsh(
      `function _ralph_build_mcp_config() { return 91; }
source "$1"
_golem_sync_agy_workspace testrepo "$2"`,
      [DISPATCHER, project],
      { HOME: home, XDG_RUNTIME_DIR: runtime, RALPH_REGISTRY_FILE: registry },
    );

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expectCanariesAbsentFromJqArgv();
    expect(readFileSync(join(project, ".agents", "mcp_config.json"), "utf8")).toBe(`{
  "label": "agents",
  "mcpServers": {
    "synthetic": {
      "command": "/synthetic/${COMMAND_CANARY}/mcp",
      "env": {}
    }
  }
}
`);
    expect(readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf8")).toBe(`{
  "label": "user",
  "mcpServers": {
    "existing": {
      "command": "user-existing"
    },
    "synthetic": {
      "command": "/synthetic/${COMMAND_CANARY}/mcp",
      "env": {}
    }
  }
}
`);
    expectCanariesOnlyInPrivateFiles();
  });

  test("Antigravity preserves multi-document existing configs", () => {
    const home = join(scratch, "home");
    const project = join(scratch, "project");
    const runtime = join(scratch, "runtime");
    mkdirSync(home);
    mkdirSync(project);
    mkdirSync(runtime);
    mkdirSync(join(project, ".agents"));
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });

    const agents = [
      { label: "agents-one", mcpServers: { one: { command: "agents-one" } } },
      { label: "agents-two", mcpServers: { two: { command: "agents-two" } } },
    ];
    const users = [
      { label: "user-one", mcpServers: { one: { command: "user-one" } } },
      { label: "user-two", mcpServers: { two: { command: "user-two" } } },
    ];
    writeFileSync(
      join(project, ".agents", "mcp_config.json"),
      agents.map((document) => JSON.stringify(document)).join("\n"),
    );
    writeFileSync(
      join(home, ".gemini", "config", "mcp_config.json"),
      users.map((document) => JSON.stringify(document)).join("\n"),
    );

    const synthetic = { command: `/synthetic/${COMMAND_CANARY}/mcp`, env: {} };
    const registry = agyRegistry(project, ["one", "two"]);
    const result = runZsh(
      `function _ralph_build_mcp_config() { return 91; }
source "$1"
_golem_sync_agy_workspace testrepo "$2"`,
      [DISPATCHER, project],
      {
        HOME: home,
        XDG_RUNTIME_DIR: runtime,
        RALPH_REGISTRY_FILE: registry,
      },
    );

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expectCanariesAbsentFromJqArgv();
    const expectedDocuments = (documents: typeof agents, retain = false) =>
      `${documents
        .map((document) =>
          JSON.stringify(
            { ...document, mcpServers: { ...(retain ? document.mcpServers : {}), synthetic } },
            null,
            2,
          ),
        )
        .join("\n")}\n`;
    expect(readFileSync(join(project, ".agents", "mcp_config.json"), "utf8")).toBe(
      expectedDocuments(agents),
    );
    expect(readFileSync(join(home, ".gemini", "config", "mcp_config.json"), "utf8")).toBe(
      expectedDocuments(users, true),
    );
    expectCanariesOnlyInPrivateFiles();
  });

  test("Codex profile rendering", () => {
    const home = join(scratch, "home");
    const project = join(scratch, "project");
    const codexHome = join(scratch, "codex-home");
    const captured = join(scratch, "captured.toml");
    const registry = join(scratch, "registry.json");
    mkdirSync(home);
    mkdirSync(project);
    mkdirSync(join(codexHome, "sessions"), { recursive: true });
    const mcpFile = join(project, ".mcp.json");
    const command = `/opt/${COMMAND_CANARY}/server`;
    const url = `https://mcp.invalid/mcp?key=${URL_CANARY}`;
    const timeout = `30s-${TIMEOUT_CANARY}`;
    writeFileSync(
      mcpFile,
      JSON.stringify({
        mcpServers: {
          http: { url, timeout },
          stdio: { command, env: { API_KEY: CANARY, MULTI: NASTY } },
        },
      }),
    );
    chmodSync(mcpFile, 0o600);
    writeFileSync(
      registry,
      JSON.stringify({
        projects: {
          testrepo: { path: project, mcps: [], mcpsLight: [], secrets: {}, clis: ["codex"] },
        },
      }),
    );

    const result = runZsh(
      `function _ralph_setup_mcps() { return 0; }
function _ralph_setup_secrets() { return 0; }
function _ralph_build_mcp_config() { print -r -- '{"mcpServers":{}}'; }
function _golem_setup_env() { return 0; }
function _golem_setup_title() { return 0; }
function _golem_reset_title() { return 0; }
function codex() {
  local profile
  for profile in "$CODEX_HOME"/repogolem-*.config.toml(N); do
    cp "$profile" "$CAPTURED_PROFILE"
  done
}
source "$1"
testrepoCodex -s`,
      [DISPATCHER],
      { HOME: home, CODEX_HOME: codexHome, CAPTURED_PROFILE: captured, RALPH_REGISTRY_FILE: registry },
    );

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expectCanariesAbsentFromJqArgv();
    expect(readFileSync(captured, "utf8")).toBe(`# Generated by repoGolem for project 'testrepo'. Do not edit by hand.
# Source of truth: the project's .mcp.json — regenerated on every launch.

[mcp_servers.${JSON.stringify("http")}]
url = ${JSON.stringify(url)}
timeout = ${JSON.stringify(timeout)}

[mcp_servers.${JSON.stringify("stdio")}]
command = ${JSON.stringify(command)}
[mcp_servers.${JSON.stringify("stdio")}.env]
${JSON.stringify("API_KEY")} = ${JSON.stringify(CANARY)}
${JSON.stringify("MULTI")} = ${JSON.stringify(NASTY)}
`);
    expectCanariesOnlyInPrivateFiles();
  });
});
