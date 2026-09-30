import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

const ROLLUP = join(dirname(import.meta.dir), "rollup.mjs");
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

export { afterEach, describe, expect, test, setDefaultTimeout, spawnSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, tmpdir, basename, dirname, join, ROLLUP, NOW, roots, fixture, rollup, plan, uploadPaths, listFiles };
