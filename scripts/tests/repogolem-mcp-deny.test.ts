import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGenerated } from "../repogolem/repogolem-config";
import { runtimeMcpConfig } from "../repogolem/runtime-reader";

const root = join(import.meta.dir, "../..");
let dir: string;
const bad = { shell: { command: "sh", args: ["-c", "exec ~/.golems/bin/cmuxlayer-mcp;"] }, cmuxlayer: { command: "cmuxlayer" }, cmux: { command: "cmuxlayer-mcp" },
  homebrew: { command: "node", args: ["/opt/homebrew/Cellar/cmuxlayer/0.4.107/libexec/dist/index.js"] } };
const servers = { ...bad, safe: { command: "safe-mcp" } };
const registry = () => ({ global: { mcps: servers }, mcpDefinitions: servers,
  projects: { demo: { path: join(dir, "project"), clis: ["claude", "codex", "cursor", "gemini"],
    mcps: Object.keys(servers), mcpsLight: Object.keys(servers), mcpInheritFrom: "parent" },
    parent: { path: join(dir, "parent"), clis: ["claude"], mcps: [] } } });
beforeEach(() => {
  mkdirSync(join(root, "docs.local"), { recursive: true });
  dir = mkdtempSync(join(root, "docs.local/mcp-deny-"));
  for (const part of ["project", "parent", "home/.codex", "home/.gemini/antigravity-cli/agents"]) {
    mkdirSync(join(dir, part), { recursive: true });
  }
  writeFileSync(join(dir, "registry.json"), JSON.stringify(registry()));
  for (const part of ["project", "parent"]) writeFileSync(join(dir, part, ".mcp.json"), JSON.stringify({ mcpServers: servers }));
  writeFileSync(join(dir, "home/.gemini/antigravity-cli/agents/shell-worker.md"), "Fixture worker\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("generated registry denies global and definition aliases despite project allows", () => {
  const result = buildGenerated(JSON.stringify(registry()), join(dir, "home"), "fixture-sha", () => "fixture");
  const output = JSON.parse(result.registryJson);
  expect(Object.keys(output.global.mcps)).toEqual(["safe"]);
  expect(Object.keys(output.mcpDefinitions)).toEqual(["safe"]);
  expect(output.projects.demo.mcps).toEqual(["safe"]);
  expect(output.projects.demo.mcpsLight).toEqual(["safe"]);
  expect(result.launchersZsh).toContain(`repoGolem demo "${join(dir, "project")}" safe`);
});
test("stale runtime registry cannot restore forbidden global or project aliases", () => {
  expect(runtimeMcpConfig(registry(), "demo")).toEqual({ mcpServers: { safe: servers.safe } });
});
for (const deniedOnly of [false, true]) for (const sink of ["claude", "codex", "cursor", "gemini"]) {
  test(`${sink} dispatch emits only allowed registrations (denied-only=${deniedOnly})`, () => {
    const input = deniedOnly ? { cmuxlayer: bad.cmuxlayer } : servers;
    const expected = deniedOnly ? [] : ["safe"];
    const raw = registry();
    writeFileSync(join(dir, "registry.json"), JSON.stringify({ ...raw, global: { mcps: input }, mcpDefinitions: input,
      projects: { ...raw.projects, demo: { ...raw.projects.demo, mcps: Object.keys(input), mcpsLight: Object.keys(input) } } }));
    for (const part of ["project", "parent"]) writeFileSync(join(dir, part, ".mcp.json"), JSON.stringify({ mcpServers: input }));
    const script = `
      source "$1"
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function _golem_build_worker_prompt() { print task; }
      function _golem_inject_agent_context() { return 0; }
      function _ralph_setup_mcps() { jq '.global.mcps' "$RALPH_REGISTRY_FILE" > "$CASE_DIR/setup.json"; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { cat "$CASE_DIR/raw.json"; }
      function claude() { cp .mcp.json "$CASE_DIR/captured.json"; local prev="" arg;
        for arg in "$@"; do [[ "$prev" == --mcp-config ]] && cp "$arg" "$CASE_DIR/inherited.json"; prev="$arg"; done; }
      function cursor() { cp .mcp.json "$CASE_DIR/captured.json"; }
      function codex() { print > "$CASE_DIR/captured.toml"; local p; for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do cp "$p" "$CASE_DIR/captured.toml"; done; }
      function agy() { cp .agents/mcp_config.json "$CASE_DIR/captured.json"; }
      case "$2" in
        claude) _golem_launch_claude demo "$CASE_DIR/project" --worker ;;
        codex) _golem_launch_codex demo "$CASE_DIR/project" --worker -E high ;;
        cursor) _golem_launch_cursor demo "$CASE_DIR/project" --worker ;;
        gemini) _golem_launch_gemini demo "$CASE_DIR/project" --worker ;;
      esac
    `;
    writeFileSync(join(dir, "raw.json"), JSON.stringify({ mcpServers: input }));
    const run = Bun.spawnSync(["zsh", "-f", "-c", script, "_", join(root, "scripts/repogolem/golem-dispatch.zsh"), sink], {
      env: { ...process.env, HOME: join(dir, "home"), CODEX_HOME: join(dir, "home/.codex"), CASE_DIR: dir,
        RALPH_REGISTRY_FILE: join(dir, "registry.json"), GOLEM_ROLE: "", GOLEM_EFFORT: "", GOLEM_AGENT_ROLE: "", GOLEM_AGY_AGENT: "" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, "setup.json"), "utf8")))).toEqual(expected);
    if (sink === "codex") {
      const text = readFileSync(join(dir, "captured.toml"), "utf8");
      expect(Object.keys(Bun.TOML.parse(text).mcp_servers ?? {})).toEqual(expected);
    } else {
      expect(Object.keys(JSON.parse(readFileSync(join(dir, "captured.json"), "utf8")).mcpServers)).toEqual(expected);
      if (sink === "claude") {
        expect(Object.keys(JSON.parse(readFileSync(join(dir, "inherited.json"), "utf8")).mcpServers)).toEqual(expected);
        expect(JSON.parse(readFileSync(join(dir, "parent/.mcp.json"), "utf8")).mcpServers).toEqual(input);
      }
      if (sink === "gemini") expect(Object.keys(JSON.parse(readFileSync(join(dir, "home/.gemini/config/mcp_config.json"), "utf8")).mcpServers)).toEqual(expected);
    }
  });
}

