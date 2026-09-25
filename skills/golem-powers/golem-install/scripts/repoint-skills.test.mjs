import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "repoint-skills.mjs");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

// A fake HOME shaped like the M1: skills linked into a stale ~/.golems/skills copy.
function fixture() {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "repoint-home-")));
  dirs.push(home);
  const source = path.join(home, "Gits", "golems", "skills", "golem-powers");
  const stale = path.join(home, ".golems", "skills");
  for (const name of ["pr-loop", "orc", "eli5"]) mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ["pr-loop", "orc", "retired-skill"]) mkdirSync(path.join(stale, name), { recursive: true });
  const claude = path.join(home, ".claude", "skills");
  const agents = path.join(home, ".agents", "skills");
  const codex = path.join(home, ".codex", "skills");
  for (const root of [claude, agents, codex]) mkdirSync(root, { recursive: true });
  symlinkSync(path.join(stale, "pr-loop"), path.join(claude, "pr-loop"));        // stale -> repoint
  symlinkSync(path.join(stale, "retired-skill"), path.join(claude, "retired"));  // stale, no source -> other
  symlinkSync(path.join(source, "eli5"), path.join(claude, "eli5"));             // already right -> ok
  symlinkSync(path.join(home, "gone", "x"), path.join(claude, "dangling"));      // dangling -> removed
  mkdirSync(path.join(claude, "local-copy"));                                    // real dir -> other
  mkdirSync(path.join(home, "Gits", "other-repo", "skills", "orc"), { recursive: true });
  symlinkSync(path.join(home, "Gits", "other-repo", "skills", "orc"), path.join(claude, "other-orc")); // same name, not stale -> other
  symlinkSync(path.join(stale, "orc"), path.join(agents, "orc"));                // stale -> repoint
  symlinkSync(path.join(agents, "orc"), path.join(codex, "orc"));                // chains via agents -> ok after
  return { home, source, claude, agents, codex };
}

function run(fx, ...args) {
  const r = spawnSync("bun", [script, "--source", fx.source, ...args], {
    encoding: "utf8", env: { ...process.env, HOME: fx.home },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("dry-run is the default: it reports per-root counts and changes nothing", () => {
  const fx = fixture();
  const r = run(fx);
  expect(r.status).toBe(0);
  expect(r.out).toContain("dry-run");
  expect(r.out).toMatch(/\.claude\/skills: ok=1 repoint=1 dangling=1 other=3/);
  expect(r.out).toMatch(/\.agents\/skills: ok=0 repoint=1 dangling=0 other=0/);
  expect(readlinkSync(path.join(fx.claude, "pr-loop"))).toContain(".golems");
  expect(lstatSync(path.join(fx.claude, "dangling")).isSymbolicLink()).toBe(true);
});

test("--apply repoints stale links at the clone, drops dangling ones, leaves the rest", () => {
  const fx = fixture();
  expect(run(fx, "--apply").status).toBe(0);
  expect(readlinkSync(path.join(fx.claude, "pr-loop"))).toBe(path.join(fx.source, "pr-loop"));
  expect(readlinkSync(path.join(fx.agents, "orc"))).toBe(path.join(fx.source, "orc"));
  expect(existsSync(path.join(fx.claude, "dangling"))).toBe(false);
  expect(() => lstatSync(path.join(fx.claude, "dangling"))).toThrow();
  expect(readlinkSync(path.join(fx.claude, "retired"))).toContain("retired-skill");
  expect(lstatSync(path.join(fx.claude, "local-copy")).isDirectory()).toBe(true);
  expect(realpathSync(path.join(fx.codex, "orc"))).toBe(path.join(fx.source, "orc"));

  const again = run(fx);
  expect(again.out).toMatch(/\.claude\/skills: ok=2 repoint=0 dangling=0 other=3/);
  expect(readlinkSync(path.join(fx.claude, "other-orc"))).toContain("other-repo");
  expect(again.out).toMatch(/\.codex\/skills: ok=1 repoint=0 dangling=0 other=0/);
});

test("refuses a --source that is not a golem-powers skills directory", () => {
  const fx = fixture();
  const r = spawnSync("bun", [script, "--source", path.join(fx.home, "nowhere")], {
    encoding: "utf8", env: { ...process.env, HOME: fx.home },
  });
  expect(r.status).not.toBe(0);
  expect(`${r.stdout}${r.stderr}`).toContain("not a golem-powers skills directory");
});

test("a DANGLING link whose name exists in the clone is repointed, never deleted (the MBP collab-monitor shape)", () => {
  // r7 on #232: ~/.agents/skills/collab-monitor pointed into a deleted worktree
  // (golems.wt/collab-monitor-skill/...), and ~/.codex/skills/collab-monitor chains
  // through it. Deleting it would remove the skill; the clone has it, so repoint.
  const fx = fixture();
  mkdirSync(path.join(fx.source, "collab-monitor"));
  const gone = path.join(fx.home, "Gits", "golems.wt", "collab-monitor-skill", "skills", "golem-powers", "collab-monitor");
  symlinkSync(gone, path.join(fx.agents, "collab-monitor"));
  symlinkSync(path.join(fx.agents, "collab-monitor"), path.join(fx.codex, "collab-monitor"));
  symlinkSync(path.join(fx.source, "railway"), path.join(fx.agents, "railway")); // retired: no source -> removed

  const dry = run(fx);
  expect(dry.out).toMatch(/\.agents\/skills: ok=0 repoint=2 dangling=1 other=0/);

  expect(run(fx, "--apply").status).toBe(0);
  expect(readlinkSync(path.join(fx.agents, "collab-monitor"))).toBe(path.join(fx.source, "collab-monitor"));
  expect(realpathSync(path.join(fx.codex, "collab-monitor"))).toBe(path.join(fx.source, "collab-monitor"));
  expect(() => lstatSync(path.join(fx.agents, "railway"))).toThrow();
});
