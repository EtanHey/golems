import { isOpCredential } from '../repogolem/repogolem-check-refs';
// repogolem-config.ts b1: `generate` is the ONLY place op:// refs resolve
// (one `op run` per run), into secrets.env beside registry.json and
// launchers.zsh: 0600 files in a 0700 dir outside every repo, each stamped
// with the config sha256. `generate --check` never resolves.
// The real `op` never runs here: REPOGOLEM_OP_BIN points at fake-op.sh, whose
// FAKE_OP_LOG line per invocation is the resolver spy.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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
  for (const key of Object.keys(base)) if (isOpCredential(key)) delete base[key];
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

// Keep the CLI's stdin pipe open. A process group lets the outer deadline
// clean up the CLI and its hanging fake op if the per-command bound regresses.
function openStdinPreflight(env: Record<string, string>, deadlineMs: number) {
  return new Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("bun", [CLI, "generate", "--config", config, "--host", HOST, "--out-dir", out, "--check-refs", "--no-prompt"], {
      detached: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, REPOGOLEM_OP_BIN: FAKE_OP, FAKE_OP_LOG: log, ...env },
    });
    let stdout = "", stderr = "", timedOut = false;
    const killGroup = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch (e: any) { if (e.code !== "ESRCH") throw e; } };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, deadlineMs);
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); killGroup(); resolve({ code, timedOut, stdout, stderr }); });
  });
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
    expect(opCalls()).toBe(5);
    expect(readFileSync(log, "utf8").split("\n").filter(line => line.startsWith("run "))).toHaveLength(1);

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

  // Daybreak R1 P3: the out-dir is checked before `op` (which may wait on
  // Touch ID), so it must be re-verified, and the writes bound to it, after.
  describe("swapped while op resolves", () => {
    const target = () => join(dir, "attacker");
    const contents = (path: string) => (existsSync(path) ? readdirSync(path) : []);
    const q = (path: string) => `'${path}'`;

    test("out-dir renamed and replaced by a symlink: exit 2, zero files anywhere", () => {
      expect(generate().code).toBe(0);
      for (const f of ["registry.json", "launchers.zsh", "secrets.env"]) rmSync(join(out, f));
      const moved = join(dir, "moved");
      const r = generate([], {
        FAKE_OP_BEFORE: `mv ${q(out)} ${q(moved)} && mkdir ${q(target())} && ln -s ${q(target())} ${q(out)}`,
      });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("nothing written");
      expect(contents(target())).toEqual([]);
      expect(contents(moved)).toEqual([]);
    });

    test("missing out-dir created as a symlink: exit 2, zero files", () => {
      const r = generate([], { FAKE_OP_BEFORE: `mkdir ${q(target())} && ln -s ${q(target())} ${q(out)}` });
      expect(r.code).toBe(2);
      expect(contents(target())).toEqual([]);
    });

    test("a parent swapped for a symlink into a git repo: exit 2, nothing in the repo", () => {
      const parent = join(dir, "cfg");
      const nested = join(parent, "generated");
      const repo = join(dir, "repo");
      const r = run(["generate", "--config", config, "--out-dir", nested, "--host", HOST], {
        FAKE_OP_BEFORE: `mkdir -p ${q(join(repo, ".git"))} ${q(join(repo, "cfg"))} && ln -s ${q(join(repo, "cfg"))} ${q(parent)}`,
      });
      expect(r.code).toBe(2);
      expect(contents(join(repo, "cfg"))).toEqual([]);
    });
  });

  test("refuses a symlinked parent it does not trust, before op runs", () => {
    const real = join(dir, "real");
    mkdirSync(real);
    symlinkSync(real, join(dir, "link"));
    const r = run(["generate", "--config", config, "--out-dir", join(dir, "link", "gen"), "--host", HOST]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("symlink");
    expect(opCalls()).toBe(0);
    expect(existsSync(join(real, "gen"))).toBe(false);
  });

  test("refuses a group/other-writable parent unless it is sticky", () => {
    const open = join(dir, "open");
    mkdirSync(open);
    chmodSync(open, 0o777);
    const r = run(["generate", "--config", config, "--out-dir", join(open, "gen"), "--host", HOST]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("writable by others");
    expect(opCalls()).toBe(0);

    // Shell chmod: Bun's chmodSync drops the sticky bit (Node keeps it).
    expect(Bun.spawnSync(["chmod", "1777", open]).exitCode).toBe(0);
    expect(statSync(open).mode & 0o1000).toBe(0o1000);
    const sticky = run(["generate", "--config", config, "--out-dir", join(open, "gen"), "--host", HOST]);
    expect(sticky.stderr).not.toContain("repogolem-config:");
    expect(sticky.code).toBe(0);
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
    expect(opCalls()).toBe(5);
    const r = check();
    expect(r.code).toBe(0);
    expect(sourceSecrets(secretKey(REFS[1]))).toBe(`resolved:${REFS[1]}`);
    expect(opCalls()).toBe(5);
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
    expect(opCalls()).toBe(5);
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

describe("generate from a transferred secret cache", () => {
  test("uses cached bytes without op and preserves quoting and private modes", () => {
    expect(generate([], { FAKE_OP_SUFFIX: "\n '$HOME `id` \\" }).code).toBe(0);
    const cache = join(out, "secrets.env");
    const target = join(dir, "remote");
    const r = run(["generate", "--config", config, "--host", HOST, "--out-dir", target, "--secrets-from", cache]);
    expect(r.code).toBe(0);
    expect(opCalls()).toBe(5);
    expect(readFileSync(join(target, "secrets.env"), "utf8")).toBe(readFileSync(cache, "utf8"));
    expect(mode(target)).toBe(0o700);
    expect(mode(join(target, "secrets.env"))).toBe(0o600);
    expect(r.stdout + r.stderr).not.toContain("resolved:");
  });
  test("stale, permissive, missing and executable cache data fail before writes", () => {
    expect(generate().code).toBe(0);
    const cache = join(out, "secrets.env");
    const original = readFileSync(cache, "utf8");
    const attempt = () => run(["generate", "--config", config, "--host", HOST, "--out-dir", join(dir, "remote"), "--secrets-from", cache]);
    for (const text of [original.replace(`# machine: ${HOST}`, "# machine: wrong-host"), original.replace(/^REPOGOLEM_SECRET_.*$/m, ""), original + "echo secret-value\n"]) {
      writeFileSync(cache, text);
      expect(attempt().code).toBe(2);
      expect(existsSync(join(dir, "remote"))).toBe(false);
    }
    writeFileSync(cache, original);
    chmodSync(cache, 0o644);
    expect(attempt().code).toBe(2);
    expect(opCalls()).toBe(5);
  });
  test("generated launchers bootstrap the shipped runtime, without Ralph", () => {
    expect(generate().code).toBe(0);
    const text = readFileSync(join(out, "launchers.zsh"), "utf8");
    expect(text).toContain('repogolem/runtime/runtime.zsh');
    expect(text).not.toContain('ralphtools/ralph.zsh');
  });
});

// Metadata preflight is read-only and must never run the resolver.
describe("generate --check-refs", () => {
  const preflight = (env: Record<string, string> = {}, extra: string[] = []) => generate(["--check-refs", ...extra], env);
  const canary = "SYNTHETIC_FIELD_VALUE_MUST_NOT_PRINT";
  test("lists names grouped by vault, lists items once per vault and writes nothing", () => {
    const r = preflight({ FAKE_OP_CANARY: canary });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("example-vault:");
    for (const ref of REFS) expect(r.stdout).toContain(ref.slice("op://example-vault/".length));
    expect(r.stdout + r.stderr).not.toContain(canary);
    expect(existsSync(out)).toBe(false);
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    expect(calls.filter(line => line.startsWith("item list "))).toHaveLength(1);
    expect(calls.filter(line => line.startsWith("item get "))).toHaveLength(1);
    expect(calls.some(line => /^(run|read) /.test(line))).toBe(false);
  });
  test("a missing vault exits2 and lists every affected ref without values", () => {
    const r = preflight({ FAKE_OP_MISSING_VAULT: "example-vault", FAKE_OP_CANARY: canary });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("missing vault: example-vault");
    for (const ref of REFS) expect(r.stderr).toContain(ref.slice(5));
    expect(r.stdout + r.stderr).not.toContain(canary);
    expect(existsSync(out)).toBe(false);
  });
  test("a missing item exits2; sign-in failure exits3 without prompting or echoing errors", () => {
    const missing = preflight({ FAKE_OP_MISSING_ITEM: "example-item", FAKE_OP_CANARY: canary });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("missing item: example-vault/example-item");
    const unsigned = preflight({ FAKE_OP_UNSIGNED: "1", FAKE_OP_CANARY: canary }, ["--no-prompt"]);
    expect(unsigned.code).toBe(3);
    expect(unsigned.stderr).toContain("not signed in");
    expect(missing.stdout + missing.stderr + unsigned.stdout + unsigned.stderr).not.toContain(canary);
    expect(existsSync(out)).toBe(false);
  });
  for (const noPrompt of [true]) {
    test(`unsigned ${noPrompt ? "automation" : "interactive"} preflight names terminal sign-in before retry`, () => {
      const r = preflight({ FAKE_OP_UNSIGNED: "1", FAKE_OP_CANARY: canary }, noPrompt ? ["--no-prompt"] : []);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain(noPrompt
        ? "non-interactive access (desktop integration is disabled); export a CLI session (eval $(op signin) on a manually added account) or OP_SERVICE_ACCOUNT_TOKEN, then retry --check-refs --no-prompt"
        : "run op signin first, then retry --check-refs");
      expect(r.stderr).toContain("Nothing written.");
      expect(r.stdout + r.stderr).not.toContain(canary);
      expect(existsSync(out)).toBe(false);
      expect(readFileSync(log, "utf8").trim()).toBe("whoami --format json");
    });
  }
  test("metadata commands have biometric integration off and stdin at EOF", () => {
    expect(preflight({ FAKE_OP_REQUIRE_NONINTERACTIVE: "1" }, ["--no-prompt"]).code).toBe(0);
    expect(preflight({ FAKE_OP_REQUIRE_NONINTERACTIVE: "1", OP_BIOMETRIC_UNLOCK_ENABLED: "true" }).code).toBe(0);
  });
  test("collects and checks global plus selected-machine override refs by title/id", () => {
    editConfig(c => {
      c.global.env.GLOBAL_TOKEN = "op://example-vault/global-item/token";
      c.machines[HOST].overrides.global = { env: { MACHINE_TOKEN: "op://machine-vault/machine-id/token" } };
      c.machines['example-laptop'].overrides.global = { env: { OTHER_TOKEN: "op://other-vault/other-item/token" } };
    });
    const env = {
      FAKE_OP_VAULTS: JSON.stringify([{ id: "synthetic-vault", name: "example-vault" }, { id: "machine-vault", name: "machine-name" }]),
      FAKE_OP_ITEMS: JSON.stringify([{ id: "synthetic-item", title: "example-item" }, { id: "global-id", title: "global-item" }, { id: "machine-id", title: "machine-title" }]),
    };
    const r = preflight(env);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("global-item/token");
    expect(r.stdout).toContain("machine-id/token");
    expect(r.stdout).not.toContain("other-item");
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("item list --vault example-vault --format json");
    expect(calls).toContain("item list --vault machine-vault --format json");
    for (const missing of ["global-item", "machine-id"]) {
      const failed = preflight({ ...env, FAKE_OP_ITEMS: JSON.stringify(JSON.parse(env.FAKE_OP_ITEMS).filter((v: any) => v.title !== missing && v.id !== missing)) });
      expect(failed.code).toBe(2);
      expect(failed.stderr).toContain(`/${missing}`);
    }
  });
  test("no-prompt completes with a pipe held open, without inheriting stdin", async () => {
    const r = await openStdinPreflight({ FAKE_OP_REQUIRE_NONINTERACTIVE: "1" }, 2500);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(existsSync(out)).toBe(false);
  });
  test("an archived item referenced by ID is missing for generation", () => {
    editConfig(c => { c.global.env.ARCHIVED_TOKEN = "op://example-vault/archived-item-id/token"; });
    const r = preflight({ FAKE_OP_ARCHIVED_ID: "1", FAKE_OP_CANARY: canary });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("missing item: example-vault/archived-item-id");
    expect(r.stderr).toContain("example-vault/archived-item-id/token");
    expect(r.stdout + r.stderr).not.toContain(canary);
    expect(readFileSync(log, "utf8")).not.toContain("--include-archive");
    expect(existsSync(out)).toBe(false);
  });
  test("a hanging op is bounded before the outer deadline", async () => {
    const r = await openStdinPreflight({ FAKE_OP_HANG: "1" }, 19_000);
    expect(r.timedOut).toBe(false);
    expect(r.code).not.toBe(0);
    expect(opCalls()).toBe(1);
    expect(existsSync(out)).toBe(false);
  }, 22_000);
  test("item metadata projection accesses only title/id, never fields or other properties", async () => {
    const { itemNames } = await import("../repogolem/repogolem-check-refs");
    const metadata = new Proxy({ id: "item-id", title: "item-title" }, {
      get(target, key) { if (key !== "id" && key !== "title") throw new Error("field access forbidden"); return Reflect.get(target, key); },
    });
    expect([...itemNames([metadata])]).toEqual(["item-id", "item-title"]);
  });
  test("rejects conflicting check/cache flags and skips op when there are no refs", () => {
    const help = generate(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--no-prompt");
    expect(help.stdout).toContain("allows Touch ID");
    expect(preflight({}, ["--check"]).code).toBe(2);
    expect(preflight({}, ["--secrets-from", "unused"]).code).toBe(2);
    expect(generate(["--no-prompt"]).code).toBe(2);
    editConfig(c => { for (const p of Object.values<any>(c.projects)) delete p.secrets; for (const m of Object.values<any>(c.mcpDefinitions)) delete m.env; delete c.global.env; });
    expect(preflight().code).toBe(0);
    expect(opCalls()).toBe(0);
    expect(existsSync(out)).toBe(false);
  });
});

test("check-refs preserves existing cache bytes and modes", () => {
  mkdirSync(out);
  for (const name of ["registry.json", "launchers.zsh", "secrets.env"]) writeFileSync(join(out, name), "unchanged-sentinel", { mode: 0o644 });
  const r = generate(["--check-refs"]);
  expect(r.code).toBe(0);
  for (const name of ["registry.json", "launchers.zsh", "secrets.env"]) {
    expect(readFileSync(join(out, name), "utf8")).toBe("unchanged-sentinel");
    expect(mode(join(out, name))).toBe(0o644);
  }
});

test('Bun emitter startup receives resolved refs but no op credentials', () => {
  const preload = join(dir, 'preload.ts'), proof = join(dir, 'emitter.json');
  writeFileSync(join(dir, 'bunfig.toml'), 'preload = ["./preload.ts"]\n');
  writeFileSync(preload, `if (process.env.REPOGOLEM_REF_COUNT) require('node:fs').writeFileSync(process.env.PROOF_PATH, JSON.stringify({credential: Object.keys(process.env).some(k => k === 'OP_SERVICE_ACCOUNT_TOKEN' || k === 'OP_SESSION' || (k.startsWith('OP_SESSION_') && !['OP_SESSION_TIMEOUT', 'OP_SESSION_DELEGATION_ENABLED'].includes(k))), resolved: process.env.REPOGOLEM_REF_0?.startsWith('resolved:')}));`);
  const base = { ...process.env }; for (const key of Object.keys(base)) if (isOpCredential(key)) delete base[key];
  const resolver = join(REPO, 'scripts/repogolem/repogolem-secrets.ts');
  const proc = Bun.spawnSync([process.execPath, '-e', `import {opResolver} from ${JSON.stringify(resolver)}; opResolver(${JSON.stringify(FAKE_OP)})(['op://example-vault/example-item/token']);`], {
    cwd: dir, env: { ...base, OP_SESSION_fixture: 'SYNTHETIC', OP_SERVICE_ACCOUNT_TOKEN: 'SYNTHETIC_SERVICE', PROOF_PATH: proof }, stdout: 'pipe', stderr: 'pipe',
  });
  expect(proc.exitCode).toBe(0); expect(JSON.parse(readFileSync(proof, 'utf8'))).toEqual({ credential: false, resolved: true });
});
