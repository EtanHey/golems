// Deterministic spec for crash-resume-index (gen-18 Track 1 #3).
//
// Proves the FULL R-036 resume path: record (capture-on-boot) → save → load
// (round-trip across a SIMULATED REBOOT — a fresh loadIndex from the on-disk file
// returns the entry) → lookup → resumableFor returns the right session_id →
// pruneStale drops old entries → resumeCommand emits the exact repoGolem invocation.
// RED-ish negatives: unknown surface → null; a stale entry past maxAge is NOT
// offered as resumable. Runs under `bun test` and `node --test`.

import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  emptyIndex,
  record,
  touch,
  lookup,
  resumableFor,
  resumeCommand,
  launcherFor,
  recordToFile,
  pruneStale,
  loadIndex,
  saveIndex,
  DEFAULT_INDEX_PATH,
} from "../src/crash-resume-index.mjs";

// A real on-disk dir for persistence round-trips. NOTE: the durable PRODUCT path
// is ~/.golems — this test scratch dir is os.tmpdir() purely so the spec never
// writes the real home cache; it is NOT the module's default and is cleaned up.
const scratch = mkdtempSync(path.join(tmpdir(), "cri-test-"));
const indexPath = path.join(scratch, "crash-resume-index.json");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const T0 = 1_700_000_000_000; // fixed epoch-ms so timestamps are deterministic.

test("default index path is durable (~/.golems), never /tmp", () => {
  expect(DEFAULT_INDEX_PATH).toContain(".golems");
  expect(DEFAULT_INDEX_PATH.endsWith("crash-resume-index.json")).toBe(true);
  expect(DEFAULT_INDEX_PATH).not.toContain("/tmp/");
});

test("record captures surface→session and is a pure (non-mutating) op", () => {
  const idx0 = emptyIndex();
  const idx1 = record(
    idx0,
    {
      surfaceId: "pane-7",
      sessionId: "sess-abc123",
      repo: "golems",
      role: "lead",
    },
    T0,
  );
  // input not mutated
  expect(Object.keys(idx0.entries).length).toBe(0);
  const e = lookup(idx1, "pane-7");
  expect(e).not.toBeNull();
  expect(e.sessionId).toBe("sess-abc123");
  expect(e.repo).toBe("golems");
  expect(e.role).toBe("lead");
  expect(e.captured_at).toBe(T0);
  expect(e.last_active).toBe(T0);
});

test("re-record keeps captured_at but bumps last_active", () => {
  let idx = record(
    emptyIndex(),
    { surfaceId: "pane-7", sessionId: "sess-abc123", repo: "golems", role: "lead" },
    T0,
  );
  idx = record(
    idx,
    { surfaceId: "pane-7", sessionId: "sess-abc123", repo: "golems", role: "lead" },
    T0 + 5000,
  );
  const e = lookup(idx, "pane-7");
  expect(e.captured_at).toBe(T0); // unchanged
  expect(e.last_active).toBe(T0 + 5000); // bumped
});

test("record rejects empty surfaceId / sessionId / repo", () => {
  expect(() =>
    record(emptyIndex(), { surfaceId: "", sessionId: "s", repo: "r" }),
  ).toThrow(/surfaceId/);
  expect(() =>
    record(emptyIndex(), { surfaceId: "p", sessionId: "", repo: "r" }),
  ).toThrow(/sessionId/);
  expect(() =>
    record(emptyIndex(), { surfaceId: "p", sessionId: "s", repo: "" }),
  ).toThrow(/repo/);
});

