import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildGenerated } from "../repogolem/repogolem-config";
import { filterMcpJson, runtimeMcpConfig } from "../repogolem/runtime-reader";

const personal = {
  gmail: { command: "gmail-mcp" },
  driveAlias: { command: "node", args: ["/vendor/google-drive-mcp/dist/index.js"] },
};
const publisher = {
  "agent-html-publisher": { command: "node", args: ["/vendor/agent-html/mcp/server.mjs"] },
  oldAlias: { command: "sh", args: ["-c", "node /vendor/agent-html/mcp/server.mjs"] },
};
const safe = { brainlayer: { command: "brainlayer" } };
const servers = { ...personal, ...publisher, ...safe };
const registry = {
  global: { mcps: servers }, mcpDefinitions: servers,
  projects: Object.fromEntries(["coach", "orc", "orchestrator", "golems", "agenthtmlhost"].map(name =>
    [name, { path: `/fixture/${name}`, clis: ["claude", "codex"], mcps: Object.keys(servers), mcpsLight: Object.keys(servers) }])),
};

test("generator removes publisher and moves personal globals into coach/orc lanes", () => {
  const generated = buildGenerated(JSON.stringify(registry), "/fixture", "fixture", () => "fixture");
  const output = JSON.parse(generated.registryJson);
  expect(Object.keys(output.global.mcps)).toEqual(["brainlayer"]);
  expect(Object.keys(output.mcpDefinitions)).toEqual([...Object.keys(personal), "brainlayer"]);
  for (const lane of ["coach", "orc", "orchestrator"]) {
    expect(output.projects[lane].mcps).toEqual([...Object.keys(personal), "brainlayer"]);
    expect(runtimeMcpConfig(registry, lane).mcpServers).toEqual({ ...personal, ...safe });
  }
  for (const lane of ["golems", "agenthtmlhost"]) {
    expect(output.projects[lane].mcps).toEqual(["brainlayer"]);
    expect(output.projects[lane].mcpsLight).toEqual(["brainlayer"]);
    expect(runtimeMcpConfig(registry, lane).mcpServers).toEqual(safe);
  }
  expect(generated.launchersZsh).not.toContain("agent-html-publisher");
});

test("global-only personal definitions are retained for the two consuming lanes", () => {
  const config = { global: { mcps: personal }, projects: { coach: { mcps: [] }, golems: { mcps: [] } } };
  const output = JSON.parse(filterMcpJson(JSON.stringify(config), "registry"));
  expect(output.global.mcps).toEqual({});
  expect(output.projects.coach.mcps).toEqual(Object.keys(personal));
  expect(runtimeMcpConfig(output, "coach").mcpServers).toEqual(personal);
  expect(runtimeMcpConfig(output, "golems").mcpServers).toEqual({});
});

test("project/inherited configs fail closed without a personal lane", () => {
  for (const lane of ["", "golems", "coach", "orc"]) {
    const output = JSON.parse(filterMcpJson(JSON.stringify({ mcpServers: servers }), "config", lane));
    expect(output.mcpServers).toEqual(["coach", "orc"].includes(lane) ? { ...personal, ...safe } : safe);
  }
});

test("Codex global and explicit-profile aliases receive disabling overrides", () => {
  const input = '[mcp_servers.gmail]\ncommand="gmail-mcp"\n[mcp_servers.brainlayer]\ncommand="brainlayer"\n[profiles.work.mcp_servers.oldAlias]\ncommand="node"\nargs=["/vendor/agent-html/mcp/server.mjs"]\n';
  for (const lane of ["golems", "coach"]) {
    const run = Bun.spawnSync(["python3", `${import.meta.dir}/../repogolem/mcp_policy.py`, "codex-blocks", lane], { stdin: Buffer.from(input) });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toBe(lane === "coach" ? "mcp_servers.oldAlias.enabled=false\n" : "mcp_servers.gmail.enabled=false\nmcp_servers.oldAlias.enabled=false\n");
  }
});

// Run the real dispatcher with only the final CLI replaced by a capture function.
for (const client of ["claude", "codex"]) for (const lane of ["golems", "coach", "orc"]) {
  test(`${client} ${lane} launch scopes owner-global MCP registrations`, () => {
    const root = join(import.meta.dir, "../..");
    const dir = mkdtempSync(join(root, "docs.local/mcp-trim-launch-"));
    try {
      for (const part of ["home/.codex", "project", "standards"]) mkdirSync(join(dir, part), { recursive: true });
      writeFileSync(join(dir, "home/.claude.json"), JSON.stringify({ mcpServers: servers }));
      writeFileSync(join(dir, "home/.codex/config.toml"), '[mcp_servers.gmail]\ncommand="gmail-mcp"\n[mcp_servers.agent-html-publisher]\ncommand="retired"\n');
      writeFileSync(join(dir, "project/.mcp.json"), JSON.stringify({ mcpServers: servers }));
      writeFileSync(join(dir, "registry.json"), JSON.stringify({ projects: { [lane]: { path: join(dir, "project"), mcps: [] } } }));
      writeFileSync(join(dir, "standards/model-roles.json"), JSON.stringify({ roles: { "codex.implement": { model: "fixture" } } }));
      const script = `
        source "$1"
        function _golem_setup_title() { return 0; }
        function _golem_reset_title() { return 0; }
        function _golem_setup_env() { _golem_filter_mcp_file .mcp.json; }
        function _ralph_build_mcp_config() { print '{"mcpServers":{}}'; }
        function claude() { print -rl -- "$@" > "$CASE_DIR/args"; local prev="" arg;
          for arg in "$@"; do [[ "$prev" == --mcp-config ]] && cp "$arg" "$CASE_DIR/effective.json"; prev="$arg"; done; }
        function codex() { print -rl -- "$@" > "$CASE_DIR/args"; local p;
          for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do cp "$p" "$CASE_DIR/effective.toml"; done; }
        _golem_launch_$2 "$3" "$CASE_DIR/project" --worker -E medium
      `;
      const run = Bun.spawnSync(["zsh", "-f", "-c", script, "_", join(root, "scripts/repogolem/golem-dispatch.zsh"), client, lane], {
        env: { ...process.env, HOME: join(dir, "home"), CODEX_HOME: join(dir, "home/.codex"), CASE_DIR: dir,
          RALPH_REGISTRY_FILE: join(dir, "registry.json"), GOLEMS_MODEL_ROLES_ROOT: dir, GOLEM_ROLE: "", GOLEM_EFFORT: "", GOLEM_AGENT_ROLE: "" },
        stdout: "pipe", stderr: "pipe",
      });
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      const args = readFileSync(join(dir, "args"), "utf8");
      if (client === "claude") {
        expect(args).toContain("--strict-mcp-config");
        expect(JSON.parse(readFileSync(join(dir, "effective.json"), "utf8")).mcpServers).toEqual(lane === "golems" ? safe : { ...personal, ...safe });
      } else {
        expect(args).toContain("mcp_servers.agent-html-publisher.enabled=false");
        expect(args.includes("mcp_servers.gmail.enabled=false")).toBe(lane === "golems");
        const profile = Bun.TOML.parse(readFileSync(join(dir, "effective.toml"), "utf8"));
        expect(Object.keys(profile.mcp_servers ?? {}).sort()).toEqual((lane === "golems" ? Object.keys(safe) : [...Object.keys(personal), ...Object.keys(safe)]).sort());
      }
      // Launch-time policy never rewrites the owner-global configs.
      expect(JSON.parse(readFileSync(join(dir, "home/.claude.json"), "utf8")).mcpServers).toEqual(servers);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
