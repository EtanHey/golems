import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { E1_DELETED } from "../hooks/install-hooks.mjs";

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
    "brainlayer-prompt-search", "brainlayer-session-start", "daemon-gate-precheck", "model-pin-gate",
    "precompact-checkpoint",
  ]);
  expect(realManifest.hosts.m1.some((h) => h.event === "Stop")).toBe(false);
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
