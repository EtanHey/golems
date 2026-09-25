#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const canonicalPath = (candidate) => { try { return realpathSync(candidate); } catch { return resolve(candidate); } };
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultIgnores = ["docs.local/**", "**/*.md", "collab/**"];
const defaultTagPattern = "^v?\\d+\\.\\d+\\.\\d+(?:[-+].*)?$";

function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: options.cwd, encoding: "utf8", env: options.env ?? process.env });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

function checked(program, args, options = {}) {
  const result = (options.runCommand ?? execute)(program, args, options);
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function parseArgs(argv) {
  const options = { repo: null, manifest: resolve(scriptRoot, "release-gate.json"), json: false, releaseOnly: false, sha: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--release-only") options.releaseOnly = true;
    else if (argument === "--sha") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--sha requires a commit");
      options.sha = value;
    }
    else if (argument.startsWith("--sha=")) {
      const value = argument.slice(6);
      if (!value || value.startsWith("-")) throw new Error("--sha requires a commit");
      options.sha = value;
    }
    else if (argument === "--manifest") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--manifest requires a path");
      options.manifest = resolve(value);
    }
    else if (argument.startsWith("--manifest=")) options.manifest = resolve(argument.slice(11));
    else if (argument.startsWith("-")) throw new Error(`unknown argument: ${argument}`);
    else if (options.repo) throw new Error(`unexpected argument: ${argument}`);
    else options.repo = resolve(argument);
  }
  options.repo ??= process.cwd();
  if (options.sha && options.releaseOnly) throw new Error("--sha and --release-only are mutually exclusive");
  return options;
}

function remoteIdentity(url) {
  const cleaned = url.trim().replace(/\.git$/, "");
  const github = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (github) return { slug: `${github[1]}/${github[2]}`, name: github[2] };
  return { slug: basename(cleaned), name: basename(cleaned) };
}

function globRegex(pattern) {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") { expression += "(?:.*/)?"; index += 1; }
      else expression += ".*";
    } else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`);
}

function defaultBranch(repo, runCommand) {
  const remote = (runCommand ?? execute)("git", ["-C", repo, "remote", "show", "origin"]);
  const match = remote.status === 0 ? remote.stdout.match(/^\s*HEAD branch:\s*(\S+)\s*$/m) : null;
  if (match) return match[1];
  const symbolic = (runCommand ?? execute)("git", ["-C", repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) return symbolic.stdout.trim().replace(/^origin\//, "");
  throw new Error(`cannot resolve origin's default branch: ${remote.stderr.trim()}`);
}

function latestTag(repo, remoteRef, pattern, runCommand) {
  const output = checked("git", ["-C", repo, "for-each-ref", `--merged=${remoteRef}`, "--sort=-version:refname", "--format=%(refname:short)", "refs/tags"], { runCommand });
  const matcher = new RegExp(pattern || defaultTagPattern);
  const tag = output.split(/\r?\n/).find((candidate) => matcher.test(candidate));
  if (!tag) throw new Error(`no release tag matching ${matcher}`);
  return tag;
}

function commitCounts(repo, tag, remoteRef, ignorePaths, runCommand) {
  const shas = checked("git", ["-C", repo, "rev-list", "--reverse", `${tag}..${remoteRef}`], { runCommand }).split(/\s+/).filter(Boolean);
  const raw = Number.parseInt(checked("git", ["-C", repo, "rev-list", "--count", `${tag}..${remoteRef}`], { runCommand }), 10);
  const ignoredBy = ignorePaths.map((pattern) => globRegex(pattern));
  const shippable = shas.filter((sha) => {
    const paths = checked("git", ["-C", repo, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-m", sha], { runCommand });
    return [...new Set(paths.split(/\r?\n/).filter(Boolean))].some((path) => !ignoredBy.some((matcher) => matcher.test(path)));
  });
  return { raw, shippable: shippable.length };
}

function cleanVersion(value) {
  return value?.trim().replace(/^v(?=\d)/, "") || null;
}

function compareVersions(left, right) {
  const parse = (value) => cleanVersion(value)?.split(/[+-]/, 1)[0].split(".").map((part) => Number.parseInt(part, 10));
  const a = parse(left); const b = parse(right);
  if (!a || !b || [...a, ...b].some(Number.isNaN)) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) < (b[index] ?? 0) ? -1 : 1;
  }
  return 0;
}

