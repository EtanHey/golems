import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { detectInstalledVersion, fetchTags } from "../release-gate.mjs";

const repoRoot = resolve(import.meta.dir, "../..");
const scratch = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(program, args, cwd) {
  execFileSync(program, args, { cwd, stdio: "pipe" });
}

function fixture({ postTagPath = null, installedVersion = "1.0.0", releaseOnly = false, manifestEntry, tagRelease = true } = {}) {
  const root = mkdtempSync(join(repoRoot, ".release-gate-test-"));
  scratch.push(root);
  const remote = join(root, "release-fixture.git");
  const repo = join(root, "work");
  const prefix = join(root, "npm-prefix");
  run("git", ["init", "--bare", remote], root);
  run("git", ["init", "-b", "main", repo], root);
  run("git", ["config", "user.email", "fixture@example.com"], repo);
  run("git", ["config", "user.name", "Release Fixture"], repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src/index.js"), "export const released = true;\n");
  run("git", ["add", "src/index.js"], repo);
  run("git", ["commit", "-m", "release baseline"], repo);
  if (tagRelease) run("git", ["tag", "v1.0.0"], repo);
  run("git", ["remote", "add", "origin", remote], repo);
  run("git", ["push", "-u", "origin", "main", "--tags"], repo);
  run("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"], root);
  run("git", ["remote", "set-head", "origin", "main"], repo);
  if (postTagPath) {
    const target = join(repo, postTagPath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, "changed\n");
    run("git", ["add", postTagPath], repo);
    run("git", ["commit", "-m", `change ${postTagPath}`], repo);
    run("git", ["push"], repo);
  }
  if (installedVersion !== null) {
    const packageDir = join(prefix, "lib/node_modules/release-fixture");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "release-fixture", version: installedVersion }));
  }
  const manifest = join(root, "release-gate.json");
  const repositories = manifestEntry === null ? {} : {
    "release-fixture": manifestEntry ?? { artifact: { kind: "node-npm", identifier: "release-fixture" } },
  };
  writeFileSync(manifest, JSON.stringify({
    ignorePaths: ["docs.local/**", "**/*.md", "collab/**"],
    repositories,
  }));
  const args = ["scripts/release-gate.mjs", repo, "--manifest", manifest, "--json"];
  if (releaseOnly) args.push("--release-only");
  const result = spawnSync("bun", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_PREFIX: prefix },
  });
  return { status: result.status, report: JSON.parse(result.stdout) };
}

describe("release gate CLI exit contract", () => {
  test("CLEAN exits zero at the tag", () => {
    const result = fixture();
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ verdict: "CLEAN", commits: { raw: 0, shippable: 0 } });
  });

  test("MERGED_UNRELEASED exits non-zero for shippable commits", () => {
    const result = fixture({ postTagPath: "src/new.js" });
    expect(result.status).toBe(1);
    expect(result.report).toMatchObject({ verdict: "MERGED_UNRELEASED", commits: { raw: 1, shippable: 1 } });
  });

  test("a docs-only commit remains CLEAN and reports both counts", () => {
    const result = fixture({ postTagPath: "README.md" });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ verdict: "CLEAN", commits: { raw: 1, shippable: 0 } });
  });

  test("RELEASED_UNINSTALLED exits non-zero when the installed version is older", () => {
    const result = fixture({ installedVersion: "0.9.0" });
    expect(result.status).toBe(1);
    expect(result.report).toMatchObject({ verdict: "RELEASED_UNINSTALLED", installedVersion: "0.9.0" });
  });

  test("UNKNOWN exits non-zero when the artifact cannot be detected", () => {
    const result = fixture({ installedVersion: null });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN", installedVersion: null });
  });

  test("release-only mode can enforce the remote tag gate on CI", () => {
    const result = fixture({ installedVersion: null, releaseOnly: true });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ verdict: "CLEAN", installationCheck: "skipped" });
  });

  test("an explicitly non-releasable repo exits zero with its configured reason", () => {
    const reason = "consumed from the repo checkout via symlinked skills; no SemVer release, no published package";
    const result = fixture({
      tagRelease: false,
      manifestEntry: { artifact: { kind: "none" }, reason },
    });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ verdict: "NOT_RELEASABLE", reason });
  });

  test("a missing manifest entry remains UNKNOWN and exits two", () => {
    const result = fixture({ manifestEntry: null });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN" });
  });

  test("kind none without a reason remains UNKNOWN and exits two", () => {
    const result = fixture({ manifestEntry: { artifact: { kind: "none" } } });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN" });
  });
});

test("artifact detectors use their kind-specific commands", () => {
  const seen = [];
  const command = (program, args) => {
    seen.push([program, args]);
    if (program === "npm") return { status: 0, stdout: '{"dependencies":{"tool":{"version":"1.2.3"}}}', stderr: "" };
    return { status: 0, stdout: program === "brew" ? "tool 1.2.3\n" : "1.2.3\n", stderr: "" };
  };
  for (const artifact of [
    { kind: "macos-app", identifier: "Tool" },
    { kind: "homebrew-cask", identifier: "tool" },
    { kind: "python", identifier: "tool" },
    { kind: "node-npm", identifier: "tool" },
  ]) expect(detectInstalledVersion(artifact, command)).toBe("1.2.3");
  expect(seen.map(([program, args]) => [program, args.slice(0, 3)])).toEqual([
    ["defaults", ["read", "/Applications/Tool.app/Contents/Info.plist", "CFBundleShortVersionString"]],
    ["brew", ["list", "--cask", "--versions"]],
    ["python3", ["-c", "import importlib,sys; print(getattr(importlib.import_module(sys.argv[1]),sys.argv[2]))", "tool"]],
    ["npm", ["list", "--global", "--depth=0"]],
  ]);
});

test("tag fetch fails closed when git reports a rejected tag with a zero status", () => {
  const runCommand = () => ({
    status: 0,
    stdout: "",
    stderr: " ! [rejected] v1.5.11 -> v1.5.11 (would clobber existing tag)\n",
  });
  expect(() => fetchTags("/fixture", runCommand)).toThrow("would clobber existing tag");
});