test("FULL ROUND-TRIP: record → save → load across a simulated reboot → resume", () => {
  // Boot capture on the original (pre-crash) process.
  let idx = record(
    emptyIndex(),
    {
      surfaceId: "cmux-pane-42",
      sessionId: "01J-orc-lead-xyz",
      repo: "orchestrator",
      role: "lead",
    },
    T0,
  );
  idx = record(
    idx,
    {
      surfaceId: "cmux-pane-43",
      sessionId: "01J-jobs-worker-abc",
      repo: "golems",
      role: "worker",
    },
    T0,
  );
  const written = saveIndex(indexPath, idx);
  expect(existsSync(written)).toBe(true);

  // —— SIMULATED REBOOT —— the in-memory index is gone; a fresh process loads
  // ONLY from the durable file. (We discard `idx` here on purpose.)
  const reloaded = loadIndex(indexPath);

  const lead = lookup(reloaded, "cmux-pane-42");
  expect(lead).not.toBeNull();
  expect(lead.sessionId).toBe("01J-orc-lead-xyz");
  expect(lead.repo).toBe("orchestrator");

  // resumableFor returns the RIGHT session_id for /orc to --resume.
  expect(resumableFor(reloaded, "cmux-pane-42")).toBe("01J-orc-lead-xyz");
  expect(resumableFor(reloaded, "cmux-pane-43")).toBe("01J-jobs-worker-abc");

  // resumeCommand emits the REGISTERED launcher invocation the gate's GREEN path
  // runs — the orchestrator repo's launcher is `orcClaude` (codex P1).
  expect(resumeCommand(reloaded, "cmux-pane-42")).toBe(
    "orcClaude --resume 01J-orc-lead-xyz",
  );
  expect(resumeCommand(reloaded, "cmux-pane-43")).toBe(
    "golemsClaude --resume 01J-jobs-worker-abc",
  );
});

test("launcherFor maps repos to their registered per-repo launchers (codex P1)", () => {
  expect(launcherFor("golems")).toBe("golemsClaude");
  expect(launcherFor("orchestrator")).toBe("orcClaude"); // explicit alias
  expect(launcherFor("brainlayer")).toBe("brainlayerClaude");
  expect(launcherFor("")).toBeNull();
  expect(launcherFor(undefined)).toBeNull();
});

test("resumeCommand falls back to repoGolem when the repo is unknown", () => {
  // An index whose entry somehow lacks a derivable launcher still yields a usable
  // (generic) resume command rather than null.
  const idx = {
    version: 1,
    entries: {
      bare: { surfaceId: "bare", sessionId: "s-bare", captured_at: T0, last_active: T0 },
    },
  };
  expect(resumeCommand(idx, "bare")).toBe("repoGolem --resume s-bare");
});

test("touch bumps last_active so a long-running session stays resumable (cursor HIGH)", () => {
  const MAX = 30 * 60 * 1000; // 30 min liveness window
  let idx = record(
    emptyIndex(),
    { surfaceId: "long", sessionId: "s-long", repo: "golems", role: "lead" },
    T0,
  );
  // 2h later, with NO touch, a maxAge-bounded check would deny resume…
  expect(resumableFor(idx, "long", { maxAgeMs: MAX, now: T0 + 4 * MAX })).toBeNull();
  // …but a liveness touch keeps the same session resumable.
  idx = touch(idx, "long", T0 + 4 * MAX - 1000);
  expect(resumableFor(idx, "long", { maxAgeMs: MAX, now: T0 + 4 * MAX })).toBe("s-long");
  // touch on an unknown surface is a no-op (no entry created).
  expect(lookup(touch(idx, "ghost", T0), "ghost")).toBeNull();
});

test("default resumableFor (no maxAgeMs) never denies a recorded session by age", () => {
  const idx = record(
    emptyIndex(),
    { surfaceId: "old", sessionId: "s-old", repo: "golems", role: "lead" },
    T0,
  );
  // A year later, with no maxAge, still resumable — staleness is opt-in.
  expect(resumableFor(idx, "old", { now: T0 + 365 * 24 * 3600 * 1000 })).toBe("s-old");
});

