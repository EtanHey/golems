import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
