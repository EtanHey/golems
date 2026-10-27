import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GEMINI_SKILLS_ROOT, SKILL_ROOTS } from "./repoint-skills.mjs";

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

test("the managed Gemini root is ~/.gemini/config/skills, not ~/.gemini/antigravity/skills", () => {
  // #277: the Gemini CLI loads global skills from ~/.gemini/config/skills only.
  expect(GEMINI_SKILLS_ROOT).toBe(".gemini/config/skills");
  expect(SKILL_ROOTS).toContain(".gemini/config/skills");
  expect(SKILL_ROOTS.some((root) => root.includes("antigravity"))).toBe(false);
});

test("~/.gemini/antigravity/skills is not walked and nothing there is deleted", () => {
  const fx = fixture();
  const legacy = path.join(fx.home, ".gemini", "antigravity", "skills");
  mkdirSync(legacy, { recursive: true });
  symlinkSync(path.join(fx.home, "gone", "y"), path.join(legacy, "no-such-skill")); // dangling, would be removed if managed
  const r = run(fx, "--apply");
  expect(r.status).toBe(0);
  expect(r.out).not.toMatch(/antigravity/);
  expect(lstatSync(path.join(legacy, "no-such-skill")).isSymbolicLink()).toBe(true);
});

test("the Gemini root ~/.gemini/config/skills is walked with the same rules", () => {
  // #269/#277: the Gemini CLI reads a fourth skill root.
  const fx = fixture();
  const gemini = path.join(fx.home, ".gemini", "config", "skills");
  mkdirSync(gemini, { recursive: true });
  const gone = path.join(fx.home, "Gits", "golems.wt", "dead", "skills", "golem-powers", "pr-loop");
  symlinkSync(gone, path.join(gemini, "pr-loop"));                                  // dangling, name in source -> repoint
  symlinkSync(path.join(fx.home, "gone", "y"), path.join(gemini, "no-such-skill")); // dangling, no source -> removed
  symlinkSync(path.join(fx.source, "eli5"), path.join(gemini, "eli5"));             // already right -> ok

  const dry = run(fx);
  expect(dry.status).toBe(0);
  expect(dry.out).toMatch(/\.gemini\/config\/skills: ok=1 repoint=1 dangling=1 other=0/);

  expect(run(fx, "--apply").status).toBe(0);
  expect(readlinkSync(path.join(gemini, "pr-loop"))).toBe(path.join(fx.source, "pr-loop"));
  expect(() => lstatSync(path.join(gemini, "no-such-skill"))).toThrow();
  expect(run(fx).out).toMatch(/\.gemini\/config\/skills: ok=2 repoint=0 dangling=0 other=0/);
});

test("a missing root is skipped with a one-line note, not an error", () => {
  const fx = fixture(); // no ~/.gemini/config/skills
  rmSync(fx.codex, { recursive: true, force: true });
  const r = run(fx, "--apply");
  expect(r.status).toBe(0);
  expect(r.out).toMatch(/^~\/\.gemini\/config\/skills: skipped \(missing\)$/m);
  expect(r.out).toMatch(/^~\/\.codex\/skills: skipped \(missing\)$/m);
  expect(existsSync(path.join(fx.home, ".gemini"))).toBe(false);
  expect(r.out).toMatch(/\.claude\/skills: ok=1 repoint=1 dangling=1 other=3/);
});

// #272/#277: --link-missing mirrors golems links from ~/.agents/skills into the Gemini root.
function geminiFixture() {
  const fx = fixture();
  for (const name of ["pr-loop", "orc", "eli5"]) writeFileSync(path.join(fx.source, name, "SKILL.md"), `# ${name}\n`);
  symlinkSync(path.join(fx.source, "pr-loop"), path.join(fx.agents, "pr-loop"));
  symlinkSync(path.join(fx.source, "eli5"), path.join(fx.agents, "eli5"));
  const gemini = path.join(fx.home, ".gemini", "config", "skills");
  mkdirSync(gemini, { recursive: true });
  return { ...fx, gemini };
}

test("--link-missing links a golems skill that ~/.agents/skills has and ~/.gemini/config/skills lacks", () => {
  const fx = geminiFixture();
  const dry = run(fx, "--link-missing");
  expect(dry.status).toBe(0);
  expect(dry.out).toMatch(/linked=3/); // pr-loop, eli5, and orc (a stale link the walk repoints)
  expect(() => lstatSync(path.join(fx.gemini, "pr-loop"))).toThrow();

  const r = run(fx, "--link-missing", "--apply");
  expect(r.status).toBe(0);
  expect(r.out).toMatch(/linked=3/);
  expect(readlinkSync(path.join(fx.gemini, "pr-loop"))).toBe("../../../.agents/skills/pr-loop");
  expect(realpathSync(path.join(fx.gemini, "pr-loop"))).toBe(path.join(fx.source, "pr-loop"));
  expect(readlinkSync(path.join(fx.gemini, "eli5"))).toBe("../../../.agents/skills/eli5");
  expect(realpathSync(path.join(fx.gemini, "orc"))).toBe(path.join(fx.source, "orc"));
  expect(run(fx, "--link-missing").out).toMatch(/linked=0/);
});