export function fetchTags(repo, runCommand = execute) {
  const result = runCommand("git", ["-C", repo, "fetch", "--tags"]);
  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  if (result.status !== 0 || /\[rejected\].*would clobber existing tag/i.test(detail)) {
    throw new Error(`git -C ${repo} fetch --tags failed: ${detail}`);
  }
}

export function detectInstalledVersion(artifact, runCommand = execute) {
  let result;
  if (artifact.kind === "macos-app") {
    const plist = artifact.plist ?? `/Applications/${artifact.identifier}.app/Contents/Info.plist`;
    result = runCommand("defaults", ["read", plist, "CFBundleShortVersionString"]);
  } else if (artifact.kind === "homebrew-cask") {
    result = runCommand("brew", ["list", "--cask", "--versions", artifact.identifier]);
  } else if (artifact.kind === "homebrew") {
    result = runCommand("brew", ["list", "--versions", artifact.identifier]);
  } else if (artifact.kind === "python") {
    result = runCommand(artifact.python ?? "python3", ["-c", "import importlib,sys; print(getattr(importlib.import_module(sys.argv[1]),sys.argv[2]))", artifact.identifier, artifact.versionAttribute ?? "__version__"]);
  } else if (artifact.kind === "node-npm") {
    result = runCommand("npm", ["list", "--global", "--depth=0", "--json", artifact.identifier]);
    try { return cleanVersion(JSON.parse(result.stdout).dependencies?.[artifact.identifier]?.version); } catch { return null; }
  } else throw new Error(`unsupported artifact kind: ${artifact.kind}`);
  if (result.status !== 0) return null;
  const fields = result.stdout.trim().split(/\s+/);
  return cleanVersion(artifact.kind.startsWith("homebrew") ? fields.at(-1) : result.stdout);
}

function containmentUnknown(report, reason) {
  return { ...report, verdict: "UNKNOWN", reason };
}

function remoteTagCommit(repo, tag, runCommand) {
  const result = runCommand("git", ["-C", repo, "ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (result.status !== 0) {
    throw new Error(`git ls-remote failed for ${tag}: ${(result.stderr || result.stdout).trim()}`);
  }
  const refs = new Map(result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, ref] = line.trim().split(/\s+/, 2);
    return [ref, sha];
  }));
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}

