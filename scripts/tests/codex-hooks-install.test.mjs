import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { planCodexHooks, applyCodexHooks, codexStatus, codexCommand } from "../hooks/codex-hooks-install.mjs";

const scratchRoot = path.resolve(import.meta.dir, "../../docs.local/codex-hooks-port");
mkdirSync(scratchRoot, { recursive: true });
const dirs = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(path.join(scratchRoot, "installer-")); dirs.push(root);
  const codexHome = path.join(root, "home/.codex"); mkdirSync(codexHome, { recursive: true });
  const live = path.join(root, "repo/.worktrees/hooks-live"); mkdirSync(path.join(live, "scripts/hooks"), { recursive: true });
  writeFileSync(path.join(live, "scripts/hooks/codex-policy-hook.py"), "print('{}')");
  const entries = ["tmp-block", "git-guardian"].map(gate => ({ gate, source: "scripts/hooks/codex-policy-hook.py", matcher: "^(Bash|apply_patch)$", timeout: 10 }));
  const manifest = { codex_hosts: { mbp: entries, m1: entries } };
  writeFileSync(path.join(codexHome, "config.toml"), '# keep this comment\nmodel = "my-model"\n');
  return { root, codexHome, live, manifest, host: "mbp" };
}

test("both hosts preserve config and external hooks, backup once, install idempotently", () => {
  for (const host of ["mbp", "m1"]) {
    const f = { ...fixture(), host };
    const config = readFileSync(path.join(f.codexHome, "config.toml"));
    const external = { matcher: "Bash", hooks: [{ type: "command", command: "external-hook" }] };
    const original = JSON.stringify({ description: "preserve", hooks: { PreToolUse: [external] } });
    writeFileSync(path.join(f.codexHome, "hooks.json"), original, { mode: 0o640 });
    const p = planCodexHooks(f); expect(p.registered).toBe(false);
    applyCodexHooks(p);
    const next = planCodexHooks(f); expect(codexStatus(next)).toBe(false);
    const json = JSON.parse(next.old); expect(json.description).toBe("preserve");
    expect(json.hooks.PreToolUse[0]).toEqual(external);
    expect(readFileSync(path.join(f.codexHome, "config.toml"))).toEqual(config);
    expect(statSync(next.at).mode & 0o777).toBe(0o640);
    applyCodexHooks(next);
    expect(readdirSync(f.codexHome).filter(n => n.includes("backup")).length).toBe(1);
    expect(readFileSync(path.join(f.codexHome, readdirSync(f.codexHome).find(n => n.includes("backup"))), "utf8")).toBe(original);
  }
});

test("disabled hooks, managed-only, malformed files and symlinks refuse without writes", () => {
  for (const config of ['[features]\nhooks = false\n', 'allow_managed_hooks_only = true\n']) {
    const f = fixture(); writeFileSync(path.join(f.codexHome, "config.toml"), config);
    expect(() => applyCodexHooks(planCodexHooks(f))).toThrow("disabled");
    expect(readdirSync(f.codexHome)).toEqual(["config.toml"]);
  }
  const f = fixture(); writeFileSync(path.join(f.codexHome, "hooks.json"), "[]");
  expect(() => planCodexHooks(f)).toThrow("Invalid");
  rmSync(path.join(f.codexHome, "hooks.json"));
  symlinkSync(path.join(f.root, "missing"), path.join(f.codexHome, "hooks.json"));
  expect(() => planCodexHooks(f)).toThrow("symlink");
});

test("status catches matcher, timeout and duplicate drift; apply repairs only owned hooks", () => {
  const f = fixture(); applyCodexHooks(planCodexHooks(f));
  const at = path.join(f.codexHome, "hooks.json");
  const value = JSON.parse(readFileSync(at));
  value.hooks.PreToolUse[0].matcher = "wrong";
  value.hooks.PreToolUse[1].hooks[0].timeout = 600;
  value.hooks.PostToolUse = [structuredClone(value.hooks.PreToolUse[0])];
  writeFileSync(at, JSON.stringify(value));
  expect(codexStatus(planCodexHooks(f))).toBe(true);
  applyCodexHooks(planCodexHooks(f)); expect(codexStatus(planCodexHooks(f))).toBe(false);
});

test("shell fallback blocks missing interpreter and adapter with value-free stderr", () => {
  for (const [python, adapter] of [["/missing/PRIVATE-VALUE", "/missing/a"], ["python3", "/missing/PRIVATE-VALUE.py"]]) {
    const cmd = codexCommand(python, adapter, "tmp-block");
    const r = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("BLOCKED: Codex policy hook unavailable");
    expect(r.stderr + r.stdout).not.toContain("PRIVATE-VALUE");
  }
});

test("hooks-live CLI uses the selected manifest for both hosts despite invoking-checkout drift", () => {
  for (const host of ["mbp", "m1"]) {
    const f = fixture();
    const repo = path.join(f.root, "repo");
    const origin = path.join(f.root, "origin.git");
    const git = (...args) => {
      const r = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd: repo, encoding: "utf8" });
      if (r.status) throw new Error(r.stderr); return r.stdout.trim();
    };
    rmSync(f.live, { recursive: true, force: true });
    git("init", "-q", "-b", "master"); git("init", "-q", "--bare", origin);
    git("remote", "add", "origin", origin);
    mkdirSync(path.join(repo, "scripts/hooks"), { recursive: true });
    writeFileSync(path.join(repo, "scripts/hooks/codex-policy-hook.py"), "print('{}')\n");
    const manifest = { ...f.manifest, hosts: { mbp: [], m1: [] } };
    writeFileSync(path.join(repo, "scripts/hooks/manifest.json"), JSON.stringify(manifest));
    git("add", "."); git("commit", "-qm", "selected pin"); git("push", "-q", "origin", "HEAD:master");
    const selected = git("rev-parse", "HEAD");
    // Neither main checkout contents nor the caller's default manifest are used.
    writeFileSync(path.join(repo, "scripts/hooks/manifest.json"), "uncommitted invoking drift");
    const env = { ...process.env, HOME: path.join(f.root, "home") };
    const invoke = (...args) => spawnSync("node", [path.resolve(import.meta.dir, "../hooks/install-hooks.mjs"),
      "--host", host, "--repo", repo, ...args], { env, encoding: "utf8" });
    const before = readFileSync(path.join(f.codexHome, "config.toml"));
    const dry = invoke("--update", selected); expect(dry.status).toBe(0);
    expect(readdirSync(f.codexHome)).toEqual(["config.toml"]);
    const applied = invoke("--update", selected, "--apply"); expect(applied.status).toBe(0);
    const installed = JSON.parse(readFileSync(path.join(f.codexHome, "hooks.json")));
    expect(installed.hooks.PreToolUse.length).toBe(2);
    for (const group of installed.hooks.PreToolUse) expect(group.hooks[0].command).toContain(f.live);
    expect(readFileSync(path.join(f.codexHome, "config.toml"))).toEqual(before);
    const status = invoke("--status"); expect(status.status).toBe(0);
    expect(status.stdout).toContain("codex wiring=ok");
    const hooks = readFileSync(path.join(f.codexHome, "hooks.json"));
    expect(invoke("--apply").status).toBe(0);
    expect(readFileSync(path.join(f.codexHome, "hooks.json"))).toEqual(hooks);
    git("worktree", "unlock", f.live);
  }
});
