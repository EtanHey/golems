import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROLLUP = join(import.meta.dir, "rollup.mjs");
const NOW = "2026-06-15";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Build <repo>/docs.local from { "relative/path": "content" }.
function fixture(files) {
  const repo = mkdtempSync(join(tmpdir(), "drive-filing-rollup-"));
  roots.push(repo);
  for (const [rel, content] of Object.entries(files)) {
    const file = join(repo, "docs.local", rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return repo;
}

function rollup(repo, ...extra) {
  const result = spawnSync(
    process.execPath,
    [ROLLUP, "--repo", repo, "--keep-months", "2", "--now", NOW, ...extra],
    { encoding: "utf8" },
  );
  return { ...result, lines: result.stdout.trim().split("\n") };
}

function plan(repo, ...extra) {
  const result = rollup(repo, "--json", ...extra);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const uploadPaths = (p) => p.upload.flatMap((unit) => unit.files.map((f) => f.path));

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name))
    .sort();
}

describe("credential exclusion (hard requirement)", () => {
  test("auth.json under .codex-home* and .env.local never reach the upload plan", () => {
    const repo = fixture({
      "2026-01-05-x/.codex-home-test/auth.json": '{"tokens":"secret"}',
      "2026-01-05-x/report.md": "report",
      "2026-01-06-y/.env.local": "API_KEY=secret",
      "2026-01-06-y/notes.md": "notes",
      "2026-01-07-z/plan.md": "plan",
    });
    const p = plan(repo);
    const uploads = uploadPaths(p);
    expect(uploads.some((f) => f.includes("auth.json"))).toBe(false);
    expect(uploads.some((f) => f.includes(".env.local"))).toBe(false);
    expect(uploads).toContain("docs.local/2026-01-07-z/plan.md");

    const text = rollup(repo);
    expect(text.lines).toContain("skipped: credential docs.local/2026-01-05-x/.codex-home-test/ (1 files)");
    expect(text.lines).toContain("skipped: credential docs.local/2026-01-05-x/.codex-home-test/auth.json");
    expect(text.lines).toContain("skipped: credential docs.local/2026-01-06-y/.env.local");
  });

  test("a dated item holding a credential is held whole: not moved, not uploaded", () => {
    const repo = fixture({
      "2026-01-05-x/.codex-home-test/auth.json": "{}",
      "2026-01-05-x/report.md": "report",
    });
    const p = plan(repo);
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-01-05-x"]);
    expect(p.moves).toEqual([]);
    expect(uploadPaths(p)).toEqual([]);
  });

  test("every credential pattern matches case-insensitively", () => {
    const repo = fixture({
      "notes/server.PEM": "x",
      "notes/id.key": "x",
      "notes/.ENV": "x",
      "notes/Credentials.json": "x",
      "notes/github-TOKEN.txt": "x",
      "notes/Auth.JSON": "x",
      "boxes/.Claude-Home/settings.md": "x",
      "boxes/golems-HOME-copy/readme.md": "x",
      "boxes/.codex-home/sessions/a.jsonl": "x",
      "notes/fine.md": "x",
    });
    const skipped = plan(repo).skipped.map((s) => s.path).sort();
    expect(skipped).toEqual(
      [
        "docs.local/boxes/.Claude-Home",
        "docs.local/boxes/.codex-home",
        "docs.local/boxes/golems-HOME-copy",
        "docs.local/notes/.ENV",
        "docs.local/notes/Auth.JSON",
        "docs.local/notes/Credentials.json",
        "docs.local/notes/github-TOKEN.txt",
        "docs.local/notes/id.key",
        "docs.local/notes/server.PEM",
      ].sort(),
    );
  });

  test("--apply leaves credential files exactly where they were", () => {
    const repo = fixture({
      "2026-01-05-x/.codex-home-test/auth.json": "{}",
      "2026-01-05-x/report.md": "report",
      "2026-01-06-y/.env.local": "API_KEY=secret",
    });
    rollup(repo, "--apply");
    expect(existsSync(join(repo, "docs.local/2026-01-05-x/.codex-home-test/auth.json"))).toBe(true);
    expect(existsSync(join(repo, "docs.local/2026-01-06-y/.env.local"))).toBe(true);
  });
});