function inspectContainment(options, runCommand = execute) {
  const repo = resolve(options.repo);
  const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));
  const identity = remoteIdentity(checked("git", ["-C", repo, "remote", "get-url", "origin"], { runCommand }));
  const config = manifest.repositories?.[identity.slug] ?? manifest.repositories?.[identity.name];
  if (!config) throw new Error(`no manifest entry for ${identity.slug}`);
  const branch = defaultBranch(repo, runCommand);
  if (config.artifact?.kind === "none") {
    if (typeof config.reason !== "string" || !config.reason.trim()) {
      throw new Error(`artifact kind none requires a non-empty reason for ${identity.slug}`);
    }
    return {
      mode: "sha", verdict: "NOT_RELEASABLE", repo, repository: identity.slug, defaultBranch: branch,
      remoteRef: `origin/${branch}`, artifact: config.artifact, reason: config.reason.trim(), installationCheck: "not-applicable",
      requestedSha: options.sha,
    };
  }

  const report = {
    mode: "sha", verdict: "UNKNOWN", repo, repository: identity.slug, artifact: config.artifact,
    installedVersion: null, tag: null, tagCommit: null, requestedSha: options.sha, sha: null, reason: null,
  };
  const requested = runCommand("git", ["-C", repo, "rev-parse", "--verify", "--end-of-options", `${options.sha}^{commit}`]);
  if (requested.status === 0) report.sha = requested.stdout.trim();
  const installedVersion = detectInstalledVersion(config.artifact, runCommand);
  report.installedVersion = installedVersion;
  if (!installedVersion) return containmentUnknown(report, "installed artifact version could not be detected");

  const matcher = new RegExp(config.tagPattern ?? manifest.tagPattern ?? defaultTagPattern);
  const candidates = [...new Set([`v${installedVersion}`, installedVersion])].filter((tag) => matcher.test(tag));
  if (candidates.length === 0) {
    return containmentUnknown(report, `installed version ${installedVersion} has no tag matching ${matcher}`);
  }

  for (const candidate of candidates) {
    let commit;
    try {
      commit = remoteTagCommit(repo, candidate, runCommand);
    } catch (error) {
      return containmentUnknown({ ...report, tag: candidate }, error.message);
    }
    if (commit) {
      report.tag = candidate;
      report.tagCommit = commit;
      break;
    }
  }
  if (!report.tagCommit) {
    return containmentUnknown({ ...report, tag: candidates[0] }, `installed-version tag absent on origin: ${candidates.join(" or ")}`);
  }

  const localTag = runCommand("git", ["-C", repo, "rev-parse", "--verify", `refs/tags/${report.tag}^{commit}`]);
  if (localTag.status === 0 && localTag.stdout.trim() !== report.tagCommit) {
    return containmentUnknown(report, `local tag ${report.tag} points to ${localTag.stdout.trim()}, origin points to ${report.tagCommit}`);
  }

  let tagObject = runCommand("git", ["-C", repo, "cat-file", "-e", `${report.tagCommit}^{commit}`]);
  if (tagObject.status !== 0) {
    const fetched = runCommand("git", ["-C", repo, "fetch", "--no-tags", "origin", report.tagCommit]);
    if (fetched.status !== 0) {
      return containmentUnknown(report, `could not fetch installed tag commit ${report.tagCommit}: ${(fetched.stderr || fetched.stdout).trim()}`);
    }
    tagObject = runCommand("git", ["-C", repo, "cat-file", "-e", `${report.tagCommit}^{commit}`]);
    if (tagObject.status !== 0) return containmentUnknown(report, `installed tag commit is unavailable locally: ${report.tagCommit}`);
  }

  if (requested.status !== 0) return containmentUnknown(report, `requested sha is not a known commit: ${options.sha}`);

  const shallow = runCommand("git", ["-C", repo, "rev-parse", "--is-shallow-repository"]);
  if (shallow.status !== 0) {
    return containmentUnknown(report, `could not determine whether repository is shallow: ${(shallow.stderr || shallow.stdout).trim()}`);
  }
  if (shallow.stdout.trim() === "true") {
    return containmentUnknown(report, "shallow clone: containment cannot be decided; run git fetch --unshallow");
  }

  const ancestor = runCommand("git", ["-C", repo, "merge-base", "--is-ancestor", report.sha, report.tagCommit]);
  if (ancestor.status === 0) {
    return { ...report, verdict: "CONTAINED", reason: `requested commit is contained in installed tag ${report.tag}` };
  }
  if (ancestor.status === 1) {
    return { ...report, verdict: "NOT_CONTAINED", reason: `requested commit is not contained in installed tag ${report.tag}` };
  }
  return containmentUnknown(report, `git merge-base failed: ${(ancestor.stderr || ancestor.stdout).trim()}`);
}

