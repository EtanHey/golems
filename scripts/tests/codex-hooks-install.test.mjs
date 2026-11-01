import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { planCodexHooks, applyCodexHooks, codexStatus, codexCommand } from "../hooks/codex-hooks-install.mjs";
import { checkReleaseHooks } from "../hooks/release-self-check.mjs";

const scratchRoot = path.resolve(import.meta.dir, "../../docs.local/codex-hooks-port");
mkdirSync(scratchRoot, { recursive: true });
const dirs = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(path.join(scratchRoot, "installer-")); dirs.push(root);
  const codexHome = path.join(root, "home/.codex"); mkdirSync(codexHome, { recursive: true });
  const live = path.join(root, "repo/.worktrees/hooks-live"); mkdirSync(path.join(live, "scripts/hooks"), { recursive: true });
  writeFileSync(path.join(live, "scripts/hooks/codex-policy-hook.py"), "print('{}')");
  writeFileSync(path.join(live, "scripts/hooks/codex-gate.sh"), readFileSync(path.resolve(import.meta.dir, "../hooks/codex-gate.sh")));
  const entries = ["tmp-block", "git-guardian"].map(gate => ({ gate, source: "scripts/hooks/codex-policy-hook.py", matcher: "^(Bash|apply_patch)$", timeout: 10 }));
  const manifest = { codex_hosts: { mbp: entries, m1: entries } };
  writeFileSync(path.join(codexHome, "config.toml"), '# keep this comment\nmodel = "my-model"\n');
  return { root, codexHome, live, manifest, host: "mbp" };
}

const repo = path.resolve(import.meta.dir, "../..");
const realManifest = JSON.parse(readFileSync(path.join(repo, "scripts/hooks/manifest.json"), "utf8"));
for (const host of Object.keys(realManifest.codex_hosts)) {
  test(`real hook manifest plans every Codex gate for ${host} without writes`, () => {
    const f = fixture();
    const config = readFileSync(path.join(f.codexHome, "config.toml"));
    const plan = planCodexHooks({ ...f, host, manifest: realManifest, live: repo });
    expect(plan.source).toBe(true);
    const groups = JSON.parse(plan.next).hooks.PreToolUse;
    expect(groups.length).toBe(realManifest.codex_hosts[host].length);
    const names = {
      "tmp-block": "golems tmp-block: keeps work out of /tmp",
      "git-guardian": "golems git-guardian: stops destructive git commands",
      "human-confirm": "golems human-confirm: Etan approves actions that can't be undone",
      "heredoc-guard": "golems heredoc-guard: stops hidden commands in here-documents",
      "m1-window-gate": "golems m1-window-gate: waits while the M1 is installing",
    };
    expect(groups.map(g => g.hooks[0].statusMessage)).toEqual(realManifest.codex_hosts[host].map(e => names[e.gate]));
    expect(groups.map(g => g.matcher)).toEqual(realManifest.codex_hosts[host].map(e => e.matcher));
    expect(gatesIn(plan)).toContain("heredoc-guard");
    expect(readFileSync(path.join(f.codexHome, "config.toml"))).toEqual(config);
    expect(readdirSync(f.codexHome)).toEqual(["config.toml"]);
  });
}

test("Codex matcher validation requires the standard matcher for every gate", () => {
  const f = fixture();
  for (const gate of ["heredoc-guard", "tmp-block"]) {
    const manifest = structuredClone(realManifest);
    manifest.codex_hosts.mbp.find(e => e.gate === gate).matcher = "^Bash$";
    expect(() => planCodexHooks({ ...f, manifest })).toThrow("Invalid Codex policy entry");
  }
});

function releaseCheckFixture() {
  const f = fixture();
  const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
  const options = { source: repo, python: "python3", home: path.dirname(f.codexHome),
    entries: structuredClone(realManifest.hosts.client),
    expand: command => command.replaceAll("{python}", "python3").replaceAll("{live}", quote(repo)) };
  return { f, options };
}

