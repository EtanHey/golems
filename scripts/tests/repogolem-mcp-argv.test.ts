import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const DISPATCHER = join(REPO, "scripts", "repogolem", "golem-dispatch.zsh");
const CANARY = "SYNTHETIC_ARGV_SECRET_416";

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
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function expectCanaryAbsentFromJqArgv() {
  expect(existsSync(argvLog)).toBe(true);
  expect(readFileSync(argvLog, "utf8")).not.toContain(CANARY);
}

describe("resolved MCP values stay off jq argv", () => {
  test("Antigravity workspace and user config merges", () => {
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

    const mcpConfig = JSON.stringify({
      mcpServers: {
        synthetic: { command: "synthetic-mcp", env: { API_KEY: CANARY } },
      },
    });
    const result = runZsh(
      `function _ralph_build_mcp_config() { print -r -- "$MCP_CONFIG"; }
source "$1"
_golem_sync_agy_workspace testrepo "$2"`,
      [DISPATCHER, project],
      { HOME: home, XDG_RUNTIME_DIR: runtime, MCP_CONFIG: mcpConfig },
    );

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expectCanaryAbsentFromJqArgv();
    expect(readFileSync(join(project, ".agents", "mcp_config.json"), "utf8")).toBe(`{
  "label": "agents",
  "mcpServers": {
    "existing": {
      "command": "agents-existing"
    },
    "synthetic": {
      "command": "synthetic-mcp",
      "env": {
        "API_KEY": "${CANARY}"
      }
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
      "command": "synthetic-mcp",
      "env": {
        "API_KEY": "${CANARY}"
      }
    }
  }
}
`);
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
    writeFileSync(
      join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          synthetic: { command: "synthetic-mcp", env: { API_KEY: CANARY } },
        },
      }),
    );
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
    expectCanaryAbsentFromJqArgv();
    expect(readFileSync(captured, "utf8")).toContain(CANARY);
  });
});
