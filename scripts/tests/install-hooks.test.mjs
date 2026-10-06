import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync, renameSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { E1_DELETED, MIN_HOOK_PYTHON, pathPython, pinnedFingerprints, resolveHookPython } from "../hooks/install-hooks.mjs";

// Every test builds a git fixture and spawns node; a cold CI runner needs headroom.
setDefaultTimeout(30_000);

const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(here, "..", "hooks", "install-hooks.mjs");
const wrapper = path.join(here, "..", "hooks", "fail-open.py");
const realManifest = JSON.parse(readFileSync(path.join(here, "..", "hooks", "manifest.json"), "utf8"));
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=F", "-c", "user.email=f@localhost", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

const UNRELATED = { $schema: "x", env: { A: "1" }, permissions: { allow: ["Bash(ls)"] } };
const EXTERNAL = { type: "command", command: "python3 /elsewhere/brainlayer-session-start.py", timeout: 2000 };

function manifestFor() {
  return {
    hosts: {
      mbp: [
        { id: "demo-gate", kind: "golems", event: "PreToolUse", matcher: "Bash", link: "demo-gate",
          source: "skills/golem-powers/demo-gate", match: "demo-gate.py", timeout: 5,
          command: "{python} {hooks}/golems-fail-open.py {hooks}/demo-gate/hooks/demo-gate.py" },
        { id: "brainlayer-session-start", kind: "external", event: "SessionStart", match: "brainlayer-session-start.py" },
      ],
    },
  };
}

function addWrappedStopHook(fx) {
  const manifest = manifestFor();
  manifest.hosts.mbp.push({ id: "brainbar-stop-index", kind: "wrapped-external", owner: "brainlayer",
    event: "Stop", match: "brainbar-stop-index.py", timeout: 5, async: true,
    command: "{node} {live}/skills/golem-powers/_shared/stop-hook-runtime/stop-telemetry.mjs brainbar-stop-index -- /opt/homebrew/opt/brainlayer/libexec/venv/bin/python {home}/Gits/brainlayer/hooks/brainbar-stop-index.py" });
  writeFileSync(fx.manifest, JSON.stringify(manifest));
}

// The interpreter the installer pins on this machine (same resolution, same PATH).
function hookPython() {
  const resolved = resolveHookPython({ pathPython: pathPython() });
  if (!resolved) throw new Error("no acceptable hook interpreter on this machine");
  return resolved.python;
}

function withCodex(fx) {
  const entries = ["tmp-block", "git-guardian"].map((gate) => ({ gate, source: "scripts/hooks/codex-policy-hook.py",
    matcher: "^(Bash|apply_patch)$", timeout: 10 }));
  writeFileSync(fx.manifest, JSON.stringify({ ...manifestFor(), codex_hosts: { mbp: entries, m1: entries } }));
}

// A fake interpreter that answers the installer's version probe only.
function fakePython(fx, name, version) {
  const bin = path.join(fx.root, "fake-python"); mkdirSync(bin, { recursive: true });
  const at = path.join(bin, name);
  writeFileSync(at, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 });
  return at;
}

function fixture({ settings, privateSuite = true } = {}) {
  const scratch = path.join(here, "../../docs.local/install-hooks-fixtures");
  mkdirSync(scratch, { recursive: true });
  const root = realpathSync(mkdtempSync(path.join(scratch, "install-hooks-")));
  dirs.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "golems");
  git(root, "init", "-q", "--bare", "-b", "master", origin);
  git(root, "clone", "-q", origin, repo);
  mkdirSync(path.join(repo, "skills/golem-powers/demo-gate/hooks"), { recursive: true });
  writeFileSync(path.join(repo, "skills/golem-powers/demo-gate/hooks/demo-gate.py"), "print('{}')\n");
  writeFileSync(path.join(repo, "skills/golem-powers/demo-gate/hooks/demo.mjs"), "process.stdout.write('{}');\n");
  mkdirSync(path.join(repo, "scripts/hooks"), { recursive: true });
  writeFileSync(path.join(repo, "scripts/hooks/codex-policy-hook.py"), "# synthetic candidate adapter\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "seed");
  git(repo, "push", "-q", "origin", "HEAD:master");
  const home = path.join(root, "home");
  mkdirSync(path.join(home, ".claude/hooks"), { recursive: true });
  const text = settings ?? `${JSON.stringify({ ...UNRELATED, hooks: { SessionStart: [{ hooks: [EXTERNAL] }] } }, null, 2)}\n`;
  writeFileSync(path.join(home, ".claude/settings.json"), text);
  const manifest = path.join(root, "manifest.json");
  writeFileSync(manifest, JSON.stringify(manifestFor()));
  if (privateSuite) {
    const privateRoot = path.join(repo, "docs.local/private-guard-suites"); mkdirSync(privateRoot, { recursive: true });
    const file = path.join(privateRoot, "test_fixture.py");
    writeFileSync(file, "import pytest\nparametrize=pytest.mark.parametrize\n@parametrize('i',range(96))\ndef test_fixture(i):\n    assert i >= 0\n");
    writeFileSync(path.join(privateRoot, "manifest.json"), JSON.stringify({version:2, expectedCases:96,
      fixtures:[{path:file,sha256:createHash("sha256").update(readFileSync(file)).digest("hex")}],dependencies:[]}));
  }
  return { root, repo, home, manifest, settingsPath: path.join(home, ".claude/settings.json") };
}