test("release self-check exercises allow and deny for all four gates on both harnesses", () => {
  const { options } = releaseCheckFixture();
  const logs = [];
  const log = console.log;
  try {
    console.log = value => logs.push(value);
    checkReleaseHooks(options);
  } finally { console.log = log; }
  expect(logs).toEqual(["public hook self-tests: PASS (16 specimens)"]);
});

test("release self-check refuses a missing heredoc registration", () => {
  const { options } = releaseCheckFixture();
  options.entries = options.entries.filter(e => e.id !== "heredoc-guard");
  expect(() => checkReleaseHooks(options)).toThrow("public hook self-tests: missing heredoc-guard");
});

test("release self-check refuses a heredoc hook that allows its denied JSON specimen", () => {
  const { f, options } = releaseCheckFixture();
  const hook = path.join(f.root, "broken-heredoc.py");
  writeFileSync(hook, "print('{}')\n");
  options.entries.find(e => e.id === "heredoc-guard").command = `python3 -I -B '${hook}'`;
  expect(() => checkReleaseHooks(options)).toThrow("public hook self-tests: REFUSED heredoc-guard/claude/deny");
});

test("both hosts preserve config and external hooks, backup once, install idempotently", () => {
  for (const host of ["mbp", "m1"]) {
    const f = { ...fixture(), host };
    const config = readFileSync(path.join(f.codexHome, "config.toml"));
    const external = { matcher: "Bash", hooks: [{ type: "command", command: "external-hook" }] };
    const original = JSON.stringify({ description: "preserve", hooks: { PreToolUse: [external] } });
    writeFileSync(path.join(f.codexHome, "hooks.json"), original, { mode: 0o640 });
    const p = planCodexHooks(f); expect(p.registered).toBe(false);
    applyCodexHooks(p);
    const next = planCodexHooks(f); expect(next.registered).toBe(true);
    const json = JSON.parse(next.old); expect(json.description).toBe("preserve");
    expect(json.hooks.PreToolUse[0]).toEqual(external);
    expect(readFileSync(path.join(f.codexHome, "config.toml"))).toEqual(config);
    expect(statSync(next.at).mode & 0o777).toBe(0o640);
    applyCodexHooks(next);
    expect(readdirSync(f.codexHome).filter(n => n.includes("backup")).length).toBe(1);
    expect(readFileSync(path.join(f.codexHome, readdirSync(f.codexHome).find(n => n.includes("backup"))), "utf8")).toBe(original);
  }
});

test("disabled hooks including legacy alias, malformed files and symlinks refuse without writes", () => {
  for (const config of ['[features]\nhooks = false\n', '[features]\ncodex_hooks = false\n']) {
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

test("live hooks.json and Codex home symlinks refuse without touching their targets", () => {
  for (const homeLink of [false, true]) {
    const f = fixture(); const target = path.join(f.root, homeLink ? "target-dir" : "target.json");
    const at = homeLink ? f.codexHome : path.join(f.codexHome, "hooks.json");
    if (homeLink) { mkdirSync(target); rmSync(at, { recursive: true }); }
    else writeFileSync(target, '{"private":"synthetic"}');
    symlinkSync(target, at);
    expect(() => planCodexHooks(f)).toThrow("non-regular");
    if (homeLink) expect(readdirSync(target)).toEqual([]);
    else expect(readFileSync(target, "utf8")).toBe('{"private":"synthetic"}');
  }
});

test("status checks positional persistent trust without claiming hash verification", () => {
  const f = fixture();
  writeFileSync(path.join(f.codexHome, "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [
    { matcher: "Bash", hooks: [{ type: "command", command: "external-hook" }] },
  ] } }));
  applyCodexHooks(planCodexHooks(f));
  expect(codexStatus(planCodexHooks(f))).toBe(true);
  const config = path.join(f.codexHome, "config.toml");
  const states = [1, 2].map(i => `[hooks.state.${JSON.stringify(path.join(f.codexHome, "hooks.json") + ':pre_tool_use:' + i + ':0')}]\ntrusted_hash = "synthetic-unverified-hash"\n`);
  writeFileSync(config, states.join("\n"));
  expect(planCodexHooks(f).trust).toBe("present-unverified");
  expect(codexStatus(planCodexHooks(f))).toBe(false);
  writeFileSync(config, states[0] + "enabled = false\n" + states[1]);
  expect(planCodexHooks(f).trust).toBe("disabled");
  expect(codexStatus(planCodexHooks(f))).toBe(true);
  writeFileSync(config, states[0]);
  expect(planCodexHooks(f).trust).toBe("missing");
  expect(codexStatus(planCodexHooks(f))).toBe(true);
});