test("--link-missing never overwrites an existing Gemini entry", () => {
  const fx = geminiFixture();
  mkdirSync(path.join(fx.home, "elsewhere", "pr-loop"), { recursive: true });
  symlinkSync(path.join(fx.home, "elsewhere", "pr-loop"), path.join(fx.gemini, "pr-loop"));
  mkdirSync(path.join(fx.gemini, "eli5"));
  const r = run(fx, "--link-missing", "--apply");
  expect(r.status).toBe(0);
  expect(r.out).toMatch(/linked=1/); // only orc; pr-loop and eli5 already have entries
  expect(readlinkSync(path.join(fx.gemini, "pr-loop"))).toBe(path.join(fx.home, "elsewhere", "pr-loop"));
  expect(lstatSync(path.join(fx.gemini, "eli5")).isDirectory()).toBe(true);
});

test("--link-missing does not mirror a non-golems entry in ~/.agents/skills", () => {
  const fx = geminiFixture();
  const foreign = path.join(fx.home, "Gits", "other-repo", "skills", "foreign");
  mkdirSync(foreign, { recursive: true });
  writeFileSync(path.join(foreign, "SKILL.md"), "# foreign\n");
  symlinkSync(foreign, path.join(fx.agents, "foreign"));
  const r = run(fx, "--link-missing", "--apply");
  expect(r.status).toBe(0);
  expect(r.out).toMatch(/linked=3/);
  expect(() => lstatSync(path.join(fx.gemini, "foreign"))).toThrow();
});

test("--link-missing skips entirely when ~/.gemini/config does not exist", () => {
  const fx = geminiFixture();
  rmSync(path.join(fx.home, ".gemini", "config"), { recursive: true, force: true });
  mkdirSync(path.join(fx.home, ".gemini", "antigravity"), { recursive: true }); // does not count
  const r = run(fx, "--link-missing", "--apply");
  expect(r.status).toBe(0);
  expect(r.out).toMatch(/^~\/\.gemini\/config: link-missing skipped \(missing\)$/m);
  expect(r.out).not.toMatch(/linked=/);
  expect(existsSync(path.join(fx.home, ".gemini", "config"))).toBe(false);
  expect(existsSync(path.join(fx.home, ".gemini", "antigravity", "skills"))).toBe(false);
});

// Vendor fan-out is separate from the broad legacy-link cleanup.
function vendorFixture() {
  const fx = fixture();
  const vendor = path.join(path.dirname(fx.source), "vendor");
  const text = "---\nname: emil-design-eng\ndescription: Design UI.\n---\n";
  const file = "anthropic/emil-design-eng/SKILL.md";
  mkdirSync(path.dirname(path.join(vendor, file)), { recursive: true });
  writeFileSync(path.join(vendor, file), text);
  const manifest = { schema: 1, providers: ["claude", "codex"], skills: [{ name: "emil-design-eng", path: "anthropic/emil-design-eng" }],
    files: { [file]: createHash("sha256").update(text).digest("hex") } };
  writeFileSync(path.join(vendor, "manifest.json"), JSON.stringify(manifest));
  return { ...fx, vendor, manifest, file };
}

test("vendor dry-run verifies bytes without creating any installed skill", () => {
  const fx = vendorFixture();
  const r = run(fx, "--vendor-skills");
  expect(r.status).toBe(0);
  expect(r.out).toContain("emil-design-eng");
  expect(existsSync(path.join(fx.codex, "emil-design-eng"))).toBe(false);
  expect(existsSync(path.join(fx.home, ".golems/vendor"))).toBe(false);
});

test("vendor apply is durable, single-source, idempotent and Claude/Codex only", () => {
  const fx = vendorFixture();
  expect(run(fx, "--vendor-skills", "--apply").status).toBe(0);
  const target = realpathSync(path.join(fx.codex, "emil-design-eng"));
  expect(target).toContain(path.join(fx.home, ".golems/vendor"));
  expect(realpathSync(path.join(fx.claude, "emil-design-eng"))).toBe(target);
  expect(existsSync(path.join(fx.agents, "emil-design-eng"))).toBe(false);
  expect(existsSync(path.join(fx.home, ".cursor/skills/emil-design-eng"))).toBe(false);
  expect(existsSync(path.join(fx.home, ".gemini"))).toBe(false);
  expect(lstatSync(path.join(fx.claude, "dangling")).isSymbolicLink()).toBe(true);
  expect(run(fx, "--vendor-skills", "--apply").status).toBe(0);
  rmSync(fx.vendor, { recursive: true });
  expect(existsSync(path.join(target, "SKILL.md"))).toBe(true);
});