function run(fx, ...args) {
  const env = fixtureEnv(fx);
  const r = spawnSync("node", [installer, "--repo", fx.repo, "--manifest", fx.manifest, "--host", fx.host ?? "mbp", ...args], {
    encoding: "utf8", env,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const live = (fx) => path.join(fx.repo, ".worktrees/hooks-live");
const bakFiles = (fx) => spawnSync("ls", [path.join(fx.home, ".claude")], { encoding: "utf8" }).stdout
  .split("\n").filter((f) => f.startsWith("settings.json.bak-"));

function fixtureEnv(fx) {
  const env = { ...process.env, HOME: fx.home, CODEX_HOME: path.join(fx.home, ".codex"),
    GOLEMS_HEAVY_LOCK: path.join(fx.root, "fixture-heavy.lock"), ...(fx.env ?? {}) };
  // The parent suite owns the real mutex; nested synthetic installs use fixture-only state.
  delete env.GOLEMS_HEAVY_SUITE_HELD;
  const bin = path.join(fx.root, "machine-bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "scutil"), `#!/bin/sh\nprintf '%s\\n' '${fx.machine ?? (fx.host === "m1" ? "Locals-MacBook-Pro" : "MacBook-Pro")}'\n`, { mode: 0o755 });
  env.PATH = `${bin}:${env.PATH}`;
  return env;
}

function guardedFixture({ privateSuite = "absent", candidate = "pass" } = {}) {
  const fx = fixture({ privateSuite: false });
  const guards = ["skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py",
    "skills/golem-powers/git-guardian/git_safety.py", "skills/golem-powers/_shared/shell_parse.py",
    "scripts/hooks/codex-policy-hook.py"];
  for (const name of guards) {
    const file = path.join(fx.repo, name); mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "# synthetic candidate adapter\n");
  }
  for (const name of ["skills/golem-powers/_shared/tests/test_public.py",
    "skills/golem-powers/tmp-block/tests/test_public.py", "skills/golem-powers/tmp-block/hooks/tests/test_public.py",
    "skills/golem-powers/git-guardian/tests/test_public.py", "skills/golem-powers/git-guardian/hooks/tests/test_public.py",
    "scripts/tests/test_codex_policy_hook.py"]) {
    const file = path.join(fx.repo, name); mkdirSync(path.dirname(file), { recursive: true });
    const unique = file.endsWith("test_public.py") ? file.replace("test_public.py", "test_public_" + name.split("/").slice(2, -1).join("_") + ".py") : file;
    writeFileSync(unique, "import os\nfrom pathlib import Path\ndef test_public(tmp_path):\n" +
      "    home=Path(os.environ['HOME'])\n    for parent in tmp_path.parents:\n" +
      "        if parent == home: break\n        assert not (parent/'.git').exists(), 'fixture inherited an enclosing repository'\n");
  }
  if (candidate === "public-fail") writeFileSync(path.join(fx.repo, "scripts/tests/test_codex_policy_hook.py"), "def test_public():\n    assert False\n");
  if (candidate !== "pass" && candidate !== "public-fail") writeFileSync(path.join(fx.repo, "FAIL_ME"), "synthetic failure");
  if (candidate === "pytest") writeFileSync(path.join(fx.repo, "pytest.py"),
    "import sys\np=sys.argv[sys.argv.index('--junitxml')+1]\nopen(p,'w').write('<testsuite tests=\"96\">'+'<testcase/>'*96+'</testsuite>')\n");
  if (candidate === "conftest") writeFileSync(path.join(fx.repo, "conftest.py"),
    "def pytest_collection_modifyitems(items):\n    for item in items: item._obj=lambda: None\n");
  git(fx.repo, "add", "."); git(fx.repo, "commit", "-qm", "synthetic guarded source");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
  if (privateSuite !== "absent") {
    const root = path.join(fx.repo, "docs.local/private-guard-suites"); mkdirSync(root, { recursive: true });
    const file = path.join(root, "test_trusted.py");
    writeFileSync(file, "import os, pytest\nfrom pathlib import Path\nparametrize = pytest.mark.parametrize\n@parametrize('i', range(96))\n" +
      "def test_candidate(i):\n    root=Path(os.environ['GOLEMS_GUARD_CANDIDATE'])\n" +
      "    assert not (root/'FAIL_ME').exists()\n" +
      "    assert (root/'scripts/hooks/codex-policy-hook.py').read_text() == '# synthetic candidate adapter\\n'\n");
    const manifest = { version: 2, expectedCases: 96, fixtures: [{ path: file,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex") }], dependencies: [] };
    writeFileSync(path.join(root, "manifest.json"), privateSuite === "malformed" ? "[]" : JSON.stringify(manifest));
  }
  return fx;
}

test("other host absent private suites warn once and install after public verification", () => {
  const fx = guardedFixture(); fx.host = "m1";
  const manifest = manifestFor(); manifest.hosts.m1 = structuredClone(manifest.hosts.mbp);
  writeFileSync(fx.manifest, JSON.stringify(manifest));
  const result = run(fx, "--apply");
  expect(result.status).toBe(0); expect(result.out.match(/WARN private regression gate ABSENT/g)).toHaveLength(1);
  expect(result.out).toContain("PASS (private ABSENT)");
  expect(existsSync(live(fx))).toBe(true); expect(bakFiles(fx)).toHaveLength(1);
});

test("present complete private suites test the candidate adapter and install", () => {
  const fx = guardedFixture({ privateSuite: "present" }); const result = run(fx, "--apply");
  expect(result.status).toBe(0); expect(result.out).toContain("PASS 96 private cases");
  expect(existsSync(live(fx))).toBe(true); expect(bakFiles(fx)).toHaveLength(1);
});

test("an update checks the candidate adapter instead of the installed adapter", () => {
  const fx = guardedFixture({ privateSuite: "present" });
  expect(run(fx, "--apply").status).toBe(0);
  const installed = git(live(fx), "rev-parse", "HEAD");
  const before = readFileSync(fx.settingsPath, "utf8"); const backups = bakFiles(fx);
  writeFileSync(path.join(fx.repo, "scripts/hooks/codex-policy-hook.py"), "# changed candidate adapter\n");
  git(fx.repo, "add", "."); git(fx.repo, "commit", "-qm", "synthetic adapter regression");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
  const candidate = git(fx.repo, "rev-parse", "HEAD");
  const result = run(fx, "--update", candidate, "--apply");
  expect(result.status).not.toBe(0); expect(result.out).toContain("private regression suite failed");
  expect(git(live(fx), "rev-parse", "HEAD")).toBe(installed);
  expect(readFileSync(fx.settingsPath, "utf8")).toBe(before); expect(bakFiles(fx)).toEqual(backups);
});

test("failing public guard suite refuses even with passing private suites", () => {
  const fx = guardedFixture({ privateSuite: "present", candidate: "public-fail" });
  const before = readFileSync(fx.settingsPath, "utf8"); const result = run(fx, "--apply");
  expect(result.status).not.toBe(0); expect(result.out).toContain("public regression suite failed");
  expect(existsSync(live(fx))).toBe(false); expect(readFileSync(fx.settingsPath, "utf8")).toBe(before);
  expect(bakFiles(fx)).toHaveLength(0);
});

for (const candidate of ["fail", "pytest", "conftest", "environment"]) {
  test(`present failing suites refuse ${candidate} candidate before host writes`, () => {
    const fx = guardedFixture({ privateSuite: "present", candidate });
    if (candidate === "environment") {
      const startup = path.join(fx.root, "startup"); mkdirSync(startup);
      writeFileSync(path.join(startup, "sitecustomize.py"), "import os\nos._exit(0)\n");
      fx.env = { PYTHONPATH: startup, PYTHONHOME: startup, PYTHONSTARTUP: path.join(startup, "sitecustomize.py") };
    }
    const before = readFileSync(fx.settingsPath, "utf8"); const result = run(fx, "--apply");
    expect(result.status).not.toBe(0); expect(result.out).toContain("private regression gate refused");
    expect(result.out).toContain("private regression suite failed");
    expect(existsSync(live(fx))).toBe(false); expect(readFileSync(fx.settingsPath, "utf8")).toBe(before);
    expect(bakFiles(fx)).toHaveLength(0); expect(existsSync(path.join(fx.home, ".codex/hooks.json"))).toBe(false);
    expect(git(fx.repo, "worktree", "list", "--porcelain")).not.toContain("hooks-private-gate-");
  });
}

test("present malformed manifest and renamed guards refuse before host writes", () => {
  for (const kind of ["malformed", "renamed"]) {
    const fx = guardedFixture({ privateSuite: kind === "malformed" ? kind : "absent" });
    if (kind === "renamed") {
      git(fx.repo, "mv", "skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py", "skills/golem-powers/tmp-block/hooks/renamed.py");
      git(fx.repo, "commit", "-qm", "synthetic guard rename"); git(fx.repo, "push", "-q", "origin", "HEAD:master");
    }
    const before = readFileSync(fx.settingsPath, "utf8"); const result = run(fx, "--apply");
    expect(result.status).not.toBe(0); expect(existsSync(live(fx))).toBe(false);
    expect(readFileSync(fx.settingsPath, "utf8")).toBe(before); expect(bakFiles(fx)).toHaveLength(0);
  }
});

test("every shipped host uses integer timeout seconds in 1..120; PreToolUse requires one", () => {
  const invalid = [];
  for (const [host, entries] of Object.entries(realManifest.hosts)) {
    for (const entry of entries) {
      if (entry.timeout === undefined && entry.event !== "PreToolUse") continue;
      if (!Number.isInteger(entry.timeout) || entry.timeout < 1 || entry.timeout > 120) {
        invalid.push(`${host}/${entry.id}: timeout=${entry.timeout}`);
      }
    }
  }
  expect(invalid).toEqual([]);
});

for (const timeout of [undefined, null, 0, -1, 1.5, 121, 1000, "5", true]) {
  test(`installer refuses invalid timeout ${JSON.stringify(timeout)} before any writes, on every host`, () => {
    const fx = fixture();
    const before = readFileSync(fx.settingsPath, "utf8");
    for (const host of ["mbp", "m1"]) {
      const manifest = manifestFor();
      manifest.hosts.m1 = structuredClone(manifest.hosts.mbp);
      if (timeout === undefined) delete manifest.hosts[host][0].timeout;
      else manifest.hosts[host][0].timeout = timeout;
      writeFileSync(fx.manifest, JSON.stringify(manifest));
      for (const mode of ["--dry-run", "--status", "--apply"]) {
        const result = run(fx, mode);
        expect(result.status).not.toBe(0);
        expect(result.out).toContain(`${host}/demo-gate`);
        expect(result.out).toContain("timeout must be an integer in 1..120 seconds");
        expect(readFileSync(fx.settingsPath, "utf8")).toBe(before);
        expect(existsSync(live(fx))).toBe(false);
        expect(bakFiles(fx)).toHaveLength(0);
      }
    }
  });
}

test("timeout validation covers non-PreToolUse and external entries", () => {
  const fx = fixture();
  for (const kind of ["golems", "external", "wrapped-external"]) {
    const manifest = manifestFor();
    Object.assign(manifest.hosts.mbp[0], { kind, event: "Stop", timeout: 121 });
    writeFileSync(fx.manifest, JSON.stringify(manifest));
    expect(run(fx, "--status").status).not.toBe(0);
  }
  const manifest = manifestFor();
  Object.assign(manifest.hosts.mbp[1], { event: "PreToolUse" });
  writeFileSync(fx.manifest, JSON.stringify(manifest));
  expect(run(fx, "--apply").status).not.toBe(0);
});

test("timeout boundaries 1 and 120 seconds remain valid", () => {
  const fx = fixture();
  for (const timeout of [1, 120]) {
    const manifest = manifestFor();
    manifest.hosts.mbp[0].timeout = timeout;
    writeFileSync(fx.manifest, JSON.stringify(manifest));
    expect(run(fx, "--apply").status).toBe(0);
    expect(JSON.parse(readFileSync(fx.settingsPath, "utf8")).hooks.PreToolUse[0].hooks[0].timeout).toBe(timeout);
    expect(run(fx, "--status").status).toBe(0);
  }
});

test("dry-run is the default and writes nothing", () => {
  const fx = fixture();
  const before = readFileSync(fx.settingsPath, "utf8");
  const r = run(fx);
  expect(r.status).toBe(0);
  expect(r.out).toContain("dry-run");
  expect(readFileSync(fx.settingsPath, "utf8")).toBe(before);
  expect(existsSync(live(fx))).toBe(false);
  expect(existsSync(path.join(fx.home, ".claude/hooks/demo-gate"))).toBe(false);
});

test("wrapped external Stop hook replaces the hand-placed command once and keeps its owner script external", () => {
  const old = { type: "command", command: "node /old/skill-creator/hooks-lab/stop-telemetry.mjs brainbar-stop-index -- python3 /old/brainbar-stop-index.py", async: true, timeout: 5000 };
  const sibling = { type: "command", command: "node /other/stop-hook.mjs" };
  const fx = fixture({ settings: `${JSON.stringify({ hooks: { Stop: [{ hooks: [old, sibling] }, { hooks: [old] }] } }, null, 2)}\n` });
  addWrappedStopHook(fx);
  const result = run(fx, "--apply");
  expect(result.status).toBe(0);
  const groups = JSON.parse(readFileSync(fx.settingsPath, "utf8")).hooks.Stop;
  const stopHooks = groups.flatMap((group) => group.hooks);
  expect(stopHooks).toHaveLength(2);
  expect(stopHooks[1]).toEqual(sibling);
  const node = spawnSync("sh", ["-c", "command -v node"], { encoding: "utf8" }).stdout.trim();
  expect(stopHooks[0]).toEqual({ type: "command", command: `${node} ${live(fx)}/skills/golem-powers/_shared/stop-hook-runtime/stop-telemetry.mjs brainbar-stop-index -- /opt/homebrew/opt/brainlayer/libexec/venv/bin/python ${fx.home}/Gits/brainlayer/hooks/brainbar-stop-index.py`, timeout: 5, async: true });
  expect(existsSync(path.join(fx.home, ".claude/hooks/brainbar-stop-index.py"))).toBe(false);
  expect(bakFiles(fx)).toHaveLength(1);
  expect(run(fx, "--apply").status).toBe(0);
  expect(bakFiles(fx)).toHaveLength(1);
});

test("--status checks the wrapped external hook's exact command, timeout, async flag, and duplicates", () => {
  const fx = fixture();
  addWrappedStopHook(fx);
  expect(run(fx, "--status").out).toContain("brainbar-stop-index drifted");
  expect(run(fx, "--apply").status).toBe(0);
  let result = run(fx, "--status");
  expect(result.status).toBe(0);
  expect(result.out).toContain("brainbar-stop-index ok");
  for (const change of [(hook) => { hook.command += " --drift"; }, (hook) => { hook.timeout = 1; }, (hook) => { hook.async = false; }]) {
    const settings = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
    change(settings.hooks.Stop[0].hooks[0]);
    writeFileSync(fx.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    result = run(fx, "--status");
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("brainbar-stop-index drifted");
    expect(run(fx, "--apply").status).toBe(0);
  }
  const settings = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  settings.hooks.Stop.push({ hooks: [{ ...settings.hooks.Stop[0].hooks[0] }] });
  writeFileSync(fx.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  result = run(fx, "--status");
  expect(result.status).not.toBe(0);
  expect(result.out).toContain("brainbar-stop-index drifted");
});

test("shipped MBP wrapper uses host placeholders and M1 has no brainbar Stop hook", () => {
  const entry = realManifest.hosts.mbp.find((hook) => hook.id === "brainbar-stop-index");
  expect(entry.kind).toBe("wrapped-external");
  expect(entry.timeout).toBe(5);
  expect(entry.command).toContain("{home}/Gits/brainlayer/hooks/brainbar-stop-index.py");
  expect(entry.command).not.toMatch(/\/Users\/[^/]+/);
  expect(realManifest.hosts.m1.some((hook) => hook.id === "brainbar-stop-index")).toBe(false);
});

test("--apply pins a detached, locked hooks-live, links (not copies), registers, backs up, keeps unrelated bytes, idempotent", () => {
  const fx = fixture();
  const before = readFileSync(fx.settingsPath, "utf8");
  const r = run(fx, "--apply");
  expect(r.status).toBe(0);

  const list = git(fx.repo, "worktree", "list", "--porcelain");
  const block = list.split("\n\n").find((b) => b.includes(live(fx)));
  expect(block).toContain("detached");
  expect(block).toMatch(/locked .+/);
  expect(git(live(fx), "rev-parse", "HEAD")).toBe(git(fx.repo, "rev-parse", "origin/master"));

  const link = path.join(fx.home, ".claude/hooks/demo-gate");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(link)).toBe(path.join(live(fx), "skills/golem-powers/demo-gate"));
  expect(readFileSync(path.join(fx.home, ".claude/hooks/golems-fail-open.py"), "utf8")).toBe(readFileSync(wrapper, "utf8"));

  const after = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  const cmd = after.hooks.PreToolUse[0];
  expect(cmd.matcher).toBe("Bash");
  expect(cmd.hooks[0].command).toBe(
    `${hookPython()} ${fx.home}/.claude/hooks/golems-fail-open.py ${fx.home}/.claude/hooks/demo-gate/hooks/demo-gate.py`);
  expect(after.hooks.SessionStart).toEqual([{ hooks: [EXTERNAL] }]);
  const { hooks: _h, ...rest } = after;
  expect(JSON.stringify(rest)).toBe(JSON.stringify(UNRELATED));
  expect(Object.keys(after)).toEqual(Object.keys(JSON.parse(before)));

  const baks = bakFiles(fx);
  expect(baks.length).toBe(1);
  expect(readFileSync(path.join(fx.home, ".claude", baks[0]), "utf8")).toBe(before);

  const once = readFileSync(fx.settingsPath, "utf8");
  expect(run(fx, "--apply").status).toBe(0);
  expect(readFileSync(fx.settingsPath, "utf8")).toBe(once);
  expect(bakFiles(fx).length).toBe(1);
});

test("an existing registration is replaced in place: same group, sibling kept, order kept", () => {
  const sibling = { type: "command", command: "python3 /x/pre_tool_use.py" };
  const old = { type: "command", command: "python3 /old/demo-gate.py" };
  const hooks = { PreToolUse: [{ matcher: "Bash", hooks: [old, sibling] }, { matcher: "Write", hooks: [sibling] }] };
  const fx = fixture({ settings: `${JSON.stringify({ hooks }, null, 2)}\n` });
  expect(run(fx, "--apply").status).toBe(0);
  const pre = JSON.parse(readFileSync(fx.settingsPath, "utf8")).hooks.PreToolUse;
  expect(pre.map((g) => g.matcher)).toEqual(["Bash", "Write"]);
  expect(pre[0].hooks[0].command).toContain("golems-fail-open.py");
  expect(pre[0].hooks[1]).toEqual(sibling);
});

test("an existing copy at a link path is backed up, never deleted", () => {
  const fx = fixture();
  const copy = path.join(fx.home, ".claude/hooks/demo-gate");
  mkdirSync(copy);
  writeFileSync(path.join(copy, "old.py"), "old\n");
  expect(run(fx, "--apply").status).toBe(0);
  expect(lstatSync(copy).isSymbolicLink()).toBe(true);
  const baks = spawnSync("ls", [path.join(fx.home, ".claude/hooks")], { encoding: "utf8" })
    .stdout.split("\n").filter((f) => f.startsWith("demo-gate.bak-"));
  expect(baks.length).toBe(1);
  expect(readFileSync(path.join(fx.home, ".claude/hooks", baks[0], "old.py"), "utf8")).toBe("old\n");
});

test("refuses to rewrite a settings.json that is not canonical 2-space JSON", () => {
  const fx = fixture({ settings: '{"env":{"A":"1"}}\n' });
  const r = run(fx, "--apply");
  expect(r.status).not.toBe(0);
  expect(r.out).toContain("not canonical");
  expect(readFileSync(fx.settingsPath, "utf8")).toBe('{"env":{"A":"1"}}\n');
});

test("E1 exclusion: the installer REFUSES every E1 hook even when the manifest names it", () => {
  expect(E1_DELETED.length).toBeGreaterThanOrEqual(9);
  for (const name of E1_DELETED) {
    const fx = fixture();
    const m = manifestFor();
    m.hosts.mbp[0].command += ` ${name}`;
    writeFileSync(fx.manifest, JSON.stringify(m));
    const before = readFileSync(fx.settingsPath, "utf8");
    const r = run(fx, "--apply");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`REFUSED: ${name}`);
    expect(readFileSync(fx.settingsPath, "utf8")).toBe(before);
    expect(existsSync(live(fx))).toBe(false);
  }
});

test("the shipped manifest names no E1 hook and carries the ruled M1 set exactly", () => {
  const text = JSON.stringify(realManifest);
  for (const name of E1_DELETED) expect(text).not.toContain(name);
  expect(realManifest.hosts.m1.map((h) => h.id).sort()).toEqual([
    "brainlayer-prompt-search", "brainlayer-session-start", "daemon-gate-precheck", "human-confirm-gate", "model-pin-gate",
    "pre_tool_use", "reviewer-order-gate", "tmp-block",
  ]);
  expect(realManifest.hosts.m1.some((h) => h.event === "Stop")).toBe(false);
});

test("every shipped host set carries the same git-guardian and tmp-block guards", () => {
  for (const id of ["pre_tool_use", "tmp-block"]) {
    const mbp = realManifest.hosts.mbp.filter((hook) => hook.id === id);
    expect(mbp).toHaveLength(1);
    expect(mbp[0].timeout).toBe(5);
    for (const [host, entries] of Object.entries(realManifest.hosts)) {
      expect(entries.filter((hook) => hook.id === id), `${host} ${id}`).toEqual(mbp);
    }
  }
});

test("{node} is the PATH node (`command -v node`), so a node upgrade that removes the old realpath keeps hooks running", () => {
  const fx = fixture();
  const m = manifestFor();
  m.hosts.mbp.push({ id: "demo-node", kind: "golems", event: "Stop", link: "demo-gate", source: "skills/golem-powers/demo-gate",
    match: "demo.mjs", command: "{node} {hooks}/demo-gate/hooks/demo.mjs" });
  writeFileSync(fx.manifest, JSON.stringify(m));
  // A version-manager layout: bin/node is a stable symlink to a versioned wrapper.
  const realNode = spawnSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).stdout.trim();
  const bin = path.join(fx.root, "bin");
  const v1 = path.join(fx.root, "versions/v1");
  mkdirSync(bin);
  mkdirSync(v1, { recursive: true });
  writeFileSync(path.join(v1, "node"), `#!/bin/sh\nexec "${realNode}" "$@"\n`);
  chmodSync(path.join(v1, "node"), 0o755);
  symlinkSync(path.join(v1, "node"), path.join(bin, "node"));
  fx.env = { PATH: `${bin}:${process.env.PATH}` };
  expect(run(fx, "--apply").status).toBe(0);

  const cmd = JSON.parse(readFileSync(fx.settingsPath, "utf8")).hooks.Stop[0].hooks[0].command;
  expect(cmd.startsWith(`${path.join(bin, "node")} `)).toBe(true);

  // "Upgrade": the old versioned node disappears; bin/node now points at v2.
  const v2 = path.join(fx.root, "versions/v2");
  mkdirSync(v2);
  cpSync(path.join(v1, "node"), path.join(v2, "node"));
  rmSync(path.join(fx.root, "versions/v1"), { recursive: true });
  rmSync(path.join(bin, "node"));
  symlinkSync(path.join(v2, "node"), path.join(bin, "node"));
  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", input: "{}" });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("{}");
});

test("--apply preserves settings.json's mode (0600 stays 0600) on the file and its .bak", () => {
  const fx = fixture();
  chmodSync(fx.settingsPath, 0o600);
  expect(run(fx, "--apply").status).toBe(0);
  expect(statSync(fx.settingsPath).mode & 0o777).toBe(0o600);
  const baks = bakFiles(fx);
  expect(baks.length).toBe(1);
  expect(statSync(path.join(fx.home, ".claude", baks[0])).mode & 0o777).toBe(0o600);
});

test("--status: ok, drift, then copy(not link) and dangling exit nonzero; missing does not", () => {
  const fx = fixture();
  let r = run(fx, "--status");
  expect(r.status).toBe(0);
  expect(r.out).toContain("hooks-live=absent");
  expect(r.out).toMatch(/demo-gate missing/);

  expect(run(fx, "--apply").status).toBe(0);
  const sha = git(fx.repo, "rev-parse", "origin/master");
  r = run(fx, "--status");
  expect(r.status).toBe(0);
  expect(r.out).toContain(`hooks-live=${sha} master=${sha} drift=0`);
  expect(r.out).toMatch(/demo-gate ok/);
  expect(r.out).toMatch(/brainlayer-session-start external/);

  git(fx.repo, "commit", "-q", "--allow-empty", "-m", "next");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
  git(fx.repo, "fetch", "-q", "origin");
  expect(run(fx, "--status").out).toContain("drift=1");

  const link = path.join(fx.home, ".claude/hooks/demo-gate");
  rmSync(link);
  cpSync(path.join(live(fx), "skills/golem-powers/demo-gate"), link, { recursive: true });
  r = run(fx, "--status");
  expect(r.status).not.toBe(0);
  expect(r.out).toMatch(/demo-gate copy\(not link\)/);

  rmSync(link, { recursive: true });
  spawnSync("ln", ["-s", path.join(fx.root, "nowhere"), link]);
  r = run(fx, "--status");
  expect(r.status).not.toBe(0);
  expect(r.out).toMatch(/demo-gate dangling/);

  const fx2 = fixture();
  const s = JSON.parse(readFileSync(fx2.settingsPath, "utf8"));
  s.hooks.Stop = [{ hooks: [{ type: "command", command: "node /h/idle-dwell-gate/hook.mjs" }] }];
  writeFileSync(fx2.settingsPath, `${JSON.stringify(s, null, 2)}\n`);
  r = run(fx2, "--status");
  expect(r.status).not.toBe(0);
  expect(r.out).toContain("E1 idle-dwell-gate PRESENT");
});

test("--update moves the pin to a new sha and re-locks; nothing else moves it", () => {
  const fx = fixture();
  expect(run(fx, "--apply").status).toBe(0);
  const first = git(live(fx), "rev-parse", "HEAD");
  git(fx.repo, "commit", "-q", "--allow-empty", "-m", "next");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
  expect(run(fx, "--apply").status).toBe(0);
  expect(git(live(fx), "rev-parse", "HEAD")).toBe(first);
  writeFileSync(path.join(live(fx), "local-edit.txt"), "x\n");
  const dirty = run(fx, "--apply", "--update");
  expect(dirty.status).not.toBe(0);
  expect(dirty.out).toContain("local changes");
  expect(git(live(fx), "rev-parse", "HEAD")).toBe(first);
  rmSync(path.join(live(fx), "local-edit.txt"));
  expect(run(fx, "--apply", "--update").status).toBe(0);
  expect(git(live(fx), "rev-parse", "HEAD")).toBe(git(fx.repo, "rev-parse", "origin/master"));
  expect(git(live(fx), "rev-parse", "HEAD")).not.toBe(first);
  expect(git(fx.repo, "worktree", "list", "--porcelain")).toMatch(/hooks-live\nHEAD \w+\ndetached\nlocked .+/);
});

test("--status reads only registered hook commands: an E1 or external name elsewhere in settings is not a hit", () => {
  const fx = fixture();
  const s = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  s.hooks = {};
  s.permissions.deny = ["Bash(node /h/idle-dwell-gate/hook.mjs)", "Read(/x/brainlayer-session-start.py)"];
  writeFileSync(fx.settingsPath, `${JSON.stringify(s, null, 2)}\n`);
  const r = run(fx, "--status");
  expect(r.status).toBe(0);
  expect(r.out).not.toContain("PRESENT");
  expect(r.out).toContain("brainlayer-session-start external(unregistered)");
});

test("--status: a linked hook whose command is no longer registered reports unregistered", () => {
  const fx = fixture();
  expect(run(fx, "--apply").status).toBe(0);
  const s = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  delete s.hooks.PreToolUse;
  writeFileSync(fx.settingsPath, `${JSON.stringify(s, null, 2)}\n`);
  expect(run(fx, "--status").out).toMatch(/demo-gate unregistered/);
});

test("human confirmation ships once on each host through hooks-live with the shared wrapper", () => {
  const reference = realManifest.hosts.mbp.find((h) => h.id === "human-confirm-gate");
  expect(reference.matcher).toBe("Bash|Monitor|Write|Edit|MultiEdit|NotebookEdit");
  expect(reference.timeout).toBe(10);
  expect(reference.command).toBe("{python} -I -B {hooks}/golems-fail-open.py {hooks}/human-confirm-gate/hooks/human-confirm-pretooluse.py");
  for (const entries of Object.values(realManifest.hosts)) {
    expect(entries.filter((h) => h.id === "human-confirm-gate")).toEqual([reference]);
  }
});

function addPinGate(fx, pins) {
  const manifest = manifestFor();
  manifest.hosts.mbp.push({ id: "pin-gate", kind: "golems", event: "PreToolUse", matcher: "Bash", link: "pin-gate",
    source: "skills/golem-powers/pin-gate", match: "pin-gate.py", requiresPin: "skills/golem-powers/pin-gate/anchor.pins",
    timeout: 5, command: "{python} {hooks}/golems-fail-open.py {hooks}/pin-gate/hooks/pin-gate.py" });
  writeFileSync(fx.manifest, JSON.stringify(manifest));
  mkdirSync(path.join(fx.repo, "skills/golem-powers/pin-gate/hooks"), { recursive: true });
  writeFileSync(path.join(fx.repo, "skills/golem-powers/pin-gate/hooks/pin-gate.py"), "print('{}')\n");
  const file = path.join(fx.repo, "skills/golem-powers/pin-gate/anchor.pins");
  if (pins === null) rmSync(file, { force: true });
  else writeFileSync(file, pins);
  git(fx.repo, "add", "-A");
  git(fx.repo, "commit", "-qm", "pin gate", "--allow-empty");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
}

const FINGERPRINT = "a".repeat(64);

test("never install-and-deny: an unpinned requiresPin gate is REFUSED while other hooks install", () => {
  for (const pins of [null, "", "# placeholder: no owner fingerprint yet\n", "TODO\n", `${FINGERPRINT}  mbp\nnot-hex\n`]) {
    const fx = fixture();
    addPinGate(fx, pins);
    const r = run(fx, "--apply");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/REFUSED pin-gate: skills\/golem-powers\/pin-gate\/anchor\.pins has no owner fingerprint/);
    expect(existsSync(path.join(fx.home, ".claude/hooks/pin-gate"))).toBe(false);
    expect(readFileSync(fx.settingsPath, "utf8")).not.toContain("pin-gate.py");
    expect(lstatSync(path.join(fx.home, ".claude/hooks/demo-gate")).isSymbolicLink()).toBe(true);
    expect(run(fx, "--status").out).toMatch(/pin-gate refused\(unpinned\)/);
    expect(run(fx, "--status").status).toBe(0);
    expect(run(fx).out).toMatch(/REFUSED pin-gate/);  // dry-run reports it too
  }
});

test("a pinned requiresPin gate activates once the fingerprint lands at the installed sha", () => {
  const fx = fixture();
  addPinGate(fx, "# owner fingerprints\n");
  expect(run(fx, "--apply").out).toMatch(/REFUSED pin-gate/);
  writeFileSync(path.join(fx.repo, "skills/golem-powers/pin-gate/anchor.pins"), `# owner fingerprints\n${FINGERPRINT}  mbp\n`);
  git(fx.repo, "commit", "-qam", "owner pin");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
  const r = run(fx, "--apply", "--update");
  expect(r.status).toBe(0);
  expect(r.out).not.toMatch(/REFUSED/);
  expect(readlinkSync(path.join(fx.home, ".claude/hooks/pin-gate"))).toBe(path.join(live(fx), "skills/golem-powers/pin-gate"));
  expect(readFileSync(fx.settingsPath, "utf8")).toContain("pin-gate/hooks/pin-gate.py");
});

test("pin grammar matches the gate: shared vectors with tokens.parse_pins", () => {
  const vectors = JSON.parse(readFileSync(path.join(here, "../../skills/golem-powers/human-confirm-gate/tests/pin-vectors.json"), "utf8")).vectors;
  expect(vectors.length).toBeGreaterThan(20);
  for (const v of vectors) {
    expect([v.text, pinnedFingerprints(Buffer.from(v.text, "utf8"))]).toEqual([v.text, v.count ?? 0]);
  }
  expect(pinnedFingerprints(undefined)).toBe(0);
});

test("--update to an unpinned sha unlinks and deregisters an active gate (never install-and-deny)", () => {
  const fx = fixture();
  addPinGate(fx, `${FINGERPRINT}  mbp\n`);
  expect(run(fx, "--apply").status).toBe(0);
  expect(readFileSync(fx.settingsPath, "utf8")).toContain("pin-gate.py");
  writeFileSync(path.join(fx.repo, "skills/golem-powers/pin-gate/anchor.pins"), "# emptied\n");
  git(fx.repo, "commit", "-qam", "unpin");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
  const r = run(fx, "--apply", "--update");
  expect(r.status).toBe(0);
  expect(r.out).toMatch(/REFUSED pin-gate: .* unlinked and deregistered/);
  expect(existsSync(path.join(fx.home, ".claude/hooks/pin-gate"))).toBe(false);
  expect(readFileSync(fx.settingsPath, "utf8")).not.toContain("pin-gate.py");
  expect(readFileSync(fx.settingsPath, "utf8")).toContain("demo-gate.py");
  const st = run(fx, "--status");
  expect(st.out).toMatch(/pin-gate refused\(unpinned\)\n/);
  expect(st.status).toBe(0);
});

test("--status flags a refused gate that is still linked or registered", () => {
  const fx = fixture();
  addPinGate(fx, `${FINGERPRINT}  mbp\n`);
  expect(run(fx, "--apply").status).toBe(0);
  writeFileSync(path.join(fx.repo, "skills/golem-powers/pin-gate/anchor.pins"), "# emptied\n");
  git(fx.repo, "commit", "-qam", "unpin");
  git(fx.repo, "push", "-q", "origin", "HEAD:master");
  git(live(fx), "checkout", "-q", "--detach", git(fx.repo, "rev-parse", "origin/master"));  // moved outside --apply
  const st = run(fx, "--status");
  expect(st.out).toMatch(/pin-gate refused\(unpinned\) but STILL ACTIVE/);
  expect(st.status).toBe(1);
});

test("--status detects hooks-live tampering: tracked edits, untracked files, foreign or unrecorded HEAD", () => {
  const fx = fixture();
  addPinGate(fx, `${FINGERPRINT}  mbp\n`);
  expect(run(fx, "--apply").status).toBe(0);
  const clean = run(fx, "--status");
  expect([clean.status, clean.out]).toEqual([0, expect.not.stringMatching(/DIRTY|not on origin|recorded pin/)]);
  const pins = path.join(live(fx), "skills/golem-powers/pin-gate/anchor.pins");
  const original = readFileSync(pins, "utf8");
  writeFileSync(pins, `${original}${"b".repeat(64)}  rogue\n`);  // in-place edit, uncommitted
  let st = run(fx, "--status");
  expect(st.out).toMatch(/hooks-live DIRTY: 1 changed\/untracked path/);
  expect(st.status).toBe(1);
  writeFileSync(pins, original);
  writeFileSync(path.join(live(fx), "skills/golem-powers/pin-gate/hooks/extra.py"), "pass\n");  // untracked
  st = run(fx, "--status");
  expect(st.out).toMatch(/hooks-live DIRTY/);
  expect(st.status).toBe(1);
  rmSync(path.join(live(fx), "skills/golem-powers/pin-gate/hooks/extra.py"));
  // A local commit inside hooks-live: off origin/master and not the recorded pin.
  writeFileSync(pins, `${"c".repeat(64)}  rogue\n`);
  git(live(fx), "commit", "-qam", "local re-pin");
  st = run(fx, "--status");
  expect(st.out).toMatch(/hooks-live HEAD is not on origin\/master/);
  expect(st.out).toMatch(/!= recorded pin/);
  expect(st.status).toBe(1);
  rmSync(path.join(fx.home, ".claude/hooks/golems-hooks-live.sha"));
  git(live(fx), "checkout", "-q", "--detach", git(fx.repo, "rev-parse", "origin/master"));
  st = run(fx, "--status");
  expect(st.out).toMatch(/has no recorded pin/);
  expect(st.status).toBe(1);
});

test("the shipped human-confirm gate requires its committed anchor pin on every host", () => {
  for (const entries of Object.values(realManifest.hosts)) {
    const gate = entries.find((h) => h.id === "human-confirm-gate");
    expect(gate.requiresPin).toBe("skills/golem-powers/human-confirm-gate/anchor.pins");
    expect(existsSync(path.join(here, "../..", gate.requiresPin))).toBe(true);
  }
});

test("--status compares every Python hook's import dirs byte-for-byte with HEAD; --apply clears stale caches", () => {
  const fx = fixture();
  addPinGate(fx, `${FINGERPRINT}  mbp\n`);
  expect(run(fx, "--apply").status).toBe(0);
  const hook = path.join(live(fx), "skills/golem-powers/pin-gate/hooks/pin-gate.py");
  writeFileSync(hook, "print('changed')\n");
  let st = run(fx, "--status");
  expect(st.status).toBe(1);
  expect(st.out).toMatch(/hooks import files differ from HEAD: 1 \(skills\/golem-powers\/pin-gate\/hooks\/pin-gate.py\)/);
  writeFileSync(hook, "print('{}')\n");
  // An ordinary (non-gate) hook dir is covered too: compiled files and caches are findings.
  const demo = path.join(live(fx), "skills/golem-powers/demo-gate/hooks");
  writeFileSync(path.join(demo, "json.pyc"), "");
  mkdirSync(path.join(demo, "__pycache__"));
  writeFileSync(path.join(demo, "__pycache__/demo-gate.cpython-313.pyc"), "");
  st = run(fx, "--status");
  expect(st.status).toBe(1);
  expect(st.out).toMatch(/hooks import files unexpected \(untracked or ignored\): 2 /);
  rmSync(path.join(demo, "json.pyc"));
  const apply = run(fx, "--apply");
  expect(apply.out).toMatch(/clearing 1 stale __pycache__ dir/);
  expect(existsSync(path.join(demo, "__pycache__"))).toBe(false);
  expect(run(fx, "--status").out).not.toMatch(/import files|INDEX|REPLACE/);
});

function pinnedManifestFixture() {
  const fx = fixture();
  const directory = path.join(fx.root, 'invoking-checkout/scripts/hooks');
  mkdirSync(directory, { recursive: true });
  cpSync(installer, path.join(directory, 'install-hooks.mjs'));
  cpSync(path.join(here, '../hooks/codex-hooks-install.mjs'), path.join(directory, 'codex-hooks-install.mjs'));
  cpSync(wrapper, path.join(directory, 'fail-open.py'));
  cpSync(path.join(here, '../hooks/private-regression-gate.py'), path.join(directory, 'private-regression-gate.py'));
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifestFor()));
  fx.defaultInstaller = path.join(directory, 'install-hooks.mjs');
  fx.pinnedManifest = path.join(fx.repo, 'scripts/hooks/manifest.json');
  mkdirSync(path.dirname(fx.pinnedManifest), { recursive: true });
  return fx;
}
function commitManifest(fx, timeout = 15, matcher = 'Write') {
  const manifest = manifestFor();
  Object.assign(manifest.hosts.mbp[0], { timeout, matcher });
  writeFileSync(fx.pinnedManifest, JSON.stringify(manifest));
  git(fx.repo, 'add', '.'); git(fx.repo, 'commit', '-qm', 'manifest revision');
  git(fx.repo, 'push', '-q', 'origin', 'HEAD:master');
  return git(fx.repo, 'rev-parse', 'HEAD');
}
function runDefault(fx, ...args) {
  const r = spawnSync('node', [fx.defaultInstaller, '--repo', fx.repo, '--host', 'mbp', ...args],
    { env: fixtureEnv(fx), encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}
test('default manifest comes from the selected pin despite an older invoking checkout', () => {
  const fx = pinnedManifestFixture(); const first = commitManifest(fx);
  expect(runDefault(fx, '--apply').status).toBe(0);
  let settings = JSON.parse(readFileSync(fx.settingsPath, 'utf8'));
  expect(settings.hooks.PreToolUse[0].matcher).toBe('Write');
  expect(settings.hooks.PreToolUse[0].hooks[0].timeout).toBe(15);
  commitManifest(fx, 25, 'Read');
  expect(runDefault(fx, '--apply').status).toBe(0);
  expect(git(live(fx), 'rev-parse', 'HEAD')).toBe(first);
  settings = JSON.parse(readFileSync(fx.settingsPath, 'utf8'));
  expect(settings.hooks.PreToolUse[0].hooks[0].timeout).toBe(15);
  expect(runDefault(fx, '--apply', '--update').status).toBe(0);
  settings = JSON.parse(readFileSync(fx.settingsPath, 'utf8'));
  expect(settings.hooks.PreToolUse[0].matcher).toBe('Read');
  expect(settings.hooks.PreToolUse[0].hooks[0].timeout).toBe(25);
});
test('update dry-run uses the future pinned manifest without moving the worktree or settings', () => {
  const fx = pinnedManifestFixture(); const first = commitManifest(fx, 5, 'Bash');
  expect(runDefault(fx, '--apply').status).toBe(0);
  const before = readFileSync(fx.settingsPath, 'utf8'); commitManifest(fx, 25);
  const result = runDefault(fx, '--dry-run', '--update');
  expect(result.status).toBe(0); expect(result.out).toContain('settings.json: would change');
  expect(git(live(fx), 'rev-parse', 'HEAD')).toBe(first);
  expect(readFileSync(fx.settingsPath, 'utf8')).toBe(before);
});
test('invalid selected manifest refuses before creating hooks-live or settings backups', () => {
  const fx = pinnedManifestFixture(); commitManifest(fx, 1000);
  const before = readFileSync(fx.settingsPath, 'utf8');
  const result = runDefault(fx, '--apply');
  expect(result.status).not.toBe(0); expect(result.out).toContain('timeout must be an integer');
  expect(existsSync(live(fx))).toBe(false);
  expect(readFileSync(fx.settingsPath, 'utf8')).toBe(before); expect(bakFiles(fx)).toHaveLength(0);
});
test('status reads the pinned manifest and detects managed registration drift at SHA drift zero', () => {
  const fx = pinnedManifestFixture(); commitManifest(fx, 5, 'Bash');
  expect(runDefault(fx, '--apply').status).toBe(0);
  const baseline = readFileSync(fx.settingsPath, 'utf8');
  // A broken invoking manifest must not affect the pinned status contract.
  writeFileSync(path.join(path.dirname(fx.defaultInstaller), 'manifest.json'), 'not JSON');
  expect(runDefault(fx, '--status').status).toBe(0);
  for (const change of [
    (s) => { s.hooks.PreToolUse[0].hooks[0].timeout = 10; },
    (s) => { s.hooks.PreToolUse[0].matcher = 'Write'; },
    (s) => { s.hooks.PreToolUse[0].hooks[0].command += ' --changed'; },
    (s) => { s.hooks.PreToolUse[0].hooks[0].async = true; },
    (s) => { s.hooks.Stop = [{ hooks: [structuredClone(s.hooks.PreToolUse[0].hooks[0])] }]; },
  ]) {
    const settings = JSON.parse(baseline); change(settings);
    const changed = JSON.stringify(settings, null, 2) + '\n'; writeFileSync(fx.settingsPath, changed);
    const result = runDefault(fx, '--status');
    expect(result.out).toContain('drift=0'); expect(result.out).toContain('demo-gate drifted');
    expect(result.status).not.toBe(0); expect(readFileSync(fx.settingsPath, 'utf8')).toBe(changed);
  }
});

test('explicit update SHA selects its manifest rather than the newer branch manifest', () => {
  const fx = pinnedManifestFixture(); const first = commitManifest(fx, 15);
  commitManifest(fx, 25, 'Read');
  expect(runDefault(fx, '--apply', '--update', first).status).toBe(0);
  expect(git(live(fx), 'rev-parse', 'HEAD')).toBe(first);
  expect(JSON.parse(readFileSync(fx.settingsPath, 'utf8')).hooks.PreToolUse[0].hooks[0].timeout).toBe(15);
});
test('missing pinned manifest refuses invoking checkout fallback without writes', () => {
  const fx = pinnedManifestFixture(); const before = readFileSync(fx.settingsPath, 'utf8');
  const result = runDefault(fx, '--apply');
  expect(result.status).not.toBe(0); expect(result.out).toContain('pinned manifest missing');
  expect(existsSync(live(fx))).toBe(false);
  expect(readFileSync(fx.settingsPath, 'utf8')).toBe(before);
});
test('invalid update manifest refuses before moving an existing pin', () => {
  const fx = pinnedManifestFixture(); const first = commitManifest(fx);
  expect(runDefault(fx, '--apply').status).toBe(0);
  const before = readFileSync(fx.settingsPath, 'utf8'); const backups = bakFiles(fx);
  commitManifest(fx, 1000);
  expect(runDefault(fx, '--apply', '--update').status).not.toBe(0);
  expect(git(live(fx), 'rev-parse', 'HEAD')).toBe(first);
  expect(readFileSync(fx.settingsPath, 'utf8')).toBe(before); expect(bakFiles(fx)).toEqual(backups);
});


test('--status reports installed heavy-suite availability without changing settings or the pin', () => {
  const fx = fixture();
  expect(run(fx, '--status').out).toContain('heavy-suite missing (suites run unqueued)');
  // The helper is tracked at the pinned sha: an untracked file in hooks-live is tampering.
  mkdirSync(path.join(fx.repo, 'scripts/hooks'), { recursive: true });
  writeFileSync(path.join(fx.repo, 'scripts/hooks/heavy-suite.py'), 'fixture');
  git(fx.repo, 'add', '-A'); git(fx.repo, 'commit', '-qm', 'helper'); git(fx.repo, 'push', '-q', 'origin', 'HEAD:master');
  expect(run(fx, '--apply').status).toBe(0);
  const sha = git(live(fx), 'rev-parse', 'HEAD');
  const settings = readFileSync(fx.settingsPath, 'utf8');
  const helper = path.join(live(fx), 'scripts/hooks/heavy-suite.py');
  const result = run(fx, '--status');
  expect(result.status).toBe(0);
  expect(result.out).toContain(`heavy-suite available ${helper}`);
  expect(git(live(fx), 'rev-parse', 'HEAD')).toBe(sha);
  expect(readFileSync(fx.settingsPath, 'utf8')).toBe(settings);
  rmSync(helper);
  expect(run(fx, '--status').out).toContain('heavy-suite missing (suites run unqueued)');
});

for (const mode of ["keep", "same-sha"]) {
  for (const drift of ["tracked", "untracked", "ignored", "assume-unchanged", "skip-worktree"]) {
    test(`live integrity refuses ${drift} on ${mode} without host writes`, () => {
      const fx = guardedFixture({ privateSuite: "present" });
      expect(run(fx, "--apply").status).toBe(0);
      const sha = git(live(fx), "rev-parse", "HEAD");
      const source = "scripts/hooks/codex-policy-hook.py";
      if (drift === "untracked") writeFileSync(path.join(live(fx), "scripts/hooks/local.py"), "# local\n");
      else if (drift === "ignored") {
        const exclude = path.resolve(live(fx), git(live(fx), "rev-parse", "--git-path", "info/exclude"));
        mkdirSync(path.dirname(exclude), { recursive: true });
        writeFileSync(exclude, "scripts/hooks/local.py\n");
        writeFileSync(path.join(live(fx), "scripts/hooks/local.py"), "# local\n");
      }
      else {
        if (drift !== "tracked") git(live(fx), "update-index", `--${drift}`, source);
        writeFileSync(path.join(live(fx), source), "# changed live adapter\n");
      }
      const settings = readFileSync(fx.settingsPath), backups = bakFiles(fx);
      const args = mode === "keep" ? ["--apply"] : ["--update", sha, "--apply"];
      const result = run(fx, ...args);
      expect(result.status).not.toBe(0);
      expect(result.out).toContain("live source is dirty");
      expect(readFileSync(fx.settingsPath)).toEqual(settings);
      expect(bakFiles(fx)).toEqual(backups);
      expect(git(live(fx), "rev-parse", "HEAD")).toBe(sha);
    });
  }
}
for (const removed of ["absent", "renamed"]) {
  test(`mbp requires private suites when ${removed}`, () => {
    const fx = guardedFixture({ privateSuite: removed === "renamed" ? "present" : "absent" });
    if (removed === "renamed") renameSync(path.join(fx.repo, "docs.local/private-guard-suites"), path.join(fx.repo, "docs.local/renamed-suites"));
    const before = readFileSync(fx.settingsPath);
    const result = run(fx, "--apply");
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("required private suites unavailable");
    expect(existsSync(live(fx))).toBe(false);
    expect(readFileSync(fx.settingsPath)).toEqual(before);
    expect(bakFiles(fx)).toHaveLength(0);
  });
}

for (const mode of ["keep", "same-sha", "new-sha", "gate-refused"]) {
  test(`derived bytecode is purged before and after concurrent gate write on ${mode}`, () => {
    const fx = guardedFixture({ privateSuite: "present" });
    expect(run(fx, "--apply").status).toBe(0);
    const hook = path.join(live(fx), "skills/golem-powers/demo-gate/hooks/demo-gate.py");
    const cache = path.join(path.dirname(hook), "__pycache__");
    const compile = spawnSync("python3", ["-c", "import py_compile,sys; py_compile.compile(sys.argv[1])", hook]);
    expect(compile.status).toBe(0); expect(existsSync(cache)).toBe(true);
    const testFile = path.join(fx.repo, "scripts/tests/test_codex_policy_hook.py");
    writeFileSync(testFile, `import os, py_compile\nfrom pathlib import Path\ndef test_concurrent_cache():\n    live=Path(os.environ['HOME']).parent/'golems/.worktrees/hooks-live'\n    cache=live/'skills/golem-powers/demo-gate/hooks/__pycache__'\n    assert not cache.exists(), 'pre-gate purge missing'\n    py_compile.compile(str(live/'skills/golem-powers/demo-gate/hooks/demo-gate.py'), doraise=True)\n    assert cache.exists()\n`);
    git(fx.repo, "add", testFile); git(fx.repo, "commit", "-qm", "gate cache writer");
    const next = git(fx.repo, "rev-parse", "HEAD");
    // Keep and same-sha still exercise a concurrent write through the private stage.
    const privateRoot = path.join(fx.repo, "docs.local/private-guard-suites");
    const file = path.join(privateRoot, "test_cache.py");
    writeFileSync(file, readFileSync(testFile));
    const m = JSON.parse(readFileSync(path.join(privateRoot, "manifest.json")));
    m.fixtures.push({path:file,sha256:createHash("sha256").update(readFileSync(file)).digest("hex")}); m.expectedCases++;
    writeFileSync(path.join(privateRoot, "manifest.json"), JSON.stringify(m));
    // Only one stage writes: the private stage for keep/same, public stage for new.
    if (mode === "new-sha") { m.fixtures.pop(); m.expectedCases--; writeFileSync(path.join(privateRoot, "manifest.json"), JSON.stringify(m)); }
    const current = git(live(fx), "rev-parse", "HEAD");
    const result = run(fx, ...(mode === "keep" ? [] : ["--update", mode === "same-sha" ? current : next]), "--apply");
    if (mode === "gate-refused") expect(result.status).not.toBe(0);
    else expect(result.status).toBe(0);
    expect(existsSync(cache)).toBe(false);
    expect(git(live(fx), "rev-parse", "HEAD")).toBe(mode === "new-sha" ? next : current);
  });
}
test("machine identity refuses m1 flag on mbp even with absent private suites", () => {
  const fx = guardedFixture(); fx.host = "m1"; fx.machine = "MacBook-Pro";
  const m = manifestFor(); m.hosts.m1 = structuredClone(m.hosts.mbp); writeFileSync(fx.manifest, JSON.stringify(m));
  const before = readFileSync(fx.settingsPath); const result = run(fx, "--apply");
  expect(result.status).not.toBe(0); expect(result.out).toContain("machine identity");
  expect(existsSync(live(fx))).toBe(false); expect(readFileSync(fx.settingsPath)).toEqual(before);
});
test("machine identity ignores an environment host override and refuses unknown machines", () => {
  const fx = guardedFixture({ privateSuite: "present" }); fx.machine = "unknown-machine"; fx.env = { REPOGOLEM_HOST: "MacBook-Pro" };
  const result = run(fx, "--apply"); expect(result.status).not.toBe(0); expect(result.out).toContain("machine identity");
  expect(existsSync(live(fx))).toBe(false); expect(bakFiles(fx)).toHaveLength(0);
});
for (const mode of ["keep", "same-sha"]) {
  test(`live integrity rejects dirt despite inherited Git environment on ${mode}`, () => {
    const fx = guardedFixture({ privateSuite: "present" }); expect(run(fx, "--apply").status).toBe(0);
    const sha = git(live(fx), "rev-parse", "HEAD"); const source = "scripts/hooks/codex-policy-hook.py";
    const clean = path.join(fx.root, "clean"); git(fx.root, "clone", "-q", fx.repo, clean);
    writeFileSync(path.join(live(fx), source), "# dirty live\n");
    fx.env = { GIT_WORK_TREE: clean };
    const before = readFileSync(fx.settingsPath), backups = bakFiles(fx);
    const result = run(fx, ...(mode === "keep" ? [] : ["--update", sha]), "--apply");
    expect(result.status).not.toBe(0); expect(result.out).toContain("live source is dirty");
    expect(readFileSync(fx.settingsPath)).toEqual(before); expect(bakFiles(fx)).toEqual(backups);
    expect(git(live(fx), "rev-parse", "HEAD")).toBe(sha);
  });
}

test("clean installer ignores inherited Git directory instead of refusing a valid source", () => {
  const fx = guardedFixture({ privateSuite: "present" });
  const foreign = path.join(fx.root, "unrelated.git"); git(fx.root, "init", "-q", "--bare", foreign);
  fx.env = { GIT_DIR: foreign, GIT_INDEX_FILE: path.join(foreign, "index") };
  const result = run(fx, "--apply"); expect(result.status).toBe(0);
  expect(git(live(fx), "rev-parse", "--git-common-dir")).toBe(path.join(fx.repo, ".git"));
});

test("all install and status Git calls scrub inherited Git variables, including pin and tamper checks", () => {
  const fx = fixture(); addPinGate(fx, `${FINGERPRINT} fixture\n`);
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const bin = path.join(fx.root, "machine-bin"); mkdirSync(bin, { recursive: true });
  const trace = path.join(fx.root, "git-calls.jsonl");
  writeFileSync(path.join(bin, "git"), "#!/usr/bin/env python3\nimport json, os, sys\n" +
    `with open(${JSON.stringify(trace)}, 'a') as f:\n    f.write(json.dumps({'args':sys.argv[1:],'gitEnv':[k for k in os.environ if k.startswith('GIT_')]})+'\\n')\n` +
    `os.execv(${JSON.stringify(realGit)}, [${JSON.stringify(realGit)}, *sys.argv[1:]])\n`, { mode: 0o755 });
  fx.env = { GIT_GATE_SENTINEL: "synthetic" };
  expect(run(fx, "--apply").status).toBe(0);
  expect(run(fx, "--status").status).toBe(0);
  const calls = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
  for (const command of ["show", "hash-object", "merge-base", "ls-files", "for-each-ref", "unlock"]) {
    expect(calls.some((c) => c.args.includes(command))).toBe(true);
  }
  expect(calls.filter((c) => c.gitEnv.length)).toEqual([]);
});

test("hook commands pin an ABSOLUTE interpreter >= the minimum, never a bare python3; Codex too", () => {
  const fx = fixture();
  withCodex(fx);
  const python = hookPython();
  expect(path.isAbsolute(python)).toBe(true);
  const r = run(fx, "--apply");
  expect(r.status).toBe(0);
  expect(r.out).toContain(`hook python: ${python} (`);
  const commands = Object.values(JSON.parse(readFileSync(fx.settingsPath, "utf8")).hooks).flat()
    .flatMap((g) => g.hooks).map((h) => h.command).filter((c) => c.includes("golems-fail-open.py"));
  expect(commands.length).toBeGreaterThan(0);
  for (const c of commands) expect(c.startsWith(`${python} `)).toBe(true);
  const codex = JSON.parse(readFileSync(path.join(fx.home, ".codex/hooks.json"), "utf8")).hooks.PreToolUse
    .flatMap((g) => g.hooks).map((h) => h.command);
  expect(codex.length).toBe(2);
  for (const c of codex) expect(c).toContain(`if output=$('\\''${python}'\\'' '\\''-I'\\''`);
  // Codex trust stays unreviewed in a fixture, so --status exits nonzero; the pin is still reported.
  expect(run(fx, "--status").out).toContain(`hook-python=${python} (`);
});

test("the resolver prefers candidates in order, skips one below the minimum, and returns null when none qualifies", () => {
  const fx = fixture();
  const old = fakePython(fx, "old", "3.9.6");
  const ok = fakePython(fx, "ok", `${MIN_HOOK_PYTHON[0]}.${MIN_HOOK_PYTHON[1]}.0`);
  const newer = fakePython(fx, "newer", "3.14.7");
  expect(resolveHookPython({ candidates: [old, ok, newer] })).toEqual({ python: ok, version: `${MIN_HOOK_PYTHON.join(".")}.0` });
  expect(resolveHookPython({ candidates: [path.join(fx.root, "absent"), newer] })?.python).toBe(newer);
  expect(resolveHookPython({ candidates: [old], pathPython: old })).toBeNull();
  expect(resolveHookPython({ candidates: ["python3"] })).toBeNull();  // relative is never pinned
  const spaced = path.join(fx.root, "fake python"); mkdirSync(spaced);
  writeFileSync(path.join(spaced, "python3"), readFileSync(newer), { mode: 0o755 });
  expect(resolveHookPython({ candidates: [path.join(spaced, "python3")] })).toBeNull();  // commands are unquoted
});

test("--apply refuses, writing nothing, when the chosen interpreter is below the minimum, missing or relative", () => {
  for (const pick of ["old", "missing", "relative"]) {
    const fx = fixture();
    // With a config.toml the Codex plan runs an interpreter: the refusal must come first.
    withCodex(fx);
    mkdirSync(path.join(fx.home, ".codex"), { recursive: true });
    writeFileSync(path.join(fx.home, ".codex/config.toml"), "model = \"m\"\n");
    const before = readFileSync(fx.settingsPath, "utf8");
    const python = pick === "old" ? fakePython(fx, "old", "3.9.6") : pick === "missing" ? path.join(fx.root, "nope") : "python3";
    const r = run(fx, "--apply", "--python", python);
    expect([pick, r.status]).toEqual([pick, 1]);
    expect(r.out).toContain("no acceptable hook interpreter");
    expect(readFileSync(fx.settingsPath, "utf8")).toBe(before);
    expect(existsSync(live(fx))).toBe(false);
    expect(existsSync(path.join(fx.home, ".codex/hooks.json"))).toBe(false);
  }
});

test("--status flags a registered hook command whose interpreter is bare, missing, or below the minimum", () => {
  const fx = fixture();
  expect(run(fx, "--apply").status).toBe(0);
  const python = hookPython();
  const pinned = readFileSync(fx.settingsPath, "utf8");
  for (const [label, swap] of [["bare", "python3"], ["missing", path.join(fx.root, "gone/python3")],
    ["old", fakePython(fx, "old", "3.9.6")]]) {
    writeFileSync(fx.settingsPath, pinned.replaceAll(`"${python} `, `"${swap} `));
    const st = run(fx, "--status");
    expect([label, st.status]).toEqual([label, 1]);
    expect(st.out).toContain(`demo-gate interpreter BAD: ${swap} (`);
  }
  writeFileSync(fx.settingsPath, pinned);
  expect(run(fx, "--status").status).toBe(0);
});

// A golems hook dropped from the manifest (#579 retired precompact-checkpoint):
// its registration and its dangling hooks-live link must not outlive it.
function retiredFixture() {
  const fx = fixture();
  const hooksDir = path.join(fx.home, ".claude/hooks");
  const retired = { type: "command", command: `python3 ${hooksDir}/golems-fail-open.py ${hooksDir}/precompact-checkpoint.py`, timeout: 30 };
  // Not golems: a regular file in the hooks dir, a link that points elsewhere, an old backup.
  const foreign = { type: "command", command: `python3 ${hooksDir}/cmux-self-register.py` };
  writeFileSync(path.join(hooksDir, "cmux-self-register.py"), "print('{}')\n");
  symlinkSync(path.join(fx.root, "elsewhere/gone.py"), path.join(hooksDir, "foreign-dangling.py"));
  writeFileSync(path.join(hooksDir, "pre_tool_use.py.bak-20260101"), "# old\n");
  const settings = { ...UNRELATED, hooks: { SessionStart: [{ hooks: [EXTERNAL, foreign] }], PreCompact: [{ hooks: [retired] }] } };
  writeFileSync(fx.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  symlinkSync(path.join(live(fx), "hooks/precompact-checkpoint.py"), path.join(hooksDir, "precompact-checkpoint.py"));
  return { fx, hooksDir, retired, foreign };
}

test("retired golems hooks: dry-run and --status name them; --apply removes the registration and dangling link only; idempotent", () => {
  const { fx, hooksDir, foreign } = retiredFixture();
  const link = path.join(hooksDir, "precompact-checkpoint.py");
  const before = readFileSync(fx.settingsPath, "utf8");
  const dry = run(fx);
  expect(dry.status).toBe(0);
  expect(dry.out).toContain("would remove retired registration: precompact-checkpoint.py (PreCompact)");
  expect(dry.out).toContain("would remove dangling golems link: precompact-checkpoint.py");
  expect(readFileSync(fx.settingsPath, "utf8")).toBe(before);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);

  expect(run(fx, "--apply").status).toBe(0);
  const after = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  expect(after.hooks.PreCompact).toBeUndefined();
  expect(after.hooks.SessionStart).toEqual([{ hooks: [EXTERNAL, foreign] }]);  // external + foreign byte-identical
  const { hooks: _h, ...rest } = after;
  expect(JSON.stringify(rest)).toBe(JSON.stringify(UNRELATED));
  expect(existsSync(link) || (() => { try { lstatSync(link); return true; } catch { return false; } })()).toBe(false);
  expect(lstatSync(path.join(hooksDir, "foreign-dangling.py")).isSymbolicLink()).toBe(true);
  expect(readFileSync(path.join(hooksDir, "cmux-self-register.py"), "utf8")).toBe("print('{}')\n");
  expect(readFileSync(path.join(hooksDir, "pre_tool_use.py.bak-20260101"), "utf8")).toBe("# old\n");
  expect(readFileSync(path.join(fx.home, ".claude", bakFiles(fx)[0]), "utf8")).toBe(before);

  const once = readFileSync(fx.settingsPath, "utf8");
  const again = run(fx, "--apply");
  expect(again.status).toBe(0);
  expect(again.out).not.toMatch(/retired registration|dangling golems link/);
  expect(readFileSync(fx.settingsPath, "utf8")).toBe(once);
  expect(run(fx, "--status").status).toBe(0);
});

test("--status exits nonzero on a retired golems registration and on a dangling golems link, each named", () => {
  const { fx, hooksDir, retired } = retiredFixture();
  expect(run(fx, "--apply").status).toBe(0);
  // Re-plant the residue after a clean install.
  const s = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  s.hooks.PreCompact = [{ hooks: [retired] }];
  writeFileSync(fx.settingsPath, `${JSON.stringify(s, null, 2)}\n`);
  let st = run(fx, "--status");
  expect([st.status, st.out]).toEqual([1, expect.stringContaining("retired-registered: precompact-checkpoint.py (PreCompact)")]);
  writeFileSync(fx.settingsPath, readFileSync(fx.settingsPath, "utf8").replace(/,\n {4}"PreCompact"[\s\S]*?\n {4}\]/, ""));
  expect(JSON.parse(readFileSync(fx.settingsPath, "utf8")).hooks.PreCompact).toBeUndefined();
  symlinkSync(path.join(live(fx), "hooks/precompact-checkpoint.py"), path.join(hooksDir, "precompact-checkpoint.py"));
  st = run(fx, "--status");
  expect([st.status, st.out]).toEqual([1, expect.stringContaining("dangling golems link: precompact-checkpoint.py")]);
  expect(st.out).not.toContain("foreign-dangling");
});

// #661 review follow-up (F1-F3): ownership from the executed path, scoped
// empty-group cleanup, lexical link resolution. Built from the reviewer's probes.
const hookCmd = (command) => ({ type: "command", command });
function settingsFixture(hooksFor, setup) {
  const fx = fixture();
  const hooksDir = path.join(fx.home, ".claude/hooks");
  const L = live(fx);
  writeFileSync(fx.settingsPath, `${JSON.stringify({ ...UNRELATED, hooks: hooksFor({ fx, hooksDir, L }) }, null, 2)}\n`);
  if (setup) setup({ fx, hooksDir, L });
  return { fx, hooksDir, L };
}
const linkExists = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

test("F1: only the executed program/script decides golems ownership; a hooks-live path as data or a near-miss launcher survives", () => {
  const { fx, hooksDir, L } = settingsFixture(({ fx, hooksDir, L }) => ({
    SessionStart: [{ hooks: [EXTERNAL] }],
    Stop: [{ hooks: [
      hookCmd(`node /elsewhere/my-tool.js --root ${L}/`),
      hookCmd(`python3 ${hooksDir}/golems-fail-open.pyx /elsewhere/x.py`),
      hookCmd(`python3 /elsewhere/tool.py ${hooksDir}/golems-fail-open.py`),
      hookCmd(`python3 ${fx.home}/.claude/hooks-golems/x.py`),
      hookCmd(`python3 ${L}-old/scripts/x.py`),
      hookCmd(`python3 ${hooksDir}/near-link.py`),
    ] }],
    PreCompact: [{ hooks: [hookCmd(`python3 ${hooksDir}/golems-fail-open.py ${hooksDir}/precompact-checkpoint.py`)] }],
    Notification: [{ hooks: [hookCmd(`node ${L}/skills/retired-gate/hook.mjs`)] }],
  }), ({ hooksDir, L }) => symlinkSync(`${L}-old/x.py`, path.join(hooksDir, "near-link.py")));
  const before = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  const dry = run(fx);
  expect(dry.status).toBe(0);
  expect(dry.out.split("\n").filter((l) => l.includes("retired registration")).sort()).toEqual([
    "would remove retired registration: precompact-checkpoint.py (PreCompact)",
    "would remove retired registration: skills/retired-gate/hook.mjs (Notification)",
  ]);
  expect(run(fx, "--apply").status).toBe(0);
  const after = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  expect(after.hooks.Stop).toEqual(before.hooks.Stop);
  expect(after.hooks.PreCompact).toBeUndefined();
  expect(after.hooks.Notification).toBeUndefined();
});

test("F2: a mixed group keeps its foreign hooks, matcher and extra keys; pre-existing empty foreign entries stay; null events are skipped", () => {
  const { fx, hooksDir } = settingsFixture(({ hooksDir }) => ({
    SessionStart: [{ hooks: [EXTERNAL] }],
    PreCompact: [{ matcher: "auto", extra: 1, hooks: [
      hookCmd("python3 /elsewhere/mine-before.py"),
      { type: "command", command: `python3 ${hooksDir}/golems-fail-open.py ${hooksDir}/precompact-checkpoint.py`, timeout: 30 },
      hookCmd("python3 /elsewhere/mine-after.py"),
    ] }],
    Notification: [],
    UserPromptSubmit: [{ matcher: "", hooks: [] }],
    SubagentStop: [{ matcher: "x" }],
    Elicitation: null,
  }));
  for (const mode of [[], ["--status"]]) expect(run(fx, ...mode).out).not.toMatch(/TypeError|Cannot read/);
  expect(run(fx, "--apply").status).toBe(0);
  const after = JSON.parse(readFileSync(fx.settingsPath, "utf8"));
  expect(after.hooks.PreCompact).toEqual([{ matcher: "auto", extra: 1, hooks: [
    hookCmd("python3 /elsewhere/mine-before.py"), hookCmd("python3 /elsewhere/mine-after.py")] }]);
  expect(after.hooks.Notification).toEqual([]);
  expect(after.hooks.UserPromptSubmit).toEqual([{ matcher: "", hooks: [] }]);
  expect(after.hooks.SubagentStop).toEqual([{ matcher: "x" }]);
  expect(after.hooks.Elicitation).toBeNull();
  const { hooks: _h, ...rest } = after;
  expect(rest).toEqual(UNRELATED);
});

test("F3: link targets resolve lexically before the hooks-live check, and *.bak* links are never removed", () => {
  const { fx, hooksDir, L } = settingsFixture(() => ({ SessionStart: [{ hooks: [EXTERNAL] }] }), ({ hooksDir, L }) => {
    symlinkSync(`${L}/gone/a.py`, path.join(hooksDir, "dangling-into-live.py"));
    symlinkSync(`${L}/gone/b.py`, path.join(hooksDir, "old.py.bak-20260101"));
    symlinkSync(`${L}/../../escape/f.py`, path.join(hooksDir, "dotdot.py"));
    symlinkSync(path.relative(hooksDir, path.join(L, "gone/rel.py")), path.join(hooksDir, "relative-into-live.py"));
    symlinkSync(`${L}-old/c.py`, path.join(hooksDir, "near-miss.py"));
  });
  const dry = run(fx);
  expect(dry.out.split("\n").filter((l) => l.includes("dangling golems link")).sort()).toEqual([
    "would remove dangling golems link: dangling-into-live.py",
    "would remove dangling golems link: relative-into-live.py",
  ]);
  expect(run(fx, "--apply").status).toBe(0);
  expect(["dangling-into-live.py", "relative-into-live.py", "old.py.bak-20260101", "dotdot.py", "near-miss.py"]
    .map((n) => [n, linkExists(path.join(hooksDir, n))]))
    .toEqual([["dangling-into-live.py", false], ["relative-into-live.py", false], ["old.py.bak-20260101", true],
      ["dotdot.py", true], ["near-miss.py", true]]);
});
