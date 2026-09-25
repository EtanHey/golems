import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseSyncCli } from "../../cc-usage-sync";

// AIDEV-NOTE: GO-6 found `cc-usage-sync.ts --help` ran the real 7-day sync and
// wrote 812 llm_usage rows. --help must print usage and write nothing; an
// unknown argument must refuse instead of syncing.
describe("parseSyncCli", () => {
  test("--help and -h ask for usage", () => {
    expect(parseSyncCli(["--help"])).toEqual({ kind: "help" });
    expect(parseSyncCli(["--dry-run", "-h"])).toEqual({ kind: "help" });
  });

  test("documented flags run", () => {
    for (const args of [
      [],
      ["--dry-run", "--days", "30"],
      ["--days=3", "--provider=codex"],
      ["--no-archives", "--include-archive-tars", "--archive-root=/x", "--claude-archive-root=/y"],
      ["--codex-archive-root=/a", "--cursor-archive-root=/b", "--archive-tar=/c.tar.gz"],
      ["--repair-native-synced-at=2026-01-01T00:00:00Z", "--repair-cursor-synced-at=2026-01-01T00:00:00Z", "--apply-repair"],
    ]) {
      expect(parseSyncCli(args)).toEqual({ kind: "run" });
    }
  });

  test("an unknown flag or stray word refuses", () => {
    expect(parseSyncCli(["--bogus"])).toEqual({ kind: "unknown", arg: "--bogus" });
    expect(parseSyncCli(["--dry-run", "help"])).toEqual({ kind: "unknown", arg: "help" });
    expect(parseSyncCli(["--provider"])).toEqual({ kind: "unknown", arg: "--provider" });
  });
});

describe("cc-usage-sync CLI", () => {
  // A dead Supabase endpoint and an empty HOME: even a regression cannot write.
  const run = (args: string[]) => {
    const home = mkdtempSync(join(tmpdir(), "cc-usage-sync-cli-"));
    return Bun.spawnSync(["bun", join(import.meta.dir, "../../cc-usage-sync.ts"), ...args], {
      cwd: home,
      env: { ...process.env, HOME: home, SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_KEY: "invalid" },
    });
  };

  test("--help prints usage, exits 0, and never scans", () => {
    const result = run(["--help"]);
    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).not.toContain("Scanning");
  });

  test("an unknown flag exits 2 with usage and never scans", () => {
    const result = run(["--bogus"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("Unknown argument: --bogus");
    expect(result.stdout.toString()).not.toContain("Scanning");
  });
});
