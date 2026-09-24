import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

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
    // Round 2: z is clean but shares January with x and y, so the whole
    // January group is held (no moves, no upload unit).
    expect(uploads).toEqual([]);
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-01"]);
    expect(p.held[0].members).toContain("docs.local/2026-01-07-z");

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
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-01"]);
    expect(p.held[0].members).toEqual(["docs.local/2026-01-05-x"]);
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

// Round 2 (r6 B1/B2, r4 F1/F2, spec-owner ruling): one structural rule. A
// (folder, month) group holding ANY credential is held whole: nothing in it
// moves, no upload unit is emitted for it, and it is reported once.
describe("credential exclusion, round 2", () => {
  const credentialFree = (p) => {
    const uploads = uploadPaths(p);
    const moved = p.moves.map((m) => m.from);
    return { uploads, moved };
  };

  test.each([
    "2026-02-21-credentials.txt",
    "2026-02-21-auth.json",
    "2026-02-21-deploy.env",
    "2026-02-21-api.pem",
    "2026-02-21-signing.key",
    "2026-02-21-my_token.txt",
  ])("F1: every name rule matches a date-prefixed name: %s", (name) => {
    const p = plan(fixture({ [name]: "secret", "2026-02-22-plain.md": "plain" }));
    const { uploads, moved } = credentialFree(p);
    expect(p.skipped.map((s) => s.path)).toContain(`docs.local/${name}`);
    expect(uploads).toEqual([]);
    expect(moved).toEqual([]);
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-02"]);
  });

  test.each(["2026-02-21-x/.envrc", "2026-02-21-x/.env-production", "2026-02-21-x/.env_backup"])(
    "the env rule covers every .env* name: %s",
    (path) => {
      const p = plan(fixture({ [path]: "API_KEY=x", "2026-02-21-x/notes.md": "notes" }));
      expect(p.skipped.map((s) => s.path)).toContain(`docs.local/${path}`);
      expect(uploadPaths(p)).toEqual([]);
      expect(p.moves).toEqual([]);
      expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-02"]);
    },
  );

  test("B1: Claude OAuth file, a hyphenless codexhome, a .claude dir and a browser profile are credentials", () => {
    const repo = fixture({
      "2026-01-05-probe/.claude/.credentials.json": "{}",
      "2026-01-06-codex/lastprobe1/codexhome/config.toml": "x",
      "2026-01-06-codex/lastprobe1/codexhome/sessions/rollout.jsonl": "x",
      "2026-01-07-browser/Profile 1/Login Data": "x",
      "2026-01-07-browser/Local State": "x",
      "2026-01-08-helium/.helium-profile/Local State": "x",
      "2026-01-08-helium/.helium-profile/Default/Cookies": "x",
      "2026-01-08-helium/.helium-profile/Default/Web Data": "x",
    });
    const p = plan(repo);
    expect(uploadPaths(p)).toEqual([]);
    expect(p.moves).toEqual([]);
    const skipped = p.skipped.map((s) => s.path);
    for (const path of [
      "docs.local/2026-01-05-probe/.claude",
      "docs.local/2026-01-06-codex/lastprobe1/codexhome",
      "docs.local/2026-01-07-browser",
      "docs.local/2026-01-08-helium/.helium-profile",
    ]) {
      expect(skipped).toContain(path);
    }
  });

  test("B2: a month folder holding a credential takes no sibling moves and is no upload unit", () => {
    const repo = fixture({
      "2026-01/.ENV.prod": "API_KEY=x",
      "2026-01/2026-01-02-notes.md": "notes",
      "2026-01-15-plain.md": "plain",
      "2026-01-20-clean.md": "clean",
    });
    const p = plan(repo);
    expect(p.moves).toEqual([]);
    expect(p.upload).toEqual([]);
    expect(p.held).toEqual([
      {
        path: "docs.local/2026-01",
        reason: "contains credentials",
        members: ["docs.local/2026-01", "docs.local/2026-01-15-plain.md", "docs.local/2026-01-20-clean.md"],
        credentials: ["docs.local/2026-01/.ENV.prod"],
      },
    ]);
    const text = rollup(repo);
    expect(text.lines).toContain("held: contains credentials docs.local/2026-01");
    expect(text.lines).toContain("  credential: docs.local/2026-01/.ENV.prod");
  });

  test("F2: a held dated item holds its whole month; a clean sibling does not move", () => {
    const repo = fixture({
      "2026-01-05-x/.env.local": "API_KEY=x",
      "2026-01-15-plain.md": "plain",
      "2026-03-01-other.md": "other",
    });
    const p = plan(repo);
    expect(p.moves).toEqual([{ from: "docs.local/2026-03-01-other.md", to: "docs.local/2026-03/2026-03-01-other.md" }]);
    expect(p.upload.map((u) => u.dir)).toEqual(["docs.local/2026-03"]);
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-01"]);
  });

  test("--apply on a held month moves nothing into it", () => {
    const repo = fixture({ "2026-01/.ENV.prod": "x", "2026-01-15-plain.md": "plain" });
    rollup(repo, "--apply");
    expect(existsSync(join(repo, "docs.local/2026-01-15-plain.md"))).toBe(true);
    expect(existsSync(join(repo, "docs.local/2026-01/2026-01-15-plain.md"))).toBe(false);
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

// Rollup v2 (GO-4 PR-8; spec owner skillcreatorLead, cleanliness-standard.md).
describe("rollup v2: N-C1 env-named config is a credential too", () => {
  test.each(["2026-02-21-x/prod-env.json", "2026-02-21-x/app-env.yml", "2026-02-21-x/staging_env", "2026-02-21-x/env.json"])(
    "%s is held",
    (path) => {
      const p = plan(fixture({ [path]: "API_KEY=x", "2026-02-21-x/notes.md": "notes" }));
      expect(p.skipped.map((s) => s.path)).toContain(`docs.local/${path}`);
      expect(uploadPaths(p)).toEqual([]);
      expect(p.moves).toEqual([]);
      expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-02"]);
    },
  );

  test("the /\\.env/i rule still holds every .env* name alongside it", async () => {
    const { isCredentialFile } = await import("./rollup.mjs");
    for (const name of [".env", ".envrc", ".env-production", ".env_backup", "prod.env"]) {
      expect(isCredentialFile(name)).toBe(true);
    }
    for (const name of ["environment-notes.md", "envelope.md", "seven.md"]) {
      expect(isCredentialFile(name)).toBe(false);
    }
  });
});

describe("rollup v2: token allow-list (spec owner: keep /token/i, release proven-safe names only)", () => {
  test("a tokenizer note no longer freezes its month", () => {
    const p = plan(fixture({ "2026-02-02-tokenizer-remap.md": "notes", "2026-02-10-other.md": "other" }));
    expect(p.skipped).toEqual([]);
    expect(p.held).toEqual([]);
    expect(p.moves.map((m) => m.from)).toEqual(["docs.local/2026-02-02-tokenizer-remap.md", "docs.local/2026-02-10-other.md"]);
    expect(uploadPaths(p)).toContain("docs.local/2026-02-02-tokenizer-remap.md");
  });

  test.each(["2026-02-21-x/github_token", "2026-02-21-x/api-token.json", "2026-02-21-x/deploy-token.txt", "2026-02-21-x/github_token_tokenizer.txt"])(
    "%s is still held",
    (path) => {
      const p = plan(fixture({ [path]: "ghp_secret", "2026-02-21-x/notes.md": "notes" }));
      expect(p.skipped.map((s) => s.path)).toContain(`docs.local/${path}`);
      expect(uploadPaths(p)).toEqual([]);
      expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-02"]);
    },
  );

  test("design tokens and a loose Trust Tokens file are released; another credential rule still wins", async () => {
    const { isCredentialFile } = await import("./rollup.mjs");
    for (const name of ["design-tokens.json", "design_token.css", "DesignTokens.ts", "Trust Tokens", "tokenization.md"]) {
      expect(isCredentialFile(name)).toBe(false);
    }
    for (const name of ["tokenizer.pem", "design-tokens.env", "design-tokens-api-token.json"]) {
      expect(isCredentialFile(name)).toBe(true);
    }
  });

  test("a Trust Tokens db inside a browser profile stays held with the profile", () => {
    const p = plan(fixture({
      "2026-02-21-browser/Default/Trust Tokens": "x",
      "2026-02-21-browser/Default/Cookies": "x",
      "2026-02-21-browser/notes.md": "notes",
    }));
    expect(p.skipped.map((s) => s.path)).toContain("docs.local/2026-02-21-browser/Default");
    expect(uploadPaths(p)).toEqual([]);
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-02"]);
  });
});

describe("rollup v2: a date anywhere in the item's name dates it", () => {
  test("stalker-golem/theo-2026-03-19-015034/ is a March item: moved and, once old, uploaded", () => {
    const p = plan(fixture({ "stalker-golem/theo-2026-03-19-015034/run.json": "{}" }));
    expect(p.moves).toEqual([
      { from: "docs.local/stalker-golem/theo-2026-03-19-015034", to: "docs.local/stalker-golem/2026-03/theo-2026-03-19-015034" },
    ]);
    expect(p.upload.map((u) => [u.dir, u.month])).toEqual([["docs.local/stalker-golem/2026-03", "2026-03"]]);
    expect(p.totals.undated).toBe(0);
  });

  test("probe-2026-03/ is dated by its YYYY-MM and is not a month folder", () => {
    const p = plan(fixture({ "probe-2026-03/out.txt": "x" }));
    expect(p.moves).toEqual([{ from: "docs.local/probe-2026-03", to: "docs.local/2026-03/probe-2026-03" }]);
    expect(p.upload.map((u) => u.month)).toEqual(["2026-03"]);
  });

  test("the first full date wins over a later one, and a YYYY-MM-DD beats an earlier-looking YYYY-MM", () => {
    const p = plan(fixture({
      "run-2026-03-05-vs-2026-01-01.md": "x",
      "report-2026-01-final-2026-04-05.md": "x",
      "eval-gates-2026-02-12/r.json": "x",
    }));
    expect(p.moves.map((m) => m.to).sort()).toEqual([
      "docs.local/2026-02/eval-gates-2026-02-12",
      "docs.local/2026-03/run-2026-03-05-vs-2026-01-01.md",
      "docs.local/2026-04/report-2026-01-final-2026-04-05.md",
    ]);
  });

  test("digit runs and impossible dates are not dates", () => {
    const p = plan(fixture({ "build-12026-03-05.md": "x", "pr-2026-13-01.md": "x", "sha-20260305.md": "x" }));
    expect(p.moves).toEqual([]);
    expect(p.totals.undated).toBe(3);
  });

  test("credential holds still apply before dating", () => {
    const p = plan(fixture({ "probe-2026-03/.codex-home/auth.json": "{}", "probe-2026-03/out.txt": "x" }));
    expect(p.moves).toEqual([]);
    expect(uploadPaths(p)).toEqual([]);
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-03"]);
  });
});

// Spec-owner ruling on (a), 2026-09-25: w5's (1)-(4) plus R-a/R-b/R-c.
describe("rollup v2: newest-mtime units (R-a maximal, R-b holds first, R-c visible)", () => {
  // Set every listed file's mtime (docs.local-relative) to an ISO date.
  const touch = (repo, when, ...rels) => {
    const t = new Date(when);
    for (const rel of rels) utimesSync(join(repo, "docs.local", rel), t, t);
  };
  const mtimeUploads = (p) => p.upload.filter((u) => u.dating === "mtime");

  test("an area keeps rolling its dated child; its undated sibling dir is one mtime unit, never moved", () => {
    const repo = fixture({
      "research/2026-02-10-x/a.md": "aa",
      "research/tool-cache/one.bin": "111",
      "research/tool-cache/sub/two.bin": "2222",
    });
    touch(repo, "2026-01-15T12:00:00Z", "research/tool-cache/one.bin", "research/tool-cache/sub/two.bin");
    const p = plan(repo);
    expect(p.moves).toEqual([{ from: "docs.local/research/2026-02-10-x", to: "docs.local/research/2026-02/2026-02-10-x" }]);
    expect(mtimeUploads(p).map((u) => [u.dir, u.month, u.files.length, u.bytes])).toEqual([
      ["docs.local/research/tool-cache", "2026-01", 2, 7],
    ]);
  });

  test("a nested undated tree with no dated descendant is exactly one unit: the highest dir", () => {
    const repo = fixture({ "tasks/gems-adoption/deep/x/y.txt": "y", "tasks/gems-adoption/z.txt": "z", "tasks/top.md": "t" });
    touch(repo, "2026-02-01T00:00:00Z", "tasks/gems-adoption/deep/x/y.txt", "tasks/gems-adoption/z.txt", "tasks/top.md");
    const p = plan(repo);
    expect(p.mtimeUnits.map((u) => u.path)).toEqual(["docs.local/tasks"]);
    expect(mtimeUploads(p).map((u) => u.dir)).toEqual(["docs.local/tasks"]);
    expect(p.moves).toEqual([]);
  });

  test("root README.md and STATUS.md stay undated and unplanned, however old", () => {
    const repo = fixture({ "README.md": "r", "STATUS.md": "s" });
    touch(repo, "2025-01-01T00:00:00Z", "README.md", "STATUS.md");
    const p = plan(repo);
    expect(p.totals.undated).toBe(2);
    expect(p.upload).toEqual([]);
    expect(p.moves).toEqual([]);
    expect(p.mtimeUnits).toEqual([]);
  });

  test("R-b: an undated dir holding a credential is held whole and never dated", () => {
    const repo = fixture({ "boxes/tool/.env": "API_KEY=x", "boxes/tool/notes.md": "n" });
    touch(repo, "2026-01-01T00:00:00Z", "boxes/tool/notes.md");
    const p = plan(repo);
    expect(uploadPaths(p)).toEqual([]);
    expect(p.mtimeUnits).toEqual([]);
    expect(p.held).toEqual([
      { path: "docs.local/boxes", reason: "contains credentials", members: ["docs.local/boxes"], credentials: ["docs.local/boxes/tool/.env"] },
    ]);
  });

  test("the newest file decides: one recent file keeps an old dir local", () => {
    const repo = fixture({ "cache/old.bin": "o", "cache/new.bin": "n" });
    touch(repo, "2026-01-01T00:00:00Z", "cache/old.bin");
    touch(repo, "2026-06-01T00:00:00Z", "cache/new.bin");
    const p = plan(repo);
    expect(p.upload).toEqual([]);
    expect(p.mtimeUnits).toEqual([{ path: "docs.local/cache", month: "2026-06", files: 2, bytes: 2, upload: false }]);
  });

  test("R-c: the summary counts mtime units apart and --json lists the top 5 by size", () => {
    const files = {};
    for (let i = 1; i <= 6; i += 1) files[`area${i}/blob.bin`] = "x".repeat(i);
    const repo = fixture(files);
    touch(repo, "2026-01-01T00:00:00Z", ...Object.keys(files));
    const p = plan(repo);
    expect(p.mtimeUnits.map((u) => u.path)).toEqual(["area6", "area5", "area4", "area3", "area2"].map((a) => `docs.local/${a}`));
    expect(p.totals.mtimeUnits).toBe(6);
    expect(p.totals.mtimeBytes).toBe(21);
    const last = rollup(repo).lines.at(-1);
    expect(last).toContain("mtime-units=6 bytes=21");
  });

  test("--apply never moves an mtime unit", () => {
    const repo = fixture({ "cache/old.bin": "o" });
    touch(repo, "2026-01-01T00:00:00Z", "cache/old.bin");
    rollup(repo, "--apply");
    expect(existsSync(join(repo, "docs.local/cache/old.bin"))).toBe(true);
    expect(existsSync(join(repo, "docs.local/2026-01"))).toBe(false);
  });
});

// Found on the live golems dry-run: v2 made collab/ one mtime unit, and a file
// under a dir named *token* reached the upload plan. Name rules hold dirs too.
describe("rollup v2: credential name rules hold directories as well", () => {
  test.each(["collab/whoop-token-rotation/collab.md", "notes/prod-env/readme.md", "notes/old-credentials/list.md"])(
    "%s is held with its directory",
    (path) => {
      const repo = fixture({ [path]: "prose" });
      const p = plan(repo);
      expect(uploadPaths(p)).toEqual([]);
      expect(p.skipped.map((s) => s.path)).toContain(`docs.local/${path.split("/").slice(0, 2).join("/")}`);
    },
  );

  test("an allow-listed dir name is not held", () => {
    const p = plan(fixture({ "design-tokens/colors.json": "{}" }));
    expect(p.skipped).toEqual([]);
  });
});

// Spec addition (skillcreatorLead, 2026-09-25 15:00): /secret/i, unanchored.
describe("rollup v2: secret-named files and dirs are credentials", () => {
  test.each(["2026-02-21-x/client_secret.json", "2026-02-21-x/app-secrets.yml", "2026-02-21-x/SECRETS/a.md"])("%s is held", (path) => {
    const p = plan(fixture({ [path]: "s", "2026-02-21-x/notes.md": "notes" }));
    expect(uploadPaths(p)).toEqual([]);
    expect(p.moves).toEqual([]);
    expect(p.held.map((h) => h.path)).toEqual(["docs.local/2026-02"]);
  });
});
