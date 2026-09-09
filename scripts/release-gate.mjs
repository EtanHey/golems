#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  const options = { repo: null, manifest: resolve(scriptRoot, "release-gate.json"), json: false, releaseOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--release-only") options.releaseOnly = true;
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

export function inspectRelease(options, runCommand = execute) {
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
  return { verdict: "UNKNOWN", repo: resolve(options.repo), error: error instanceof Error ? error.message : String(error) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const report = inspectRelease(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
    process.exitCode = ["CLEAN", "NOT_RELEASABLE"].includes(report.verdict) ? 0 : report.verdict === "UNKNOWN" ? 2 : 1;
  } catch (error) {
    options ??= { repo: process.cwd(), json: process.argv.includes("--json") };
    const report = unknownReport(options, error);
    console.log(options.json ? JSON.stringify(report, null, 2) : `RELEASE GATE: UNKNOWN\n${report.error}`);
    process.exitCode = 2;
  }
}