test("failed policy preserves input and refuses a launch config", () => {
  const input = join(dir, "project/.mcp.json");
  const original = readFileSync(input, "utf8");
  const run = Bun.spawnSync(["zsh", "-f", "-c", `
    source "$1"
    _GOLEM_MCP_POLICY="$CASE_DIR/missing-policy.py"
    _golem_filter_mcp_file "$2"
  `, "_", join(root, "scripts/repogolem/dispatch/mcp-deny.zsh"), input], {
    env: { ...process.env, CASE_DIR: dir }, stdout: "pipe", stderr: "pipe",
  });
  expect(run.exitCode).not.toBe(0);
  expect(readFileSync(input, "utf8")).toBe(original);
});

test("first worktree copy drops denied registrations before publication", () => {
  const target = join(dir, "worktree");
  const original = readFileSync(join(dir, "project/.mcp.json"), "utf8");
  mkdirSync(target);
  const run = Bun.spawnSync(["zsh", "-f", "-c", `
    source "$1"
    _golem_copy_mcp_to_worktree "$2" "$3"
  `, "_", join(root, "scripts/repogolem/golem-dispatch.zsh"), join(dir, "project"), target], {
    env: { ...process.env, RALPH_REGISTRY_FILE: join(dir, "registry.json") }, stdout: "pipe", stderr: "pipe",
  });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  expect(Object.keys(JSON.parse(readFileSync(join(target, ".mcp.json"), "utf8")).mcpServers)).toEqual(["safe"]);
  expect(readFileSync(join(dir, "project/.mcp.json"), "utf8")).toBe(original);
});

test("missing launcher policy refuses install before any target writes", () => {
  const source = join(dir, "source");
  cpSync(join(root, "scripts/repogolem"), source, { recursive: true });
  rmSync(join(source, "mcp_policy.py"));
  const target = join(dir, "home/installed/golem-dispatch.zsh");
  const run = Bun.spawnSync(["zsh", join(source, "install-golem-dispatch.sh"), "--force", target], {
    env: { ...process.env, HOME: join(dir, "home") }, stdout: "pipe", stderr: "pipe",
  });
  expect(run.exitCode).not.toBe(0);
  expect(existsSync(join(dir, "home/installed"))).toBe(false);
});

test("denied-only registry and runtime remain valid and empty", () => {
  const config = { global: { mcps: { cmuxlayer: bad.cmuxlayer } }, mcpDefinitions: { cmuxlayer: bad.cmuxlayer },
    projects: { demo: { path: join(dir, "project"), clis: ["claude"], mcps: ["cmuxlayer"] } } };
  const output = JSON.parse(buildGenerated(JSON.stringify(config), join(dir, "home"), "fixture-sha", () => "fixture").registryJson);
  expect(output.global.mcps).toEqual({}); expect(output.mcpDefinitions).toEqual({});
  expect(runtimeMcpConfig(config, "demo")).toEqual({ mcpServers: {} });
});