test("vendor conflicts and tampered source fail before any link or copy is installed", () => {
  const fx = vendorFixture();
  mkdirSync(path.join(fx.codex, "emil-design-eng"));
  expect(run(fx, "--vendor-skills", "--apply").status).not.toBe(0);
  expect(existsSync(path.join(fx.claude, "emil-design-eng"))).toBe(false);
  expect(existsSync(path.join(fx.home, ".golems/vendor"))).toBe(false);
  rmSync(path.join(fx.codex, "emil-design-eng"), { recursive: true });
  writeFileSync(path.join(fx.vendor, fx.file), "unreviewed change");
  expect(run(fx, "--vendor-skills", "--apply").status).not.toBe(0);
  expect(existsSync(path.join(fx.claude, "emil-design-eng"))).toBe(false);
});

test("adding Cursor later is one provider-list edit", () => {
  const fx = vendorFixture();
  expect(run(fx, "--vendor-skills", "--apply").status).toBe(0);
  fx.manifest.providers.push("cursor");
  writeFileSync(path.join(fx.vendor, "manifest.json"), JSON.stringify(fx.manifest));
  expect(run(fx, "--vendor-skills", "--apply").status).toBe(0);
  expect(existsSync(path.join(fx.home, ".cursor/skills/emil-design-eng/SKILL.md"))).toBe(true);
  expect(run(fx, "--vendor-skills", "--apply").status).toBe(0);
});

test("upstream drift is distinct from a query error", async () => {
  const { checkUpstream } = await import("./vendor-skills.mjs");
  const commit = "a".repeat(40);
  const manifest = { upstreams: [{ url: "https://example.test/skills.git", ref: "refs/heads/main", commit }] };
  expect(checkUpstream(manifest, () => commit)[0].drift).toBe(false);
  expect(checkUpstream(manifest, () => "b".repeat(40))[0].drift).toBe(true);
  expect(() => checkUpstream(manifest, () => { throw new Error("offline"); })).toThrow("offline");
  expect(() => checkUpstream(manifest, () => "bad response")).toThrow("invalid upstream response");
});

test("Claude keeps its official frontend-design plugin; vendor frontend is Codex/Cursor only", () => {
  const fx = vendorFixture();
  const text = "---\nname: frontend-design\ndescription: Design.\n---\n";
  const file = "anthropic/frontend-design/SKILL.md";
  mkdirSync(path.dirname(path.join(fx.vendor, file)), { recursive: true });
  writeFileSync(path.join(fx.vendor, file), text);
  fx.manifest.files[file] = createHash("sha256").update(text).digest("hex");
  fx.manifest.providers.push("cursor");
  fx.manifest.skills.push({ name: "frontend-design", path: "anthropic/frontend-design", providers: ["codex", "cursor"] });
  writeFileSync(path.join(fx.vendor, "manifest.json"), JSON.stringify(fx.manifest));
  expect(run(fx, "--vendor-skills", "--apply").status).toBe(0);
  expect(existsSync(path.join(fx.claude, "frontend-design"))).toBe(false);
  expect(existsSync(path.join(fx.codex, "frontend-design/SKILL.md"))).toBe(true);
  expect(existsSync(path.join(fx.home, ".cursor/skills/frontend-design/SKILL.md"))).toBe(true);
});

test("updater dry-run is inert, apply refreshes reviewed bytes, and mismatched SHA refuses", async () => {
  const { refreshVendor } = await import("./refresh-vendor.mjs");
  const fx = vendorFixture(), commit = "a".repeat(40), old = "b".repeat(40);
  fx.manifest.upstreams = [{ url: "https://example.test/skills.git", commit: old }];
  writeFileSync(path.join(fx.vendor, "manifest.json"), JSON.stringify(fx.manifest));
  writeFileSync(path.join(fx.vendor, "VENDOR.md"), old);
  const clone = path.join(fx.home, "reviewed"), text = "reviewed new instructions";
  mkdirSync(path.join(clone, "skills/emil-design-eng"), { recursive: true });
  writeFileSync(path.join(clone, "skills/emil-design-eng/SKILL.md"), text);
  const git = (_, args) => ({ status: 0, stdout: args.includes("rev-parse") ? commit : "" });
  const options = { vendor: fx.vendor, clones: [clone], reviewed: [commit], git };
  const before = readFileSync(path.join(fx.vendor, fx.file), "utf8");
  expect(refreshVendor(options).apply).toBe(false);
  expect(readFileSync(path.join(fx.vendor, fx.file), "utf8")).toBe(before);
  expect(() => refreshVendor({ ...options, reviewed: [old], apply: true })).toThrow("reviewed SHA");
  refreshVendor({ ...options, apply: true });
  expect(readFileSync(path.join(fx.vendor, fx.file), "utf8")).toBe(text);
  expect(readFileSync(path.join(fx.vendor, "VENDOR.md"), "utf8")).toBe(commit);
});

test("a Codex root symlink into agents refuses before writes, preventing Gemini exposure", () => {
  const fx = vendorFixture();
  rmSync(fx.codex, { recursive: true });
  symlinkSync(fx.agents, fx.codex);
  const r = run(fx, "--vendor-skills", "--apply");
  expect(r.status).not.toBe(0);
  expect(r.out).toContain("vendor root is symlinked");
  expect(existsSync(path.join(fx.claude, "emil-design-eng"))).toBe(false);
  expect(existsSync(path.join(fx.agents, "emil-design-eng"))).toBe(false);
});