test("recordToFile is a LOCKED RMW: concurrent captures all survive (cursor MED / codex P2)", async () => {
  const p = path.join(scratch, "concurrent.json");
  // Fire many captures for DIFFERENT surfaces "at once". Without locking the
  // last writer would clobber the others; with the lock every entry persists.
  const N = 12;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      Promise.resolve().then(() =>
        recordToFile(p, {
          surfaceId: `pane-${i}`,
          sessionId: `sess-${i}`,
          repo: "golems",
          role: "worker",
        }),
      ),
    ),
  );
  const reloaded = loadIndex(p);
  expect(Object.keys(reloaded.entries).length).toBe(N);
  for (let i = 0; i < N; i++) {
    expect(lookup(reloaded, `pane-${i}`)?.sessionId).toBe(`sess-${i}`);
  }
  // The lock dir is cleaned up — no wedged mutex left behind.
  expect(existsSync(`${p}.lock`)).toBe(false);
});

test("NEGATIVE: lookup / resumableFor / resumeCommand of an unknown surface → null", () => {
  const idx = record(
    emptyIndex(),
    { surfaceId: "pane-1", sessionId: "s1", repo: "golems", role: "lead" },
    T0,
  );
  expect(lookup(idx, "pane-NOPE")).toBeNull();
  expect(resumableFor(idx, "pane-NOPE")).toBeNull();
  expect(resumeCommand(idx, "pane-NOPE")).toBeNull();
});

test("NEGATIVE: a stale entry past maxAge is NOT offered as resumable", () => {
  const idx = record(
    emptyIndex(),
    { surfaceId: "pane-old", sessionId: "s-old", repo: "golems", role: "lead" },
    T0,
  );
  const MAX = 60 * 60 * 1000; // 1h
  // Fresh: within window → resumable.
  expect(resumableFor(idx, "pane-old", { maxAgeMs: MAX, now: T0 + 1000 })).toBe(
    "s-old",
  );
  // Stale: 2h later → NOT resumable.
  expect(
    resumableFor(idx, "pane-old", { maxAgeMs: MAX, now: T0 + 2 * MAX }),
  ).toBeNull();
  // resumeCommand likewise suppresses the stale entry.
  expect(
    resumeCommand(idx, "pane-old", { maxAgeMs: MAX, now: T0 + 2 * MAX }),
  ).toBeNull();
});

test("pruneStale drops entries past maxAge, keeps fresh ones", () => {
  let idx = record(
    emptyIndex(),
    { surfaceId: "fresh", sessionId: "s-fresh", repo: "golems", role: "lead" },
    T0 + 9 * 60 * 1000, // recently active
  );
  idx = record(
    idx,
    { surfaceId: "dead", sessionId: "s-dead", repo: "golems", role: "lead" },
    T0, // 10 min older
  );
  const MAX = 5 * 60 * 1000; // 5 min
  const pruned = pruneStale(idx, MAX, T0 + 10 * 60 * 1000);
  expect(lookup(pruned, "fresh")).not.toBeNull();
  expect(lookup(pruned, "dead")).toBeNull();
});

test("loadIndex of a missing or corrupt file yields an empty index (boot never blocks)", () => {
  expect(loadIndex(path.join(scratch, "does-not-exist.json")).entries).toEqual({});
  const corrupt = path.join(scratch, "corrupt.json");
  saveIndex(corrupt, emptyIndex());
  // overwrite with garbage
  require("node:fs").writeFileSync(corrupt, "{ not valid json", "utf8");
  expect(loadIndex(corrupt).entries).toEqual({});
});

test("saveIndex writes pretty JSON with a trailing newline (atomic temp is cleaned up)", () => {
  const p = path.join(scratch, "pretty.json");
  const idx = record(
    emptyIndex(),
    { surfaceId: "p", sessionId: "s", repo: "golems", role: "lead" },
    T0,
  );
  saveIndex(p, idx);
  const raw = readFileSync(p, "utf8");
  expect(raw.endsWith("\n")).toBe(true);
  expect(raw).toContain('"version": 1');
  // No leftover temp file in the dir.
  const leftovers = require("node:fs")
    .readdirSync(scratch)
    .filter((f) => f.includes(".tmp"));
  expect(leftovers.length).toBe(0);
});
