// repogolem-config.ts b1: `generate` is the ONLY place op:// refs resolve
// (one `op run` per run), into secrets.env beside registry.json and
// launchers.zsh: 0600 files in a 0700 dir outside every repo, each stamped
// with the config sha256. `generate --check` never resolves.
// The real `op` never runs here: REPOGOLEM_OP_BIN points at fake-op.sh, whose
// FAKE_OP_LOG line per invocation is the resolver spy.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const REPO = join(import.meta.dir, "..", "..");
const CLI = join(REPO, "scripts", "repogolem", "repogolem-config.ts");
const EXAMPLE = join(REPO, "scripts", "repogolem", "config.example.yaml");
const FAKE_OP = join(import.meta.dir, "fixtures", "repogolem-config", "fake-op.sh");
const HOST = "example-host";
// The three distinct refs example-host resolves (EXAMPLE_TOKEN twice = once).
const REFS = [
  "op://example-vault/example-item/api-key",
  "op://example-vault/example-item/token",
  "op://example-vault/example-item/webhook-secret",
];

let dir: string;
let out: string;
let config: string;
let log: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repogolem-secrets-"));
  out = join(dir, "generated");
  config = join(dir, "config.yaml");
  log = join(dir, "op.log");
  writeFileSync(config, readFileSync(EXAMPLE, "utf8"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const base = { ...process.env, REPOGOLEM_SOURCE_SHA: "0".repeat(40), REPOGOLEM_OP_BIN: FAKE_OP, FAKE_OP_LOG: log };
  delete base.REPOGOLEM_CONFIG;
  delete base.REPOGOLEM_HOST;
  const proc = Bun.spawnSync(["bun", CLI, ...args], { env: { ...base, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const generate = (extra: string[] = [], env: Record<string, string> = {}) =>
  run(["generate", "--config", config, "--out-dir", out, "--home", "/home/fixture", "--host", HOST, ...extra], env);
const check = () => generate(["--check"]);
const opCalls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0);
const mode = (path: string) => statSync(path).mode & 0o777;
const secretKey = (ref: string) => `REPOGOLEM_SECRET_${createHash("sha256").update(ref).digest("hex").slice(0, 32)}`;
const configSha = () => createHash("sha256").update(readFileSync(config)).digest("hex");

function editConfig(mutate: (c: any) => void) {
  const parsed = parseYaml(readFileSync(config, "utf8"));
  mutate(parsed);
  writeFileSync(config, stringifyYaml(parsed));
}

// What a dispatch-side reader does: source the file in a shell, read a var.
function sourceSecrets(name: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "op"), `#!/bin/sh\necho "$*" >>"${log}"\n`, { mode: 0o755 });
  const proc = Bun.spawnSync(["bash", "-c", `source "$1" && printf %s "\${!2}"`, "_", join(out, "secrets.env"), name], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    stdout: "pipe",
  });
  return proc.stdout.toString();
}

describe("generate resolves op:// refs", () => {
  test("one op session per run, every distinct ref resolved into secrets.env", () => {
    const r = generate();
    expect(r.stderr).not.toContain("repogolem-config:");
    expect(r.code).toBe(0);
    expect(opCalls()).toBe(1);
    expect(readFileSync(log, "utf8")).toMatch(/^run --no-masking -- /);

    for (const ref of REFS) expect(sourceSecrets(secretKey(ref))).toBe(`resolved:${ref}`);
    const keys = readFileSync(join(out, "secrets.env"), "utf8").match(/^REPOGOLEM_SECRET_\w+=/gm) ?? [];
    expect(keys).toHaveLength(REFS.length);
  });

  test("counts only: no resolved value on stdout or stderr", () => {
    const r = generate();
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain("resolved:");
    expect(r.stdout).toContain(`${REFS.length} op:// refs`);
  });

  test("registry.json keeps the refs, never the values", () => {
    expect(generate().code).toBe(0);
    const registry = readFileSync(join(out, "registry.json"), "utf8");
    expect(registry).toContain(REFS[1]);
    expect(registry).not.toContain("resolved:");
    expect(readFileSync(join(out, "launchers.zsh"), "utf8")).not.toContain("resolved:");
  });

  test("values with quotes, newlines and $ survive sourcing verbatim", () => {
    const suffix = "\n it's $HOME `id` \\ end";
    expect(generate([], { FAKE_OP_SUFFIX: suffix }).code).toBe(0);
    expect(sourceSecrets(secretKey(REFS[0]))).toBe(`resolved:${REFS[0]}${suffix}`);
  });

  test("no refs: secrets.env is still written and op never runs", () => {
    editConfig((c) => {
      for (const p of Object.values<any>(c.projects)) delete p.secrets;
      for (const m of Object.values<any>(c.mcpDefinitions)) delete m.env;
      delete c.global.env;
    });
    expect(generate().code).toBe(0);
    expect(opCalls()).toBe(0);
    expect(existsSync(join(out, "secrets.env"))).toBe(true);
  });

  test("op failure exits 2 and leaves the previous outputs untouched", () => {
    expect(generate().code).toBe(0);
    const before = readFileSync(join(out, "secrets.env"), "utf8");
    editConfig((c) => (c.projects["example-app"].displayName = "Changed"));
    const r = generate([], { FAKE_OP_FAIL: "1" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("nothing written");
    expect(readFileSync(join(out, "secrets.env"), "utf8")).toBe(before);
    expect(readFileSync(join(out, "registry.json"), "utf8")).not.toContain("Changed");
  });

  test("a masked value is refused, not written", () => {
    const r = generate([], { FAKE_OP_MASK: "1" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("masked");
    expect(existsSync(join(out, "secrets.env"))).toBe(false);
  });

  test("an op:// ref outside env/secrets is refused by key path", () => {
    editConfig((c) => c.mcpDefinitions.context7.args.push("op://example-vault/example-item/stray"));
    const r = generate();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("mcpDefinitions.context7.args.2");
    expect(opCalls()).toBe(0);
  });
});

describe("outputs", () => {
  test("files are 0600 and the dir 0700, even over a looser existing dir", () => {
    mkdirSync(out, { mode: 0o755 });
    chmodSync(out, 0o755);
    expect(generate().code).toBe(0);
    expect(mode(out)).toBe(0o700);
    for (const f of ["registry.json", "launchers.zsh", "secrets.env"]) expect(mode(join(out, f))).toBe(0o600);
  });

  test("each output is stamped with the config sha256 and machine", () => {
    expect(generate().code).toBe(0);
    const sha = configSha();
    const registry = JSON.parse(readFileSync(join(out, "registry.json"), "utf8"));
    expect(registry._generated.configSha256).toBe(sha);
    expect(registry._generated.machine).toBe(HOST);
    for (const f of ["launchers.zsh", "secrets.env"]) {
      const text = readFileSync(join(out, f), "utf8");
      expect(text).toContain(`# config-sha256: ${sha}`);
      expect(text).toContain(`# machine: ${HOST}`);
      expect(text).toContain(`# generator-sha: ${"0".repeat(40)}`);
    }
  });

  test("refuses an out-dir inside a git work tree", () => {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const r = run(["generate", "--config", config, "--out-dir", join(repo, "gen"), "--host", HOST]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("inside a git work tree");
    expect(existsSync(join(repo, "gen"))).toBe(false);
    expect(opCalls()).toBe(0);
  });

  test("defaults: --config from $REPOGOLEM_CONFIG, --out-dir ~/.config/repogolem/generated", () => {
    const home = join(dir, "home");
    mkdirSync(home);
    const r = run(["generate", "--host", HOST], { REPOGOLEM_CONFIG: config, HOME: home });
    expect(r.stderr).not.toContain("repogolem-config:");
    expect(r.code).toBe(0);
    expect(existsSync(join(home, ".config", "repogolem", "generated", "secrets.env"))).toBe(true);
  });
});

describe("--check", () => {
  test("fresh passes; --check and a dispatch-side read never run op", () => {
    expect(generate().code).toBe(0);
    expect(opCalls()).toBe(1);
    const r = check();
    expect(r.code).toBe(0);
    expect(sourceSecrets(secretKey(REFS[1]))).toBe(`resolved:${REFS[1]}`);
    expect(opCalls()).toBe(1);
  });

  test("a config edit exits 1 and names every stale output with the hash mismatch", () => {
    expect(generate().code).toBe(0);
    const stamped = configSha();
    editConfig((c) => (c.projects["example-app"].displayName = "Edited"));
    const r = check();
    expect(r.code).toBe(1);
    for (const f of ["registry.json", "launchers.zsh", "secrets.env"]) expect(r.stderr).toContain(join(out, f));
    expect(r.stderr).toContain(`config-sha256 ${stamped.slice(0, 12)}`);
    expect(r.stderr).toContain(configSha().slice(0, 12));
    expect(opCalls()).toBe(1);
  });

  test("a new ref makes secrets.env stale even when its stamp is rewritten", () => {
    expect(generate().code).toBe(0);
    editConfig((c) => (c.projects["example-app"].secrets.EXTRA = "op://example-vault/example-item/extra"));
    const secretsPath = join(out, "secrets.env");
    const oldSha = readFileSync(secretsPath, "utf8").match(/^# config-sha256: (\w+)$/m)?.[1] ?? "";
    writeFileSync(secretsPath, readFileSync(secretsPath, "utf8").replace(oldSha, configSha()), { mode: 0o600 });
    const r = check();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${secretsPath} (refs differ: 1 missing, 0 extra)`);
  });

  test("a loosened mode is stale", () => {
    expect(generate().code).toBe(0);
    chmodSync(join(out, "secrets.env"), 0o644);
    const r = check();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${join(out, "secrets.env")} (mode 0644, want 0600)`);
  });

  test("another machine's outputs are stale here", () => {
    expect(generate().code).toBe(0);
    const r = run(["generate", "--config", config, "--out-dir", out, "--home", "/home/fixture", "--host", "example-laptop", "--check"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("machine example-host");
  });

  test("a missing secrets.env is stale, and --check writes nothing", () => {
    expect(generate().code).toBe(0);
    rmSync(join(out, "secrets.env"));
    const r = check();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${join(out, "secrets.env")} (missing)`);
    expect(existsSync(join(out, "secrets.env"))).toBe(false);
  });
});
