import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { detectInstalledVersion, fetchTags, releaseExitCode } from "../release-gate.mjs";

const repoRoot = resolve(import.meta.dir, "../..");
const scratch = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(program, args, cwd) {
  execFileSync(program, args, { cwd, stdio: "pipe" });
}

function fixture({
  postTagPath = null,
  installedVersion = "1.0.0",
  releaseOnly = false,
  manifestEntry,
  tagRelease = true,
  releaseTag = "v1.0.0",
  annotatedTag = false,
  sha = null,
  localRelevantTagMismatch = false,
  removeRemoteTag = false,
  unrelatedTagConflict = false,
  viaSymlink = false,
} = {}) {
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
  const releasedSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  if (tagRelease) run("git", annotatedTag ? ["tag", "--annotate", releaseTag, "--message", "release"] : ["tag", releaseTag], repo);
  if (unrelatedTagConflict) run("git", ["tag", "pre-rename"], repo);
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
  const postTagSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  if (removeRemoteTag) run("git", ["push", "origin", `:refs/tags/${releaseTag}`], repo);
  if (localRelevantTagMismatch || unrelatedTagConflict) {
    run("git", ["commit", "--allow-empty", "-m", "local tag conflict target"], repo);
    run("git", ["tag", "--force", localRelevantTagMismatch ? releaseTag : "pre-rename"], repo);
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
  const script = viaSymlink ? join(root, "release-gate.mjs") : "scripts/release-gate.mjs";
  if (viaSymlink) symlinkSync(join(repoRoot, "scripts/release-gate.mjs"), script);
  const args = [script, repo, "--manifest", manifest, "--json"];
  if (releaseOnly) args.push("--release-only");
  if (sha) args.push("--sha", sha === "released" ? releasedSha : sha === "post-tag" ? postTagSha : sha);
  const result = spawnSync(viaSymlink ? "node" : "bun", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_PREFIX: prefix },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    report: result.stdout.trim() ? JSON.parse(result.stdout) : null,
    releasedSha,
    postTagSha,
  };
}

function historyCloneFixture({ shallow }) {
  const root = mkdtempSync(join(repoRoot, ".release-gate-test-"));
  scratch.push(root);
  const remote = join(root, "release-fixture.git");
  const seed = join(root, "seed");
  const repo = join(root, shallow ? "shallow" : "full");
  const prefix = join(root, "npm-prefix");
  run("git", ["init", "--bare", remote], root);
  run("git", ["init", "-b", "main", seed], root);
  run("git", ["config", "user.email", "fixture@example.com"], seed);
  run("git", ["config", "user.name", "Release Fixture"], seed);
  let oldSha;
  for (let index = 1; index <= 3; index += 1) {
    writeFileSync(join(seed, "history.txt"), `${index}\n`);
    run("git", ["add", "history.txt"], seed);
    run("git", ["commit", "-m", `history ${index}`], seed);
    if (index === 1) oldSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: seed, encoding: "utf8" }).trim();
  }
  run("git", ["tag", "v1.0.0"], seed);
  run("git", ["remote", "add", "origin", remote], seed);
  run("git", ["push", "-u", "origin", "main", "--tags"], seed);
  run("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"], root);
  const cloneArgs = ["clone"];
  if (shallow) cloneArgs.push("--depth", "1");
  cloneArgs.push("--branch", "v1.0.0", `file://${remote}`, repo);
  run("git", cloneArgs, root);
  if (shallow) run("git", ["fetch", "--no-tags", "origin", oldSha], repo);

  const packageDir = join(prefix, "lib/node_modules/release-fixture");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "release-fixture", version: "1.0.0" }));
  const manifest = join(root, "release-gate.json");
  writeFileSync(manifest, JSON.stringify({
    repositories: { "release-fixture": { artifact: { kind: "node-npm", identifier: "release-fixture" } } },
  }));
  const result = spawnSync("bun", ["scripts/release-gate.mjs", repo, "--manifest", manifest, "--json", "--sha", oldSha], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_PREFIX: prefix },
  });
  return { status: result.status, report: JSON.parse(result.stdout), oldSha };
}