test("managed-only is a requirements setting rather than a config.toml feature", () => {
  const f = fixture(); writeFileSync(path.join(f.codexHome, "config.toml"), "allow_managed_hooks_only = true\n");
  expect(planCodexHooks(f).enabled).toBe(true);
});

test("status catches matcher, timeout and duplicate drift; apply repairs only owned hooks", () => {
  const f = fixture(); applyCodexHooks(planCodexHooks(f));
  const at = path.join(f.codexHome, "hooks.json");
  const value = JSON.parse(readFileSync(at));
  value.hooks.PreToolUse[0].hooks[0].statusMessage = "wrong";
  writeFileSync(at, JSON.stringify(value));
  expect(planCodexHooks(f).registered).toBe(false);
  value.hooks.PreToolUse[0].matcher = "wrong";
  value.hooks.PreToolUse[1].hooks[0].timeout = 600;
  value.hooks.PostToolUse = [structuredClone(value.hooks.PreToolUse[0])];
  writeFileSync(at, JSON.stringify(value));
  expect(codexStatus(planCodexHooks(f))).toBe(true);
  applyCodexHooks(planCodexHooks(f)); expect(planCodexHooks(f).registered).toBe(true);
});

test("shell fallback blocks missing interpreter and adapter with value-free stderr", () => {
  for (const python of ["/missing/PRIVATE-VALUE", "python3"]) {
    const f = fixture();
    const adapter = path.join(f.live, "scripts/hooks/PRIVATE-VALUE.py");
    const cmd = codexCommand(python, adapter, "tmp-block");
    const r = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Blocked: a golems safety check couldn't run. Ask the lead to reinstall the hooks.");
    expect(r.stderr + r.stdout).not.toContain("PRIVATE-VALUE");
  }
});

