import { afterEach, describe, expect, test, setDefaultTimeout, spawnSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, tmpdir, basename, dirname, join, ROLLUP, NOW, roots, fixture, rollup, plan, uploadPaths, listFiles } from "./common.mjs";


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
      const { isRegenerableDir } = await import("../rollup.mjs");
      expect(isRegenerableDir(name)).toBe(true);
    },
  );

  test("near-miss names are not regenerable", async () => {
    const { isRegenerableDir } = await import("../rollup.mjs");
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