describe("lifecycle plan", () => {
  const tree = {
    "2026-05-03-a.md": "a",
    "research/2026-05-20-b/notes.md": "bb",
    "2026-06-01-current.md": "c",
    "2026-02-10-old/plan.md": "old",
    "2026-03/2026-03-01-rolled.md": "rolled",
    "undated.md": "u",
  };

  test("finished months roll up into YYYY-MM/; the current month stays flat", () => {
    const p = plan(fixture(tree));
    expect(p.moves).toEqual([
      { from: "docs.local/2026-02-10-old", to: "docs.local/2026-02/2026-02-10-old" },
      { from: "docs.local/2026-05-03-a.md", to: "docs.local/2026-05/2026-05-03-a.md" },
      { from: "docs.local/research/2026-05-20-b", to: "docs.local/research/2026-05/2026-05-20-b" },
    ]);
  });

  test("months older than --keep-months go to the Drive upload plan, per folder", () => {
    const p = plan(fixture(tree));
    expect(p.upload.map((u) => [u.dir, u.month])).toEqual([
      ["docs.local/2026-02", "2026-02"],
      ["docs.local/2026-03", "2026-03"],
    ]);
    expect(p.upload[0].driveTarget).toMatch(/^Brain Drive\/06_ARCHIVE\/docs-local\/.+\/2026-02$/);
    expect(uploadPaths(p)).toEqual(["docs.local/2026-02-10-old/plan.md", "docs.local/2026-03/2026-03-01-rolled.md"]);
    expect(p.totals.undated).toBe(1);
  });

  test("dry-run is the default and changes nothing on disk", () => {
    const repo = fixture(tree);
    const before = listFiles(repo);
    const result = rollup(repo);
    expect(result.status).toBe(0);
    expect(listFiles(repo)).toEqual(before);
  });

  test("--apply moves into month folders, writes the plan, and deletes nothing", () => {
    const repo = fixture(tree);
    const count = listFiles(join(repo, "docs.local")).length;
    const result = rollup(repo, "--apply");
    expect(result.status).toBe(0);
    expect(existsSync(join(repo, "docs.local/2026-05/2026-05-03-a.md"))).toBe(true);
    expect(existsSync(join(repo, "docs.local/2026-06-01-current.md"))).toBe(true);
    const planDir = join(repo, "docs.local/_drive-filing");
    expect(readdirSync(planDir)).toEqual([`rollup-plan-${NOW}.json`]);
    expect(listFiles(join(repo, "docs.local")).length).toBe(count + 1);
  });

  test("a move never overwrites an existing target", () => {
    const repo = fixture({ "2026-05-03-a.md": "new", "2026-05/2026-05-03-a.md": "existing" });
    const p = plan(repo);
    expect(p.moves).toEqual([]);
    expect(p.conflicts).toEqual([{ from: "docs.local/2026-05-03-a.md", to: "docs.local/2026-05/2026-05-03-a.md" }]);
  });
});

describe("CLI contract", () => {
  test("prints one summary line last, with file count and size", () => {
    const result = rollup(fixture({ "2026-05-03-a.md": "abc", "undated.md": "de" }));
    expect(result.status).toBe(0);
    const last = result.lines.at(-1);
    expect(last).toMatch(/^drive-filing rollup: mode=dry-run /);
    expect(last).toContain("files=2 bytes=5");
  });

  test("a repo with no docs.local reports zeros", () => {
    const repo = mkdtempSync(join(tmpdir(), "drive-filing-rollup-"));
    roots.push(repo);
    const result = rollup(repo);
    expect(result.status).toBe(0);
    expect(result.lines.at(-1)).toContain("files=0 bytes=0");
  });

  test("--keep-months is required", () => {
    const result = spawnSync(process.execPath, [ROLLUP, "--repo", tmpdir()], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--keep-months");
  });
});