// spawns the installer CLI once per host; ~5 s under fleet load
test("hooks-live CLI uses the selected manifest for both hosts despite invoking-checkout drift", () => {
  for (const host of ["mbp", "m1"]) {
    const f = fixture();
    const defaultHome = f.codexHome;
    f.codexHome = path.join(f.root, "alternate-codex"); mkdirSync(f.codexHome);
    writeFileSync(path.join(f.codexHome, "config.toml"), readFileSync(path.join(defaultHome, "config.toml")));
    const repo = path.join(f.root, "repo");
    const origin = path.join(f.root, "origin.git");
    const git = (...args) => {
      const r = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", ...args], { cwd: repo, encoding: "utf8" });
      if (r.status) throw new Error(r.stderr); return r.stdout.trim();
    };
    rmSync(f.live, { recursive: true, force: true });
    git("init", "-q", "-b", "master"); git("init", "-q", "--bare", origin);
    git("remote", "add", "origin", origin);
    mkdirSync(path.join(repo, "scripts/hooks"), { recursive: true });
    writeFileSync(path.join(repo, "scripts/hooks/codex-policy-hook.py"), "print('{}')\n");
    writeFileSync(path.join(repo, "scripts/hooks/codex-gate.sh"), readFileSync(path.resolve(import.meta.dir, "../hooks/codex-gate.sh")));
    const manifest = { ...f.manifest, hosts: { mbp: [], m1: [] } };
    writeFileSync(path.join(repo, "scripts/hooks/manifest.json"), JSON.stringify(manifest));
    git("add", "."); git("commit", "-qm", "selected pin"); git("push", "-q", "origin", "HEAD:master");
    const selected = git("rev-parse", "HEAD");
    const privateRoot = path.join(repo, "docs.local/private-guard-suites"); mkdirSync(privateRoot, { recursive: true });
    const file = path.join(privateRoot, "test_fixture.py");
    writeFileSync(file, "import pytest\nparametrize=pytest.mark.parametrize\n@parametrize('i',range(96))\ndef test_fixture(i):\n    assert i >= 0\n");
    writeFileSync(path.join(privateRoot, "manifest.json"), JSON.stringify({ version:2, expectedCases:96,
      fixtures:[{path:file,sha256:createHash("sha256").update(readFileSync(file)).digest("hex")}],dependencies:[] }));
    // Neither main checkout contents nor the caller's default manifest are used.
    writeFileSync(path.join(repo, "scripts/hooks/manifest.json"), "uncommitted invoking drift");
    const env = { ...process.env, HOME: path.join(f.root, "home"), CODEX_HOME: f.codexHome,
      GOLEMS_HEAVY_LOCK: path.join(f.root, "fixture-heavy.lock"), GOLEMS_HEAVY_MIN_FREE_GB: "0", GOLEMS_WORKTREE_MIN_FREE_GB: "0" };
    const bin = path.join(f.root, "machine-bin"); mkdirSync(bin);
    writeFileSync(path.join(bin, "scutil"), `#!/bin/sh\nprintf '%s\\n' '${host === "mbp" ? "MacBook-Pro" : "Locals-MacBook-Pro"}'\n`, { mode: 0o755 });
    env.PATH = `${bin}:${env.PATH}`;
    delete env.GOLEMS_HEAVY_SUITE_HELD;
    const invoke = (...args) => spawnSync("node", [path.resolve(import.meta.dir, "../hooks/install-hooks.mjs"),
      "--host", host, "--repo", repo, ...args], { env, encoding: "utf8" });
    const before = readFileSync(path.join(f.codexHome, "config.toml"));
    const dry = invoke("--update", selected); expect(dry.status).toBe(0);
    expect(readdirSync(f.codexHome)).toEqual(["config.toml"]);
    const applied = invoke("--update", selected, "--apply"); expect(applied.status).toBe(0);
    expect(applied.stdout).toContain("plain codex with no --profile");
    const installed = JSON.parse(readFileSync(path.join(f.codexHome, "hooks.json")));
    expect(installed.hooks.PreToolUse.length).toBe(2);
    for (const group of installed.hooks.PreToolUse) expect(group.hooks[0].command).toContain(f.live);
    expect(readFileSync(path.join(f.codexHome, "config.toml"))).toEqual(before);
    expect(readdirSync(defaultHome)).toEqual(["config.toml"]);
    const status = invoke("--status"); expect(status.status).toBe(1);
    expect(status.stdout).toContain("codex wiring=ok");
    expect(status.stdout).toContain("trust=missing");
    const hooks = readFileSync(path.join(f.codexHome, "hooks.json"));
    expect(invoke("--apply").status).toBe(0);
    expect(readFileSync(path.join(f.codexHome, "hooks.json"))).toEqual(hooks);
    git("worktree", "unlock", f.live);
  }
}, 20_000);

test("codexCommand is short and its launcher retains isolated Python flags", () => {
  expect(codexCommand("/chosen/python", "/live/scripts/hooks/codex-policy-hook.py", "git-guardian"))
    .toBe("'/bin/sh' '/live/scripts/hooks/codex-gate.sh' 'git-guardian' '/chosen/python' 'codex-policy-hook.py'");
  expect(readFileSync(path.join(repo, "scripts/hooks/codex-gate.sh"), "utf8")).toContain('"$python" -I -B');
});

for (const body of ["raise RuntimeError('PRIVATE-VALUE')", "raise SystemExit(3)"]) {
  test(`shell fallback denies a broken adapter: ${body}`, () => {
    const f = fixture();
    const adapter = path.join(f.live, "scripts/hooks/codex-policy-hook.py");
    writeFileSync(adapter, body);
    const r = spawnSync("/bin/sh", ["-c", codexCommand("python3", adapter, "tmp-block")], { encoding: "utf8" });
    expect([r.status, r.stdout, r.stderr.trim()]).toEqual([2, "", "Blocked: a golems safety check couldn't run. Ask the lead to reinstall the hooks."]);
  });
}

