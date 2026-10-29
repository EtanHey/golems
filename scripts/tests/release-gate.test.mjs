import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { callbackResult, detectInstalledVersion, fetchTags, inspectRelease, releaseExitCode } from "../ci/release-gate.mjs";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

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
  callback = false,
  postTagDate = null,
  mergeTopic = false,
  recentCommit = false,
  releaseConclusion = "success",
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
  if (mergeTopic) run("git", ["switch", "-c", "topic"], repo);
  if (postTagPath) {
    const target = join(repo, postTagPath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, "changed\n");
    run("git", ["add", postTagPath], repo);
    execFileSync("git", ["commit", "-m", `change ${postTagPath}`], { cwd: repo, stdio: "pipe",
      env: { ...process.env, ...(postTagDate ? { GIT_AUTHOR_DATE: postTagDate, GIT_COMMITTER_DATE: postTagDate } : {}) } });
    if (mergeTopic) {
      run("git", ["switch", "main"], repo);
      run("git", ["merge", "--no-ff", "topic", "-m", "integrate old topic"], repo);
    }
    run("git", ["push", "origin", "main"], repo);
  }
  if (recentCommit) {
    writeFileSync(join(repo, "src/recent.js"), "recent\n");
    run("git", ["add", "src/recent.js"], repo);
    run("git", ["commit", "-m", "recent integration"], repo);
    run("git", ["push", "origin", "main"], repo);
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
  const script = viaSymlink ? join(root, "release-gate.mjs") : "scripts/ci/release-gate.mjs";
  if (viaSymlink) symlinkSync(join(repoRoot, "scripts/ci/release-gate.mjs"), script);
  const args = [script, repo, "--manifest", manifest, "--json"];
  if (releaseOnly) args.push("--release-only");
  if (callback) args.push("--callback");
  const summary = join(root, "summary.md");
  if (sha) args.push("--sha", sha === "released" ? releasedSha : sha === "post-tag" ? postTagSha : sha);
  const result = spawnSync(viaSymlink ? "node" : "bun", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_PREFIX: prefix, GITHUB_STEP_SUMMARY: summary, RELEASE_WORKFLOW_CONCLUSION: releaseConclusion },
  });
  return {
    stderr: result.stderr,
    summary: callback && result.status === 0 ? readFileSync(summary, "utf8") : null,
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
  const result = spawnSync("bun", ["scripts/ci/release-gate.mjs", repo, "--manifest", manifest, "--json", "--sha", oldSha], {
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

test('github-release reads the client release.json version, including the commit suffix', () => {
  const root = mkdtempSync(join(repoRoot, '.release-gate-test-'));
  scratch.push(root);
  const installed = join(root, 'release.json');
  writeFileSync(installed, '{"version":"2026.10.11-abcdef0"}');
  expect(detectInstalledVersion({ kind: 'github-release', releaseJson: installed })).toBe('2026.10.11-abcdef0');
  writeFileSync(installed, '{"version":42}');
  expect(detectInstalledVersion({ kind: 'github-release', releaseJson: installed })).toBeNull();
});

test('github-release requires a published release with all three assets; equal dates do not hide stale commits', () => {
  const root = mkdtempSync(join(repoRoot, '.release-gate-test-'));
  scratch.push(root);
  const manifest = join(root, 'gate.json'), installed = join(root, 'installed.json');
  const version = '2026.10.11-abcdef0';
  writeFileSync(installed, '{"version":"2026.10.11-1234567"}');
  writeFileSync(manifest, JSON.stringify({ repositories: { 'EtanHey/golems': { artifact: { kind: 'github-release', installedJson: installed } } } }));
  let assets = [`golems-${version}.tar.gz`, 'MANIFEST.json', 'SHA256SUMS'];
  const command = (program, args) => {
    if (program === 'gh') return { status: 0, stdout: JSON.stringify({ draft: false, assets: assets.map(name => ({ name, state: 'uploaded', size: 1 })) }), stderr: '' };
    const key = args.join(' ');
    const stdout = key.includes('get-url') ? 'https://github.com/EtanHey/golems.git' : key.includes('remote show') ? 'HEAD branch: master' : key.includes('--first-parent') ? `HEAD, tag: v${version}\ntag: v2026.10.11-ffffff0` : key.includes('for-each-ref') ? `v2026.10.11-ffffff0\nv${version}` : key.includes('--count') ? '0' : '';
    return { status: 0, stdout, stderr: '' };
  };
  expect(inspectRelease({ repo: root, manifest }, command).verdict).toBe('RELEASED_UNINSTALLED');
  expect(inspectRelease({ repo: root, manifest, releaseOnly: true }, command)).toMatchObject({ verdict: 'CLEAN', latestTag: `v${version}` });
  assets = [];
  expect(inspectRelease({ repo: root, manifest, releaseOnly: true }, command).verdict).toBe('UNKNOWN');
});

for (const shaMode of [false, true]) test(`github-release nightly prereleases work in ${shaMode ? '--sha' : 'release-only'} mode; drafts and other channels fail closed`, () => {
  const root = mkdtempSync(join(repoRoot, '.release-gate-test-')); scratch.push(root);
  const manifest = join(root, 'gate.json'), installed = join(root, 'release.json');
  const version = '2026.10.11-abcdef0', commit = 'abcdef0' + '1'.repeat(33);
  writeFileSync(installed, JSON.stringify({ version }));
  let draft = false, prerelease = true, channel = 'nightly', assets = [`golems-${version}.tar.gz`, 'MANIFEST.json', 'SHA256SUMS'];
  const command = (program, args) => {
    if (program === 'gh') return { status: 0, stdout: JSON.stringify({ draft, prerelease, assets: assets.map(name => ({ name, state: 'uploaded', size: 1 })) }), stderr: '' };
    const key = args.join(' ');
    const stdout = key.includes('get-url') ? 'https://github.com/EtanHey/golems.git' : key.includes('remote show') ? 'HEAD branch: master' : key.includes('ls-remote') ? `${commit}\trefs/tags/v${version}` : key.includes('--is-shallow') ? 'false' : key.includes('rev-parse') ? commit : key.includes('--first-parent') ? `HEAD, tag: v${version}` : key.includes('--count') ? '0' : '';
    return { status: 0, stdout, stderr: '' };
  };
  const inspect = () => {
    writeFileSync(manifest, JSON.stringify({ repositories: { 'EtanHey/golems': { channel, artifact: { kind: 'github-release', releaseJson: installed } } } }));
    return inspectRelease({ repo: root, manifest, ...(shaMode ? { sha: commit } : { releaseOnly: true }) }, command);
  };
  expect(inspect().verdict).toBe(shaMode ? 'CONTAINED' : 'CLEAN');
  draft = true; expect(inspect().verdict).toBe('UNKNOWN'); draft = false;
  assets = []; expect(inspect().verdict).toBe('UNKNOWN'); assets = [`golems-${version}.tar.gz`, 'MANIFEST.json', 'SHA256SUMS'];
  channel = undefined; expect(inspect().verdict).toBe('UNKNOWN');
  channel = 'stable'; expect(inspect().verdict).toBe('UNKNOWN');
  prerelease = false; expect(inspect().verdict).toBe(shaMode ? 'CONTAINED' : 'CLEAN');
});

describe("release gate callback grace period", () => {
  test("transient shippable lag exits zero with a warning and summary", () => {
    const result = fixture({ postTagPath: "src/new.js", releaseOnly: true, callback: true, viaSymlink: true });
    expect(result.status).toBe(0);
    expect(result.report.verdict).toBe("MERGED_UNRELEASED");
    expect(result.stderr).toContain("::warning::");
    expect(result.summary).toContain("MERGED_UNRELEASED");
    expect(result.summary).toContain("2 hours");
  });

  test("overdue shippable lag remains non-zero despite a recent commit", () => {
    const result = fixture({ postTagPath: "src/new.js", releaseOnly: true, callback: true, recentCommit: true,
      postTagDate: new Date(Date.now() - 3 * 3600_000).toISOString() });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("::error::");
    expect(result.report.verdict).toBe("MERGED_UNRELEASED");
  });

  test("broken release metadata is never softened", () => {
    const result = fixture({ tagRelease: false, releaseOnly: true, callback: true });
    expect(result.status).toBe(2);
    expect(result.report.verdict).toBe("UNKNOWN");
  });

  test.each(["success", "cancelled", "skipped"])("publisher conclusion %s passes through", (releaseConclusion) => {
    const result = fixture({ releaseOnly: true, callback: true, releaseConclusion });
    expect(result.status).toBe(0);
    expect(result.report.verdict).toBe("CLEAN");
  });

  test.each(["failure", "timed_out", "startup_failure", "action_required"])("publisher conclusion %s stays red", (releaseConclusion) => {
    const result = fixture({ releaseOnly: true, callback: true, releaseConclusion });
    expect(result.status).toBe(2);
    expect(result.report.verdict).toBe("UNKNOWN");
    expect(result.report.error).toContain(releaseConclusion);
  });

  test("a future integration within five minutes receives grace", () => {
    const result = fixture({ postTagPath: "src/new.js", releaseOnly: true, callback: true,
      postTagDate: new Date(Date.now() + 4 * 60_000).toISOString() });
    expect(result.status).toBe(0);
    expect(result.report.verdict).toBe("MERGED_UNRELEASED");
    expect(result.stderr).toContain("::warning::");
  });

  test("an integration beyond five minutes in the future fails closed", () => {
    const result = fixture({ postTagPath: "src/new.js", releaseOnly: true, callback: true,
      postTagDate: new Date(Date.now() + 6 * 60_000).toISOString() });
    expect(result.status).toBe(2);
    expect(result.report.verdict).toBe("UNKNOWN");
  });

  test("callback requires release-only mode", () => {
    const result = fixture({ callback: true });
    expect(result.status).toBe(2);
  });
});

test("callback threshold includes exactly 2 hours; missing age fails closed", () => {
  const now = Date.now();
  const report = { verdict: "MERGED_UNRELEASED", commits: { oldestShippableAt: new Date(now - 2 * 3600_000).toISOString() } };
  expect(callbackResult(report, now).code).toBe(1);
  expect(callbackResult(report, now - 1).code).toBe(0);
  expect(callbackResult(report, now + 1).code).toBe(1);
  expect(() => callbackResult({ verdict: "MERGED_UNRELEASED" }, now)).toThrow();
  expect(callbackResult({ verdict: "UNKNOWN" }, now).code).toBe(2);
});

test("an old topic merged now gets a fresh integration grace period", () => {
  const result = fixture({ postTagPath: "src/new.js", releaseOnly: true, callback: true, mergeTopic: true,
    postTagDate: new Date(Date.now() - 72 * 3600_000).toISOString() });
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("::warning::");
});


test("old docs-only lag stays clean in callback mode", () => {
  const result = fixture({ postTagPath: "README.md", releaseOnly: true, callback: true,
    postTagDate: new Date(Date.now() - 72 * 3600_000).toISOString() });
  expect(result.status).toBe(0);
  expect(result.report.verdict).toBe("CLEAN");
});


test("callback tolerates five minutes of clock skew, treating future timestamps as age zero", () => {
  const now = Date.now();
  const report = { verdict: "MERGED_UNRELEASED", commits: { oldestShippableAt: new Date(now + 5 * 60_000).toISOString() } };
  expect(callbackResult(report, now)).toMatchObject({ code: 0, annotation: "warning" });
  expect(callbackResult(report, now + 1).code).toBe(0);
  expect(() => callbackResult(report, now - 1)).toThrow("invalid unreleased integration time");
});