export function inspectRelease(options, runCommand = execute) {
  if (options.sha) return inspectContainment(options, runCommand);
  const repo = resolve(options.repo);
  const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));
  fetchTags(repo, runCommand);
  const identity = remoteIdentity(checked("git", ["-C", repo, "remote", "get-url", "origin"], { runCommand }));
  const config = manifest.repositories?.[identity.slug] ?? manifest.repositories?.[identity.name];
  if (!config) throw new Error(`no manifest entry for ${identity.slug}`);
  const branch = defaultBranch(repo, runCommand);
  const remoteRef = `origin/${branch}`;
  if (config.artifact?.kind === "none") {
    if (typeof config.reason !== "string" || !config.reason.trim()) {
      throw new Error(`artifact kind none requires a non-empty reason for ${identity.slug}`);
    }
    return {
      verdict: "NOT_RELEASABLE", repo, repository: identity.slug, defaultBranch: branch, remoteRef,
      artifact: config.artifact, reason: config.reason.trim(), installationCheck: "not-applicable",
    };
  }
  const tag = latestTag(repo, remoteRef, config.tagPattern ?? manifest.tagPattern, runCommand);
  const ignorePaths = config.ignorePaths ?? manifest.ignorePaths ?? defaultIgnores;
  const commits = commitCounts(repo, tag, remoteRef, ignorePaths, runCommand);
  const installedVersion = options.releaseOnly ? null : detectInstalledVersion(config.artifact, runCommand);
  const installedComparison = options.releaseOnly || !installedVersion ? null : compareVersions(installedVersion, tag);
  let verdict = "CLEAN";
  if (commits.shippable > 0) verdict = "MERGED_UNRELEASED";
  else if (!options.releaseOnly && !installedVersion) verdict = "UNKNOWN";
  else if (!options.releaseOnly && installedComparison === null) verdict = "UNKNOWN";
  else if (!options.releaseOnly && installedComparison === -1) verdict = "RELEASED_UNINSTALLED";
  return {
    verdict, repo, repository: identity.slug, defaultBranch: branch, remoteRef, latestTag: tag,
    releasedVersion: cleanVersion(tag), installedVersion, installationCheck: options.releaseOnly ? "skipped" : "performed",
    artifact: config.artifact, commits, ignorePaths,
  };
}

function formatHuman(report) {
  if (report.verdict === "NOT_RELEASABLE") {
    return [
      "RELEASE GATE: NOT_RELEASABLE (configured)",
      `Repository: ${report.repository} (${report.repo})`,
      `Remote default: ${report.remoteRef}`,
      `Reason: ${report.reason}`,
    ].join("\n");
  }
  if (report.mode === "sha") {
    return [
      `RELEASE GATE: ${report.verdict}`,
      `Repository: ${report.repository} (${report.repo})`,
      `Installed artifact: ${report.artifact.kind}:${report.artifact.identifier} version=${report.installedVersion ?? "UNKNOWN"}`,
      `Installed tag: ${report.tag ?? "UNKNOWN"}`,
      `Installed tag commit: ${report.tagCommit ?? "UNKNOWN"}`,
      `Requested input: ${report.requestedSha}`,
      `Requested commit: ${report.sha ?? "UNKNOWN"}`,
      `Reason: ${report.reason}`,
    ].join("\n");
  }
  return [
    `RELEASE GATE: ${report.verdict}`,
    `Repository: ${report.repository} (${report.repo})`,
    `Remote default: ${report.remoteRef}`,
    `Latest release tag: ${report.latestTag}`,
    `Commits past tag: raw=${report.commits.raw} shippable=${report.commits.shippable}`,
    `Ignored paths: ${report.ignorePaths.join(", ")}`,
    report.installationCheck === "skipped" ? "Installed artifact: NOT_CHECKED (--release-only)" : `Installed artifact: ${report.artifact.kind}:${report.artifact.identifier} version=${report.installedVersion ?? "UNKNOWN"}`,
  ].join("\n");
}

function unknownReport(options, error) {
  return {
    verdict: "UNKNOWN",
    repo: resolve(options.repo),
    ...(options.sha ? { requestedSha: options.sha } : {}),
    error: error instanceof Error ? error.message : String(error),
  };
}

export function releaseExitCode(verdict) {
  if (["CLEAN", "NOT_RELEASABLE", "CONTAINED"].includes(verdict)) return 0;
  return verdict === "UNKNOWN" ? 2 : 1;
}

if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url))) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const report = inspectRelease(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
    process.exitCode = releaseExitCode(report.verdict);
  } catch (error) {
    const argv = process.argv.slice(2);
    const shaIndex = argv.indexOf("--sha");
    const requestedSha = shaIndex >= 0 ? argv[shaIndex + 1] : argv.find((argument) => argument.startsWith("--sha="))?.slice(6);
    options ??= { repo: process.cwd(), json: process.argv.includes("--json"), sha: requestedSha || null };
    const report = unknownReport(options, error);
    console.log(options.json ? JSON.stringify(report, null, 2) : `RELEASE GATE: UNKNOWN\n${report.error}`);
    process.exitCode = 2;
  }
}
