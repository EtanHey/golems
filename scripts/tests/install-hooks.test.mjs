import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { E1_DELETED, pinnedFingerprints } from "../hooks/install-hooks.mjs";

// Every test builds a git fixture and spawns node; a cold CI runner needs headroom.
setDefaultTimeout(30_000);

const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(here, "..", "hooks", "install-hooks.mjs");
const wrapper = path.join(here, "..", "hooks", "fail-open.py");
const realManifest = JSON.parse(readFileSync(path.join(here, "..", "hooks", "manifest.json"), "utf8"));
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=F", "-c", "user.email=f@example.com", ...args], { cwd, encoding: "utf8" });
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

function fixture({ settings } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "install-hooks-")));
  dirs.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "golems");
  git(root, "init", "-q", "--bare", "-b", "master", origin);
  git(root, "clone", "-q", origin, repo);
  mkdirSync(path.join(repo, "skills/golem-powers/demo-gate/hooks"), { recursive: true });
  writeFileSync(path.join(repo, "skills/golem-powers/demo-gate/hooks/demo-gate.py"), "print('{}')\n");
  writeFileSync(path.join(repo, "skills/golem-powers/demo-gate/hooks/demo.mjs"), "process.stdout.write('{}');\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "seed");
  git(repo, "push", "-q", "origin", "HEAD:master");
  const home = path.join(root, "home");
  mkdirSync(path.join(home, ".claude/hooks"), { recursive: true });
  const text = settings ?? `${JSON.stringify({ ...UNRELATED, hooks: { SessionStart: [{ hooks: [EXTERNAL] }] } }, null, 2)}\n`;
  writeFileSync(path.join(home, ".claude/settings.json"), text);
  const manifest = path.join(root, "manifest.json");
  writeFileSync(manifest, JSON.stringify(manifestFor()));
  return { root, repo, home, manifest, settingsPath: path.join(home, ".claude/settings.json") };
}

function run(fx, ...args) {
  const env = { ...process.env, HOME: fx.home, ...(fx.env ?? {}) };
  const r = spawnSync("node", [installer, "--repo", fx.repo, "--manifest", fx.manifest, "--host", "mbp", ...args], {
    encoding: "utf8", env,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const live = (fx) => path.join(fx.repo, ".worktrees/hooks-live");
const bakFiles = (fx) => spawnSync("ls", [path.join(fx.home, ".claude")], { encoding: "utf8" }).stdout
  .split("\n").filter((f) => f.startsWith("settings.json.bak-"));

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
    `python3 ${fx.home}/.claude/hooks/golems-fail-open.py ${fx.home}/.claude/hooks/demo-gate/hooks/demo-gate.py`);
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
    "pre_tool_use", "precompact-checkpoint", "reviewer-order-gate", "tmp-block",
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
