import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

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
  test("stalker-golem/examplechannel-2026-03-19-015034/ is a March item: moved and, once old, uploaded", () => {
    const p = plan(fixture({ "stalker-golem/examplechannel-2026-03-19-015034/run.json": "{}" }));
    expect(p.moves).toEqual([
      { from: "docs.local/stalker-golem/examplechannel-2026-03-19-015034", to: "docs.local/stalker-golem/2026-03/examplechannel-2026-03-19-015034" },
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

// r5 round-1 F1/F2 on #201: every unit lands at its own Drive path, and an
// empty unit is never planned.
describe("rollup v2: Drive targets never collide (F1) and empty units are not planned (F2)", () => {
  const touch = (repo, when, ...rels) => {
    const t = new Date(when);
    for (const rel of rels) utimesSync(join(repo, "docs.local", rel), t, t);
  };

  // Invariant: targets are unique, no target is a path-prefix of another,
  // and no two uploaded files map to the same Drive path (after the moves).
  function driveInvariant(p) {
    const moved = new Map(p.moves.map((m) => [m.from, m.to]));
    const afterMoves = (path) => {
      for (const [from, to] of moved) if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length);
      return path;
    };
    const targets = p.upload.map((u) => u.driveTarget);
    const shared = targets.filter((t, i) => targets.indexOf(t) !== i);
    const nested = targets.filter((t) => targets.some((o) => o !== t && o.startsWith(`${t}/`)));
    const drivePaths = p.upload.flatMap((u) =>
      u.files.map((f) => `${u.driveTarget}/${afterMoves(f.path).slice(u.dir.length + 1)}`),
    );
    const collisions = drivePaths.filter((d, i) => drivePaths.indexOf(d) !== i);
    const outside = p.upload.flatMap((u) => u.files.map((f) => afterMoves(f.path)).filter((f) => !f.startsWith(`${u.dir}/`)));
    return { shared, nested, collisions, outside };
  }
  const clean = { shared: [], nested: [], collisions: [], outside: [] };

  test("r5's fixture: an mtime unit and a month unit in one area no longer share a target", () => {
    const repo = fixture({ "qa/2026-01-05-run/README.md": "run", "qa/notes/README.md": "notes" });
    touch(repo, "2026-01-20T00:00:00Z", "qa/notes/README.md");
    const p = plan(repo);
    expect(p.upload.map((u) => u.driveTarget).map((t) => t.split("/").slice(-3).join("/"))).toEqual([
      "docs-local/qa/2026-01".replace("docs-local", basename(repo)),
      "<repo>/qa/notes".replace("<repo>", basename(repo)),
    ]);
    expect(driveInvariant(p)).toEqual(clean);
  });

  test("an mtime unit's Drive target mirrors its unmoved local path, with no month segment", () => {
    const repo = fixture({ "research/2026-02-01-x.md": "x", "research/deep/cache/README.md": "r" });
    touch(repo, "2026-01-15T00:00:00Z", "research/deep/cache/README.md");
    const unit = plan(repo).upload.find((u) => u.dating === "mtime");
    expect(unit.dir).toBe("docs.local/research/deep");
    expect(unit.driveTarget).toBe(`Brain Drive/06_ARCHIVE/docs-local/${basename(repo)}/research/deep`);
    expect(unit.month).toBe("2026-01");
  });

  test("many root-level mtime units of one month each get their own target", () => {
    const files = {};
    for (let i = 1; i <= 17; i += 1) files[`tree${i}/README.md`] = `r${i}`;
    const repo = fixture(files);
    touch(repo, "2026-03-01T00:00:00Z", ...Object.keys(files));
    const p = plan(repo);
    expect(p.upload).toHaveLength(17);
    expect(driveInvariant(p)).toEqual(clean);
  });

  test("the invariant holds on a mixed tree: month units, nested areas, mtime units", () => {
    const repo = fixture({
      "2026-01-05-a.md": "a",
      "2026-01/2026-01-02-b.md": "b",
      "research/2026-02-01-c/README.md": "c",
      "research/cache/README.md": "d",
      "research/deep/2026-01-09-e.md": "e",
      "research/deep/tool/README.md": "f",
      "notes/README.md": "g",
    });
    touch(repo, "2026-01-15T00:00:00Z", "research/cache/README.md", "research/deep/tool/README.md", "notes/README.md");
    const p = plan(repo);
    expect(p.upload.length).toBeGreaterThanOrEqual(6);
    expect(driveInvariant(p)).toEqual(clean);
  });

  test("F2: an empty dir and a dir of empty files are never planned, only counted", () => {
    const repo = fixture({ "qa/2026-01-05-run/README.md": "run", "qa/blank/zero.txt": "" });
    mkdirSync(join(repo, "docs.local/qa/empty-dir"));
    touch(repo, "2026-01-20T00:00:00Z", "qa/blank/zero.txt", "qa/empty-dir");
    const p = plan(repo);
    expect(p.upload.map((u) => u.dir)).toEqual(["docs.local/qa/2026-01"]);
    expect(p.upload.every((u) => u.files.length > 0 && u.bytes > 0)).toBe(true);
    expect(p.mtimeUnits).toEqual([]);
    expect(p.totals.emptyUnits).toBe(2);
  });

  test("F2: a month unit left with no files is not planned either", () => {
    const repo = fixture({ "2026-01-05-empty.md": "" });
    const p = plan(repo);
    expect(p.upload).toEqual([]);
    expect(p.totals.emptyUnits).toBe(1);
  });
});

// PR-8c B1 (skillcreatorLead SECURITY, 2026-09-25): a planned file whose
// CONTENT carries a high-confidence secret shape holds its whole unit.
// Fake tokens are assembled at runtime from fragments: no literal token shape
// is committed (public repo, push protection + secret scanning). Assertions
// check paths and shape names only; a value never appears in the plan.
describe("B1: content-scan hold", () => {
  const rep = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const FAKE = {
    supabase: ["sb", "p_", rep("0123456789abcdef", 40)].join(""),
    google: ["AI", "za", rep("Xy9_-", 35)].join(""),
    github: ["gh", "p_", rep("aB3", 36)].join(""),
    "github-pat": ["github", "_pat_", rep("Q1w_", 40)].join(""),
    openai: ["s", "k-", "pro", "j-", rep("Zx8", 32)].join(""),
    aws: ["AK", "IA", rep("QWE7", 16)].join(""),
    slack: ["xo", "xb-", rep("12345-", 24)].join(""),
    "private-key": ["-----BEG", "IN RSA PRIV", "ATE KEY-----"].join(""),
  };

  test.each(Object.entries(FAKE))("a %s token in a planned file holds its month unit", (shape, token) => {
    const repo = fixture({
      "2026-01-05-transcript.jsonl": `{"text":"env dump ${token} end"}\n`,
      "2026-01-06-clean.md": "clean",
      "2026-03-01-other.md": "other",
    });
    const p = plan(repo);
    expect(p.held).toEqual([
      {
        path: "docs.local/2026-01",
        reason: "credential-content",
        members: ["docs.local/2026-01-05-transcript.jsonl", "docs.local/2026-01-06-clean.md"],
        credentials: [],
        content: [{ path: "docs.local/2026-01-05-transcript.jsonl", shape }],
      },
    ]);
    expect(uploadPaths(p)).toEqual(["docs.local/2026-03-01-other.md"]);
    expect(p.moves.map((m) => m.from)).toEqual(["docs.local/2026-03-01-other.md"]);
    expect(p.totals.contentHeld).toBe(1);
    const text = rollup(repo);
    expect(text.stdout).not.toContain(token);
    expect(JSON.stringify(p)).not.toContain(token);
    expect(text.lines).toContain("held: credential-content docs.local/2026-01");
    expect(text.lines).toContain(`  content: docs.local/2026-01-05-transcript.jsonl (${shape})`);
    expect(text.lines.at(-1)).toContain("content-held=1");
  });

  test("a token deep inside a dated folder, past the first chunk, still holds it", () => {
    const pad = "x".repeat(3 * 1024 * 1024);
    const repo = fixture({ "2026-01-05-run/logs/big.log": `${pad}\n${FAKE.supabase}\n` });
    const p = plan(repo);
    expect(p.held.map((h) => [h.path, h.reason])).toEqual([["docs.local/2026-01", "credential-content"]]);
    expect(p.upload).toEqual([]);
  });

  test("a token straddling the 1 MiB chunk boundary is still found", () => {
    // SCAN_CHUNK is 1 MiB: the token starts 10 bytes before the boundary.
    const filler = "x".repeat(1024 * 1024 - 10);
    const repo = fixture({ "2026-01-05-run.log": `${filler} ${FAKE.supabase}\n` });
    const p = plan(repo);
    expect(p.held.map((h) => [h.path, h.reason])).toEqual([["docs.local/2026-01", "credential-content"]]);
    expect(p.upload).toEqual([]);
  });

  test("near-miss shapes do not hold", () => {
    const repo = fixture({
      "2026-01-05-notes.md": [
        ["ta", "sk-", "abcdefghijklmnopqrstuvwxyz"].join(""), // sk- inside a word
        ["sb", "p_", "0123"].join(""), // too short
        ["AK", "IA", "short"].join(""),
        "-----BEGIN PUBLIC KEY-----",
      ].join("\n"),
    });
    const p = plan(repo);
    expect(p.held).toEqual([]);
    expect(uploadPaths(p)).toEqual(["docs.local/2026-01-05-notes.md"]);
  });

  test("binary files are not scanned", () => {
    const repo = fixture({ "2026-01-05-blob.bin": `\u0000\u0001${FAKE.aws}` });
    const p = plan(repo);
    expect(p.held).toEqual([]);
  });

  test("the current month (nothing planned) is not scanned or held", () => {
    const repo = fixture({ "2026-06-02-live.md": FAKE.github });
    const p = plan(repo);
    expect(p.held).toEqual([]);
    expect(p.totals.contentHeld).toBe(0);
  });

  test("a credential-named hold still wins and is reported as before", () => {
    const repo = fixture({ "2026-01-05-x/.env.local": FAKE.openai, "2026-01-06-y.md": FAKE.aws });
    const p = plan(repo);
    expect(p.held.map((h) => h.reason)).toEqual(["contains credentials"]);
  });
});

describe("B1 x v2: the content scan covers mtime units", () => {
  const touch = (repo, when, ...rels) => {
    const t = new Date(when);
    for (const rel of rels) utimesSync(join(repo, "docs.local", rel), t, t);
  };
  const fakeSupabase = () => ["sb", "p_", "0123456789abcdef".repeat(3).slice(0, 40)].join("");

  test("an old mtime unit with a secret-shaped file is held whole, value never printed", () => {
    const token = fakeSupabase();
    const repo = fixture({ "weave/mine-context/orc.md": `pat ${token}`, "weave/notes.md": "n", "clean/readme.md": "r" });
    touch(repo, "2026-01-10T00:00:00Z", "weave/mine-context/orc.md", "weave/notes.md", "clean/readme.md");
    const p = plan(repo);
    expect(p.held).toEqual([
      {
        path: "docs.local/weave",
        reason: "credential-content",
        members: ["docs.local/weave"],
        credentials: [],
        content: [{ path: "docs.local/weave/mine-context/orc.md", shape: "supabase" }],
      },
    ]);
    expect(p.upload.map((u) => u.dir)).toEqual(["docs.local/clean"]);
    expect(p.totals.contentHeld).toBe(1);
    expect(JSON.stringify(p)).not.toContain(token);
    expect(rollup(repo).stdout).not.toContain(token);
  });

  test("a recent mtime unit (not planned) is not read", () => {
    const repo = fixture({ "weave/orc.md": `pat ${fakeSupabase()}` });
    const p = plan(repo);
    expect(p.held).toEqual([]);
    expect(p.totals.contentHeld).toBe(0);
  });
});

// PR-8b (spec owner, 2026-09-25 15:00): regenerable dirs are never planned,
// never mtime units, never deleted; reported once with bytes. Holds win.
describe("rollup: regenerable dirs are skipped, not archived", () => {
  const touch = (repo, when, ...rels) => {
    const t = new Date(when);
    for (const rel of rels) utimesSync(join(repo, "docs.local", rel), t, t);
  };

  test.each(["__pycache__", "node_modules", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".build", ".next", ".turbo", ".probe"])(
    "%s is regenerable",
    async (name) => {
      const { isRegenerableDir } = await import("./rollup.mjs");
      expect(isRegenerableDir(name)).toBe(true);
    },
  );

  test("near-miss names are not regenerable", async () => {
    const { isRegenerableDir } = await import("./rollup.mjs");
    for (const name of ["build", "next-steps", "venv-notes", "my_node_modules_audit", "probe"]) {
      expect(isRegenerableDir(name)).toBe(false);
    }
  });

  test("__pycache__ under an old undated dir is not in the plan, and is reported once with bytes", () => {
    const repo = fixture({ "tool/a.py": "print(1)", "tool/__pycache__/a.cpython-313.pyc": "0123456789" });
    touch(repo, "2026-01-10T00:00:00Z", "tool/a.py", "tool/__pycache__/a.cpython-313.pyc");
    const p = plan(repo);
    expect(uploadPaths(p)).toEqual(["docs.local/tool/a.py"]);
    expect(p.regenerable).toEqual([{ path: "docs.local/tool/__pycache__", files: 1, bytes: 10 }]);
    const lines = rollup(repo).lines;
    expect(lines).toContain("skipped: regenerable docs.local/tool/__pycache__/ (1 files, 10 bytes)");
    expect(lines.at(-1)).toContain("regenerable-skipped=1 bytes=10");
  });

  test("dashboards/.probe/.helium-profile stays held: holds win over the skip list", () => {
    const repo = fixture({
      "dashboards/2026-01-05-board.html": "b",
      "dashboards/.probe/.helium-profile/Local State": "x",
      "dashboards/.probe/.helium-profile/Default/Cookies": "x",
    });
    const p = plan(repo);
    expect(p.held.map((h) => h.path)).toContain("docs.local/dashboards/.probe");
    expect(p.regenerable).toEqual([]);
    expect(uploadPaths(p).some((f) => f.includes(".probe"))).toBe(false);
  });

  test("node_modules inside a dated item: the item still moves, node_modules is never uploaded and is reported once", () => {
    const repo = fixture({
      "2026-01-05-app/src.ts": "code",
      "2026-01-05-app/node_modules/x/index.js": "js",
      "2026-01-05-app/node_modules/x/node_modules/y/index.js": "js",
    });
    const p = plan(repo);
    expect(p.moves).toEqual([{ from: "docs.local/2026-01-05-app", to: "docs.local/2026-01/2026-01-05-app" }]);
    expect(uploadPaths(p)).toEqual(["docs.local/2026-01-05-app/src.ts"]);
    expect(p.regenerable.map((r) => r.path)).toEqual(["docs.local/2026-01-05-app/node_modules"]);
  });

  test("a regenerable dir directly in an area is not an mtime unit", () => {
    const repo = fixture({ "research/2026-02-01-x.md": "x", "research/.venv/lib/site.py": "s" });
    touch(repo, "2026-01-01T00:00:00Z", "research/.venv/lib/site.py");
    const p = plan(repo);
    expect(p.mtimeUnits).toEqual([]);
    expect(p.totals.emptyUnits).toBe(0);
    expect(p.regenerable.map((r) => r.path)).toEqual(["docs.local/research/.venv"]);
    expect(uploadPaths(p).some((f) => f.includes(".venv"))).toBe(false);
  });

  test("a dated name inside a regenerable dir does not make it an area", () => {
    const p = plan(fixture({ "research/2026-02-01-x.md": "x", "research/node_modules/pkg-2026-01-01/index.js": "js" }));
    expect(p.regenerable.map((r) => r.path)).toEqual(["docs.local/research/node_modules"]);
    expect(p.moves.map((m) => m.from)).toEqual(["docs.local/research/2026-02-01-x.md"]);
    expect(uploadPaths(p).some((f) => f.includes("node_modules"))).toBe(false);
  });

  test("a dated name only inside node_modules does not turn its parent into an area", () => {
    const repo = fixture({ "tool/a.py": "print(1)", "tool/node_modules/pkg-2026-01-01/x.js": "js" });
    touch(repo, "2026-01-10T00:00:00Z", "tool/a.py");
    const p = plan(repo);
    expect(p.upload.map((u) => [u.dir, u.dating])).toEqual([["docs.local/tool", "mtime"]]);
    expect(uploadPaths(p)).toEqual(["docs.local/tool/a.py"]);
    expect(p.totals.undated).toBe(0);
  });

  test("--apply deletes no regenerable file", () => {
    const repo = fixture({ "2026-01-05-app/src.ts": "code", "2026-01-05-app/node_modules/x/index.js": "js" });
    rollup(repo, "--apply");
    expect(existsSync(join(repo, "docs.local/2026-01/2026-01-05-app/node_modules/x/index.js"))).toBe(true);
  });
});
