// repogolem-config.ts b1: config.schema.json, config.example.yaml, the
// machines: section picked by LocalHostName, and `init`.
// The example is public; the boundary tests below keep it free of real paths,
// hosts and 1Password vault/item names.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Ajv from "ajv";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO = join(import.meta.dir, "..", "..");
const DIR = join(REPO, "scripts", "repogolem");
const CLI = join(DIR, "repogolem-config.ts");
const SCHEMA = join(DIR, "config.schema.json");
const EXAMPLE = join(DIR, "config.example.yaml");
const FAKE_OP = join(import.meta.dir, "fixtures", "repogolem-config", "fake-op.sh");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repogolem-machines-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const base = { ...process.env, REPOGOLEM_SOURCE_SHA: "0".repeat(40), REPOGOLEM_OP_BIN: FAKE_OP };
  delete base.REPOGOLEM_CONFIG;
  delete base.REPOGOLEM_HOST;
  const proc = Bun.spawnSync(["bun", CLI, ...args], { env: { ...base, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const validate = () => {
  const ajv = new Ajv({ allErrors: true });
  return ajv.compile(JSON.parse(readFileSync(SCHEMA, "utf8")));
};
const example = () => parseYaml(readFileSync(EXAMPLE, "utf8"));

function withConfig(mutate: (config: any) => void) {
  const config = example();
  mutate(config);
  return config;
}

function generate(config: object | string, host: string | null, extra: string[] = []) {
  const path = join(dir, "config.yaml");
  writeFileSync(path, typeof config === "string" ? config : JSON.stringify(config));
  const hostArgs = host === null ? [] : ["--host", host];
  const r = run(["generate", "--config", path, "--out-dir", join(dir, "gen"), "--home", "/home/fixture", ...hostArgs, ...extra]);
  const registryPath = join(dir, "gen", "registry.json");
  const registry = r.code === 0 && existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : null;
  return { ...r, registry };
}

describe("config.schema.json", () => {
  test("the example validates", () => {
    const check = validate();
    expect(check(example())).toBe(true);
  });

  const rejects: [string, (c: any) => void][] = [
    ["a project without path", (c) => delete c.projects["example-app"].path],
    ["a literal (non-op://) secret", (c) => (c.projects["example-app"].secrets.EXAMPLE_TOKEN = "plain-text")],
    ["a $VAR secret", (c) => (c.projects["example-app"].secrets.EXAMPLE_TOKEN = "$EXAMPLE_TOKEN")],
    ["an op:// ref with too few segments", (c) => (c.projects["example-app"].secrets.EXAMPLE_TOKEN = "op://vault/item")],
    ["a bad env var name", (c) => (c.projects["example-app"].secrets["1BAD"] = "op://example-vault/example-item/x")],
    ["an integer-like project name", (c) => (c.projects["42"] = { path: "x" })],
    ["an unsafe path", (c) => (c.projects["example-app"].path = "app$(id)")],
    ["an unknown machine key", (c) => (c.machines["example-host"].sshAlias = "x")],
    ["an unknown overrides key", (c) => (c.machines["example-host"].overrides.seatRegistry = {})],
    ["a bad hostname", (c) => (c.machines["bad host"] = { reposPath: "~/src" })],
    ["a non-string env value", (c) => (c.global.env = { EXAMPLE_FLAG: 1 })],
  ];
  for (const [what, mutate] of rejects) {
    test(`rejects ${what}`, () => {
      expect(validate()(withConfig(mutate))).toBe(false);
    });
  }

  test("accepts shapes today's registry uses: ttydPort 0, mcpInheritFrom null", () => {
    const config = withConfig((c) => {
      c.projects["example-app"].ttydPort = 0;
      c.projects["example-app"].mcpInheritFrom = null;
    });
    expect(validate()(config)).toBe(true);
  });

  test("other top-level keys (e.g. seatRegistry) pass through", () => {
    expect(validate()(withConfig((c) => (c.seatRegistry = { aClaude: { repo: "a" } })))).toBe(true);
  });
});

// Orc approval note 2: the public example names no real vault/item, path or host.
describe("config.example.yaml boundary", () => {
  const text = readFileSync(EXAMPLE, "utf8");

  test("every op:// ref, comments included, is op://example-vault/example-item/...", () => {
    const refs = text.match(/op:\/\/[^\s"'`]*/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^op:\/\/example-vault\/example-item\/[a-z0-9_-]+$/);
  });

  test("no real paths, hosts, addresses or users", () => {
    expect(text).not.toMatch(/\/Users\/|\/home\/|\/private\/|\/var\/|[A-Z]:\\/);
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(text).not.toMatch(/\.local\b|\.ts\.net\b|[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/etan|heyman|macbook|\bm1\b/i);
  });

  test("machines are example-* and paths are relative or ~/", () => {
    const config = example();
    const hosts = Object.keys(config.machines);
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) expect(host).toMatch(/^example-/);
    for (const machine of Object.values<any>(config.machines)) expect(machine.reposPath).toMatch(/^~\//);
    for (const project of Object.values<any>(config.projects)) expect(project.path).not.toMatch(/^[/~]/);
  });
});

describe("machines", () => {
  test("--host picks the section: relative paths join its reposPath", () => {
    const r = generate(example(), "example-host");
    expect(r.stderr).not.toContain("repogolem-config:");
    expect(r.code).toBe(0);
    expect(r.registry.projects["example-app"].path).toBe("~/src/example-app");
    expect(r.registry._generated.machine).toBe("example-host");
    // The machines section itself never reaches dispatch's registry.json.
    expect(r.registry.machines).toBeUndefined();
  });

  test("REPOGOLEM_HOST picks the section when --host is absent", () => {
    const path = join(dir, "config.yaml");
    writeFileSync(path, readFileSync(EXAMPLE, "utf8"));
    const r = run(["generate", "--config", path, "--out-dir", join(dir, "gen"), "--home", "/h"], {
      REPOGOLEM_HOST: "example-laptop",
    });
    expect(r.code).toBe(0);
    const registry = JSON.parse(readFileSync(join(dir, "gen", "registry.json"), "utf8"));
    expect(registry._generated.machine).toBe("example-laptop");
    expect(registry.projects["example-app"].path).toBe("~/code/example-app");
  });

  test("an unknown host exits 2, names the host and the known ones, writes nothing", () => {
    const r = generate(example(), "nobody-here");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("nobody-here");
    expect(r.stderr).toContain("example-host");
    expect(existsSync(join(dir, "gen"))).toBe(false);
  });

  test("overrides merge per machine; null removes a project", () => {
    const host = generate(example(), "example-host").registry;
    const laptop = generate(example(), "example-laptop").registry;
    expect(Object.keys(host.projects)).toContain("example-lib");
    expect(Object.keys(laptop.projects)).not.toContain("example-lib");
    expect(laptop.projects["example-app"].mcps).toEqual(["context7"]);
    expect(host.projects["example-app"].mcps).toEqual(["context7", "example-api"]);
  });

  test("machine clis bound each project's clis", () => {
    const config = withConfig((c) => {
      c.projects["example-app"].clis = ["claude", "codex", "cursor"];
      c.projects["example-app"].launcherAliasPrefix = "exApp";
    });
    const r = generate(config, "example-laptop");
    expect(r.code).toBe(0);
    expect(r.registry.projects["example-app"].clis).toEqual(["claude"]);
    const launchers = readFileSync(join(dir, "gen", "launchers.zsh"), "utf8");
    expect(launchers).toContain("function exAppClaude()");
    expect(launchers).not.toContain("function exAppCodex()");
    expect(launchers).not.toContain("function exAppCursor()");
    expect(launchers).toContain("# machine: example-laptop");
  });

  test("a relative path with no machines section exits 2", () => {
    const r = generate(
      withConfig((c) => delete c.machines),
      null,
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("reposPath");
  });

  test("a schema violation exits 2 by key path and never echoes the value", () => {
    const config = withConfig((c) => (c.projects["example-app"].secrets.EXAMPLE_TOKEN = "hunter2-literal"));
    const r = generate(config, "example-host");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("/projects/example-app/secrets/EXAMPLE_TOKEN");
    expect(r.stdout + r.stderr).not.toContain("hunter2-literal");
  });

  test("a __proto__ key in overrides is refused, not merged", () => {
    const text = readFileSync(EXAMPLE, "utf8").replace(
      "    overrides:\n",
      "    overrides:\n      global:\n        __proto__:\n          polluted: true\n",
    );
    const r = generate(text, "example-host");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("__proto__: reserved key");
  });

  test("an override that breaks the schema is caught after the merge", () => {
    // Valid as an override (fields are optional there), invalid as a project.
    const config = withConfig((c) => (c.machines["example-host"].overrides.projects["example-new"] = { mcps: [] }));
    expect(validate()(config)).toBe(true);
    const r = generate(config, "example-host");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("effective config");
    expect(r.stderr).toContain("/projects/example-new");
    expect(r.stderr).toContain("path");
  });
});

describe("init", () => {
  test("writes the starter config to $REPOGOLEM_CONFIG with this machine's section", () => {
    const target = join(dir, "nested", "config.yaml");
    const r = run(["init", "--host", "my-box"], { REPOGOLEM_CONFIG: target });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const config = parseYaml(readFileSync(target, "utf8"));
    expect(validate()(config)).toBe(true);
    expect(Object.keys(config.machines)).toContain("my-box");
    expect(Object.keys(config.machines)).not.toContain("example-host");
    expect(statSync(target).mode & 0o777).toBe(0o600);

    // The starter generates as-is on that machine.
    const gen = run(["generate", "--out-dir", join(dir, "gen"), "--host", "my-box"], { REPOGOLEM_CONFIG: target });
    expect(gen.stderr).not.toContain("repogolem-config:");
    expect(gen.code).toBe(0);
  });

  test("--config wins over $REPOGOLEM_CONFIG", () => {
    const flag = join(dir, "flag.yaml");
    const env = join(dir, "env.yaml");
    expect(run(["init", "--config", flag, "--host", "h"], { REPOGOLEM_CONFIG: env }).code).toBe(0);
    expect(existsSync(flag)).toBe(true);
    expect(existsSync(env)).toBe(false);
  });

  test("no target: exits 2 and says to set REPOGOLEM_CONFIG", () => {
    const r = run(["init", "--host", "h"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("REPOGOLEM_CONFIG");
  });

  test("refuses to overwrite without --force; --force keeps a dated .bak", () => {
    const target = join(dir, "config.yaml");
    writeFileSync(target, "mine: true\n");
    const refused = run(["init", "--host", "h"], { REPOGOLEM_CONFIG: target });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("--force");
    expect(readFileSync(target, "utf8")).toBe("mine: true\n");

    const forced = run(["init", "--host", "h", "--force"], { REPOGOLEM_CONFIG: target });
    expect(forced.code).toBe(0);
    const baks = readdirSync(dir).filter((f) => f.startsWith("config.yaml.bak-"));
    expect(baks).toHaveLength(1);
    expect(readFileSync(join(dir, baks[0]), "utf8")).toBe("mine: true\n");
    expect(parseYaml(readFileSync(target, "utf8")).machines.h).toBeDefined();
  });
});

// global.prelaunch: user-owned shell commands golem-dispatch runs before an
// agent CLI starts. Same trust as a shell rc file; never a secrets channel.
describe("prelaunch", () => {
  const PRELAUNCH = ["ulimit -Sn 4096", "export EXAMPLE_FLAG=1"];

  test("the schema accepts a command list, an empty list, and a per-machine list or null", () => {
    const check = validate();
    expect(check(withConfig((c) => (c.global.prelaunch = PRELAUNCH)))).toBe(true);
    expect(check(withConfig((c) => (c.global.prelaunch = [])))).toBe(true);
    expect(check(withConfig((c) => (c.machines["example-host"].overrides.global = { prelaunch: ["true"] })))).toBe(true);
    expect(check(withConfig((c) => (c.machines["example-host"].overrides.global = { prelaunch: null })))).toBe(true);
  });

  const rejects: [string, (c: any) => void][] = [
    ["a bare string", (c) => (c.global.prelaunch = "ulimit -Sn 4096")],
    ["a non-string command", (c) => (c.global.prelaunch = [42])],
    ["an empty command", (c) => (c.global.prelaunch = [""])],
    ["a non-list override", (c) => (c.machines["example-host"].overrides.global = { prelaunch: "true" })],
  ];
  for (const [what, mutate] of rejects) {
    test(`the schema rejects ${what}`, () => {
      expect(validate()(withConfig(mutate))).toBe(false);
    });
  }

  test("generate carries the list into registry.json under global.prelaunch", () => {
    const r = generate(
      withConfig((c) => (c.global.prelaunch = PRELAUNCH)),
      "example-host",
    );
    expect(r.stderr).not.toContain("repogolem-config:");
    expect(r.code).toBe(0);
    expect(r.registry.global.prelaunch).toEqual(PRELAUNCH);
  });

  test("a machine override replaces the list, and null removes it", () => {
    const config = withConfig((c) => {
      c.global.prelaunch = PRELAUNCH;
      c.machines["example-host"].overrides.global = { prelaunch: ["true"] };
      c.machines["example-laptop"].overrides.global = { prelaunch: null };
    });
    expect(generate(config, "example-host").registry.global.prelaunch).toEqual(["true"]);
    const laptop = generate(config, "example-laptop").registry;
    expect(laptop.global).toBeDefined();
    expect(laptop.global.prelaunch).toBeUndefined();
  });

  test("no prelaunch in the config means no prelaunch key in registry.json", () => {
    const r = generate(example(), "example-host");
    expect(r.code).toBe(0);
    expect("prelaunch" in r.registry.global).toBe(false);
  });

  test("--check reports a prelaunch-only config edit, and a hand-edited list, as stale", () => {
    const path = join(dir, "config.yaml");
    const config = withConfig((c) => (c.global.prelaunch = PRELAUNCH));
    expect(generate(config, "example-host").code).toBe(0);
    const check = () =>
      run(["generate", "--config", path, "--out-dir", join(dir, "gen"), "--home", "/home/fixture", "--host", "example-host", "--check"]);
    expect(check().code).toBe(0);

    writeFileSync(path, JSON.stringify(withConfig((c) => (c.global.prelaunch = [...PRELAUNCH, "true"]))));
    const stale = check();
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain("registry.json");

    // Same config, registry.json list edited by hand: stamps match, content does not.
    expect(generate(config, "example-host").code).toBe(0);
    const registryPath = join(dir, "gen", "registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.global.prelaunch = ["true"];
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    const edited = check();
    expect(edited.code).toBe(1);
    expect(edited.stderr).toContain("content differs");
  });

  test("an op:// ref in a prelaunch command is refused by key path, never echoed, nothing written", () => {
    const ref = "op://example-vault/example-item/token";
    const shared = generate(
      withConfig((c) => (c.global.prelaunch = ["true", `export EXAMPLE_TOKEN="$(op read ${ref})"`])),
      "example-host",
    );
    expect(shared.code).toBe(2);
    expect(shared.stderr).toContain("global.prelaunch.1");
    expect(shared.stderr).toContain("not a secrets channel");
    expect(shared.stdout + shared.stderr).not.toContain(ref);
    expect(existsSync(join(dir, "gen"))).toBe(false);

    // In any machine's override, not only the machine being generated.
    const override = generate(
      withConfig((c) => (c.machines["example-laptop"].overrides.global = { prelaunch: [`echo ${ref}`] })),
      "example-host",
    );
    expect(override.code).toBe(2);
    expect(override.stderr).toContain("machines.example-laptop.overrides.global.prelaunch.0");
    expect(override.stdout + override.stderr).not.toContain(ref);
  });
});