// human-confirm on Codex: a third adapter gate, registered only while pinned.
const PIN = "skills/golem-powers/human-confirm-gate/anchor.pins";
function confirmFixture() {
  const f = fixture();
  const entries = [...f.manifest.codex_hosts.mbp, { gate: "human-confirm", source: "scripts/hooks/codex-policy-hook.py",
    matcher: "^(Bash|apply_patch)$", timeout: 10, requiresPin: PIN }];
  return { ...f, manifest: { codex_hosts: { mbp: entries, m1: entries } } };
}
const gatesIn = (p) => JSON.parse(p.next).hooks.PreToolUse.flatMap((g) => g.hooks).map((h) => h.command.match(/codex-gate\.sh' '([a-z0-9-]+)/)?.[1]).sort();

test("human-confirm registers as a third Codex gate; refused while unpinned, and an existing registration is stripped", () => {
  const f = confirmFixture();
  let p = planCodexHooks(f);
  expect(gatesIn(p)).toEqual(["git-guardian", "human-confirm", "tmp-block"]);
  applyCodexHooks(p);
  expect(planCodexHooks(f).registered).toBe(true);
  p = planCodexHooks({ ...f, refused: ["human-confirm"] });
  expect(p.registered).toBe(false);
  expect(gatesIn(p)).toEqual(["git-guardian", "tmp-block"]);
  applyCodexHooks(p);
  expect(planCodexHooks({ ...f, refused: ["human-confirm"] }).registered).toBe(true);
});

test("the Codex manifest pins the gate set: human-confirm needs its anchor pin, nothing else may claim one", () => {
  const f = confirmFixture();
  const bad = (mutate) => {
    const entries = structuredClone(f.manifest.codex_hosts.mbp); mutate(entries);
    return () => planCodexHooks({ ...f, manifest: { codex_hosts: { mbp: entries, m1: entries } } });
  };
  expect(bad((e) => { delete e[2].requiresPin; })).toThrow("Invalid Codex policy entry");
  expect(bad((e) => { e[0].requiresPin = PIN; })).toThrow("Invalid Codex policy entry");
  expect(bad((e) => { e[2].gate = "other-gate"; })).toThrow("Invalid Codex policy entry");
  expect(bad((e) => { e.splice(0, 1); })).toThrow("Invalid Codex policy manifest");
});

test("M1 window is an owner-only Bash registration alongside the pinned gate set", () => {
  const f = confirmFixture();
  const entry = { gate: "m1-window-gate", source: "scripts/hooks/codex-policy-hook.py", matcher: "^Bash$", timeout: 10 };
  f.manifest.codex_hosts.mbp = [...f.manifest.codex_hosts.mbp, entry];
  expect(gatesIn(planCodexHooks(f))).toEqual(["git-guardian", "human-confirm", "m1-window-gate", "tmp-block"]);
  applyCodexHooks(planCodexHooks(f));
  expect(planCodexHooks(f).registered).toBe(true);
  entry.matcher = "^(Bash|apply_patch)$";
  expect(() => planCodexHooks(f)).toThrow("Invalid Codex policy entry");
});

test("M1 client seat mode is explicit in the generated Codex command and validated", () => {
  const f = confirmFixture();
  const entry = { gate: "m1-window-gate", source: "scripts/hooks/codex-policy-hook.py", matcher: "^Bash$", timeout: 10, mode: "seat" };
  f.manifest.codex_hosts.client = [...f.manifest.codex_hosts.mbp, entry];
  f.host = "client";
  expect(planCodexHooks(f).next).toContain("--mode");
  applyCodexHooks(planCodexHooks(f));
  expect(planCodexHooks(f).registered).toBe(true);
  entry.mode = "invalid";
  expect(() => planCodexHooks(f)).toThrow("Invalid Codex policy entry");
});