describe("release gate CLI exit contract", () => {
  test("node CLI executes through a symlink", () => {
    const result = fixture({ viaSymlink: true });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    expect(result.report).toMatchObject({ verdict: "CLEAN" });
  }, 15_000); // spawns node through a symlink; a cold runner can exceed the 5s default

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

describe("release gate installed artifact containment", () => {
  test("CONTAINED exits zero when the requested merge is in the installed tag", () => {
    const result = fixture({ sha: "released" });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({
      verdict: "CONTAINED",
      installedVersion: "1.0.0",
      tag: "v1.0.0",
      tagCommit: result.releasedSha,
      sha: result.releasedSha,
    });
  });

  test("a shallow clone is UNKNOWN while its full-clone twin is CONTAINED", () => {
    const shallow = historyCloneFixture({ shallow: true });
    expect(shallow.status).toBe(2);
    expect(shallow.report).toMatchObject({ verdict: "UNKNOWN", requestedSha: shallow.oldSha });
    expect(shallow.report.reason).toContain("shallow");

    const full = historyCloneFixture({ shallow: false });
    expect(full.status).toBe(0);
    expect(full.report).toMatchObject({ verdict: "CONTAINED", sha: full.oldSha, requestedSha: full.oldSha });
  });

  test("NOT_CONTAINED exits one when the requested merge is newer than the installed tag", () => {
    const result = fixture({ postTagPath: "src/new.js", sha: "post-tag" });
    expect(result.status).toBe(1);
    expect(result.report).toMatchObject({
      verdict: "NOT_CONTAINED",
      installedVersion: "1.0.0",
      tag: "v1.0.0",
      tagCommit: result.releasedSha,
      sha: result.postTagSha,
    });
  });

  test("falls back to an unprefixed installed-version tag", () => {
    const result = fixture({ sha: "released", releaseTag: "1.0.0" });
    expect(result.report).toMatchObject({ verdict: "CONTAINED", tag: "1.0.0", tagCommit: result.releasedSha });
  });

  test("uses the peeled commit for an annotated installed-version tag", () => {
    const result = fixture({ sha: "released", annotatedTag: true });
    expect(result.report).toMatchObject({ verdict: "CONTAINED", tag: "v1.0.0", tagCommit: result.releasedSha });
  });

  test("UNKNOWN exits two when there is no installed version", () => {
    const result = fixture({ installedVersion: null, sha: "released" });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN", installedVersion: null, sha: result.releasedSha });
  });

  test("UNKNOWN exits two when the requested sha is not a known commit", () => {
    const result = fixture({ sha: "deadbeef" });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN", installedVersion: "1.0.0", tag: "v1.0.0", requestedSha: "deadbeef" });
  });

  test("--sha and --release-only are mutually exclusive", () => {
    const result = fixture({ sha: "released", releaseOnly: true });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN", requestedSha: result.releasedSha });
    expect(result.report.error).toContain("--sha and --release-only are mutually exclusive");
  });

  test("UNKNOWN exits two when the local installed-version tag disagrees with origin", () => {
    const result = fixture({ sha: "released", localRelevantTagMismatch: true });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN", tag: "v1.0.0", tagCommit: result.releasedSha });
    expect(result.report.reason).toContain("local tag");
  });

  test("UNKNOWN exits two when the installed-version tag is absent on origin", () => {
    const result = fixture({ sha: "released", removeRemoteTag: true });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ verdict: "UNKNOWN", installedVersion: "1.0.0" });
    expect(result.report.reason).toContain("absent on origin");
  });

  test("an unrelated conflicting local tag does not change a CONTAINED verdict", () => {
    const result = fixture({ sha: "released", unrelatedTagConflict: true });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ verdict: "CONTAINED", tag: "v1.0.0", sha: result.releasedSha });
  });

  test("an unrelated conflicting local tag does not change a NOT_CONTAINED verdict", () => {
    const result = fixture({ postTagPath: "src/new.js", sha: "post-tag", unrelatedTagConflict: true });
    expect(result.status).toBe(1);
    expect(result.report).toMatchObject({ verdict: "NOT_CONTAINED", tag: "v1.0.0", sha: result.postTagSha });
  });

  test("artifact kind none remains NOT_RELEASABLE in sha mode", () => {
    const reason = "consumed from checkout";
    const result = fixture({
      tagRelease: false,
      sha: "released",
      manifestEntry: { artifact: { kind: "none" }, reason },
    });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ verdict: "NOT_RELEASABLE", reason });
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

test("CONTAINED is a successful release verdict", () => {
  expect(releaseExitCode("CONTAINED")).toBe(0);
});
