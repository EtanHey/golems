#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHookEntry,
  buildLaunchdEntry,
  buildReport,
  findUnusedEnvironmentKeys,
  formatHumanReport,
  isManagedLabel,
  parseLaunchctlPrint,
  plistsMatch,
  reportExitCode,
  selectManagedTarget,
} from "./deploy-drift-check-lib.mjs";

const RETIRED_LABELS = ["com.golems.mcp-reaper"];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = resolve(scriptDir, "..");

export function execute(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function requiredValue(argv, index, argument) {
  if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${argument} requires a value`);
  return argv[index + 1];
}

export function parseArgs(argv) {
  const options = {
    format: "human",
    home: homedir(),
    gitsRoot: null,
    sourceRoot: null,
    launchAgentsDir: null,
    hooksDir: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.format = "json";
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (["--home", "--gits-root", "--source-root", "--launch-agents", "--hooks-dir"].includes(argument)) {
      const value = requiredValue(argv, index, argument);
      index += 1;
      if (argument === "--home") options.home = value;
      else if (argument === "--gits-root") options.gitsRoot = value;
      else if (argument === "--source-root") options.sourceRoot = value;
      else if (argument === "--launch-agents") options.launchAgentsDir = value;
      else options.hooksDir = value;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function canonicalExistingPath(path) {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function gitTopLevel(path, runCommand) {
  const result = runCommand("git", ["-C", path, "rev-parse", "--show-toplevel"]);
  return result.ok ? canonicalExistingPath(result.stdout.trim()) : null;
}

export function discoverGitRepositories({ gitsRoot, sourceRoot, runCommand = execute }) {
  const canonicalSource = canonicalExistingPath(sourceRoot);
  const repositories = [{ repoRoot: canonicalSource, scanSources: true }];
  const seen = new Set([canonicalSource]);
  const sourceName = basename(canonicalSource);
  const sourceRemote = runCommand("git", ["-C", canonicalSource, "config", "--get", "remote.origin.url"]);
  const sourceRemoteUrl = sourceRemote.ok ? sourceRemote.stdout.trim() : null;
  if (!existsSync(gitsRoot)) return repositories;

  for (const item of readdirSync(gitsRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!item.isDirectory() || item.name.startsWith(".") || item.name.endsWith(".wt")) continue;
    const candidate = join(gitsRoot, item.name);
    if (!existsSync(join(candidate, ".git"))) continue;
    const repoRoot = gitTopLevel(candidate, runCommand);
    if (!repoRoot || seen.has(repoRoot)) continue;
    seen.add(repoRoot);
    const remote = runCommand("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"]);
    const sameRemote = Boolean(sourceRemoteUrl && remote.ok && remote.stdout.trim() === sourceRemoteUrl);
    repositories.push({ repoRoot, scanSources: !sameRemote && basename(repoRoot) !== sourceName });
  }
  return repositories;
}

export function discoverInstalledPlists(launchAgentsDir) {
  if (!existsSync(launchAgentsDir)) return [];
  return readdirSync(launchAgentsDir, { withFileTypes: true })
    .filter((item) => item.isFile() || item.isSymbolicLink())
    .map((item) => item.name)
    .filter((name) => /^com\.golems.*\.plist$/.test(name))
    .sort()
    .map((name) => join(launchAgentsDir, name));
}

export function readPlist(path, runCommand = execute) {
  const plutil = runCommand("plutil", ["-convert", "json", "-o", "-", path]);
  if (plutil.ok) return JSON.parse(plutil.stdout);
  const python = runCommand("python3", [
    "-c",
    "import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], 'rb'))))",
    path,
  ]);
  if (python.ok) return JSON.parse(python.stdout);
  throw new Error((plutil.stderr || python.stderr || "plist parse failed").trim());
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function owningRepository(path, repositories) {
  const absolute = resolve(path);
  return repositories
    .filter((repo) => absolute === repo.repoRoot || absolute.startsWith(`${repo.repoRoot}${sep}`))
    .sort((left, right) => right.repoRoot.length - left.repoRoot.length)[0] ?? null;
}

export function inspectTarget(path, repositories, runCommand = execute) {
  const absolute = resolve(path);
  const repo = owningRepository(absolute, repositories);
  const exists = existsSync(absolute);
  if (!repo) return { path: absolute, exists, repoRoot: null, tracked: null, ignored: false };
  const repoRelative = relative(repo.repoRoot, absolute);
  const tracked = runCommand("git", ["-C", repo.repoRoot, "ls-files", "--error-unmatch", "--", repoRelative]).ok;
  const ignored = runCommand("git", ["-C", repo.repoRoot, "check-ignore", "-q", "--", repoRelative]).ok;
  return { path: absolute, exists, repoRoot: repo.repoRoot, tracked, ignored };
}

function resolveUpstream(repoRoot, runCommand) {
  const remoteHead = runCommand("git", ["-C", repoRoot, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const candidates = [remoteHead.ok ? remoteHead.stdout.trim() : null, "origin/master", "origin/main"].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    const result = runCommand("git", ["-C", repoRoot, "rev-parse", "--verify", candidate]);
    if (result.ok) return result.stdout.trim();
  }
  return null;
}

export function inspectCheckout(repoRoot, runCommand = execute) {
  const headResult = runCommand("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
  if (!headResult.ok) throw new Error((headResult.stderr || "cannot resolve checkout HEAD").trim());
  const head = headResult.stdout.trim();
  const upstream = resolveUpstream(repoRoot, runCommand);
  const status = runCommand("git", ["-C", repoRoot, "status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) throw new Error((status.stderr || "cannot inspect checkout status").trim());

  let relation = "unknown";
  if (upstream === head) relation = "equal";
  else if (upstream) {
    const behind = runCommand("git", ["-C", repoRoot, "merge-base", "--is-ancestor", head, upstream]);
    if (behind.ok) relation = "behind";
    else {
      const ahead = runCommand("git", ["-C", repoRoot, "merge-base", "--is-ancestor", upstream, head]);
      relation = ahead.ok ? "ahead" : "diverged";
    }
  }
  return { repoRoot, head, upstream, relation, dirty: status.stdout.trim().length > 0 };
}

function inspectionError(operation, subject, error) {
  return { operation, subject, message: error instanceof Error ? error.message : String(error) };
}

function publicSource(source) {
  if (!source) return null;
  return {
    path: source.path,
    repoRoot: source.repoRoot,
    commit: source.commit,
    sha256: source.sha256,
  };
}

function listTrackedSources(repositories, runCommand, reportErrors) {
  const byLabel = new Map();
  for (const repo of repositories.filter((candidate) => candidate.scanSources)) {
    const listing = runCommand("git", ["-C", repo.repoRoot, "ls-files", "-z", "*.plist"]);
    const commit = runCommand("git", ["-C", repo.repoRoot, "rev-parse", "HEAD"]);
    if (!listing.ok || !commit.ok) {
      reportErrors.push(inspectionError("git-source-inventory", repo.repoRoot, listing.stderr || commit.stderr));
      continue;
    }
    for (const repoRelative of listing.stdout.split("\0").filter(Boolean)) {
      const path = join(repo.repoRoot, repoRelative);
      try {
        const plist = readPlist(path, runCommand);
        if (!isManagedLabel(plist.Label)) continue;
        const source = {
          path,
          repoRoot: repo.repoRoot,
          commit: commit.stdout.trim(),
          sha256: sha256File(path),
          plist,
        };
        if (!byLabel.has(plist.Label)) byLabel.set(plist.Label, []);
        byLabel.get(plist.Label).push(source);
      } catch (error) {
        reportErrors.push(inspectionError("tracked-plist", path, error));
      }
    }
  }
  for (const sources of byLabel.values()) sources.sort((left, right) => left.path.localeCompare(right.path));
  return byLabel;
}

function listInstalledPlists(launchAgentsDir, runCommand, reportErrors) {
  const byLabel = new Map();
  for (const path of discoverInstalledPlists(launchAgentsDir)) {
    try {
      const plist = readPlist(path, runCommand);
      if (!isManagedLabel(plist.Label)) continue;
      byLabel.set(plist.Label, { path, sha256: sha256File(path), plist });
    } catch (error) {
      const label = basename(path, ".plist");
      if (isManagedLabel(label)) byLabel.set(label, { path, sha256: null, plist: null, error: inspectionError("deployed-plist", path, error) });
      else reportErrors.push(inspectionError("deployed-plist", path, error));
    }
  }
  return byLabel;
}

function inspectLoadedJob(label, uid, runCommand) {
  const result = runCommand("launchctl", ["print", `gui/${uid}/${label}`]);
  if (result.ok) return { loaded: parseLaunchctlPrint(result.stdout), error: null };
  const detail = `${result.stdout}\n${result.stderr}`;
  if (/Could not find (?:specified )?service|service not found/i.test(detail) || result.status === 113) {
    return { loaded: null, error: null };
  }
  return { loaded: null, error: inspectionError("launchctl-print", label, detail.trim() || `exit ${result.status}`) };
}

function expandTargetPath(path, home) {
  if (!path) return null;
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  if (path.startsWith("$HOME/")) return join(home, path.slice(6));
  return isAbsolute(path) ? path : resolve(path);
}

function readTargetSource(target) {
  if (!target?.exists) return "";
  try {
    return statSync(target.path).isFile() ? readFileSync(target.path, "utf8") : "";
  } catch {
    return "";
  }
}

function deploymentFromLoaded(loaded, installed, runCommand, entryErrors) {
  const path = loaded?.plistPath && existsSync(loaded.plistPath) ? loaded.plistPath : installed?.path;
  if (!path) return installed ?? null;
  if (installed?.path === path && installed.plist) return installed;
  try {
    return { path, sha256: sha256File(path), plist: readPlist(path, runCommand) };
  } catch (error) {
    entryErrors.push(inspectionError("loaded-plist", path, error));
    return { path, sha256: null, plist: null };
  }
}

function buildHookEntries(sourceRoot, hooksDir, runCommand, reportErrors) {
  const listing = runCommand("git", ["-C", sourceRoot, "ls-files", "-z", "hooks/*.py"]);
  const commit = runCommand("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (!listing.ok || !commit.ok) {
    reportErrors.push(inspectionError("git-hook-inventory", sourceRoot, listing.stderr || commit.stderr));
    return [];
  }
  const entries = [];
  for (const repoRelative of listing.stdout.split("\0").filter(Boolean).sort()) {
    const sourcePath = join(sourceRoot, repoRelative);
    const trackedSource = {
      path: sourcePath,
      repoRoot: sourceRoot,
      commit: commit.stdout.trim(),
      sha256: sha256File(sourcePath),
    };
    const deployedPath = join(hooksDir, basename(sourcePath));
    if (!existsSync(deployedPath) && !isDanglingSymlink(deployedPath)) {
      entries.push(buildHookEntry({ name: basename(sourcePath), trackedSource }));
      continue;
    }
    const errors = [];
    try {
      const stat = lstatSync(deployedPath);
      const linkMode = stat.isSymbolicLink() ? "symlink" : "copy";
      const rawTarget = stat.isSymbolicLink() ? readlinkSync(deployedPath) : null;
      const linkTarget = rawTarget ? resolve(dirname(deployedPath), rawTarget) : null;
      const deployed = { path: deployedPath, sha256: sha256File(deployedPath) };
      entries.push(buildHookEntry({ name: basename(sourcePath), trackedSource, deployed, linkMode, linkTarget, inspectionErrors: errors }));
    } catch (error) {
      errors.push(inspectionError("deployed-hook", deployedPath, error));
      entries.push(buildHookEntry({ name: basename(sourcePath), trackedSource, inspectionErrors: errors }));
    }
  }
  return entries;
}

function isDanglingSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function auditDeployDrift(options = {}, dependencies = {}) {
  const runCommand = dependencies.runCommand ?? execute;
  const home = resolve(options.home ?? homedir());
  const sourceRoot = canonicalExistingPath(options.sourceRoot ?? defaultSourceRoot);
  const gitsRoot = resolve(options.gitsRoot ?? join(home, "Gits"));
  const launchAgentsDir = resolve(options.launchAgentsDir ?? join(home, "Library", "LaunchAgents"));
  const hooksDir = resolve(options.hooksDir ?? join(home, ".claude", "hooks"));
  const uid = dependencies.uid ?? process.getuid?.() ?? 501;
  const reportErrors = [];
  const repositories = discoverGitRepositories({ gitsRoot, sourceRoot, runCommand });
  const trackedByLabel = listTrackedSources(repositories, runCommand, reportErrors);
  const installedByLabel = listInstalledPlists(launchAgentsDir, runCommand, reportErrors);
  const labels = new Set([...trackedByLabel.keys(), ...installedByLabel.keys(), ...RETIRED_LABELS]);
  const checkoutCache = new Map();
  const entries = [];

  for (const label of [...labels].sort()) {
    const entryErrors = [];
    const retired = RETIRED_LABELS.includes(label);
    const sources = trackedByLabel.get(label) ?? [];
    const installed = installedByLabel.get(label) ?? null;
    if (installed?.error) entryErrors.push(installed.error);
    const loadedInspection = inspectLoadedJob(label, uid, runCommand);
    if (loadedInspection.error) entryErrors.push(loadedInspection.error);
    const deployedInternal = deploymentFromLoaded(loadedInspection.loaded, installed, runCommand, entryErrors);
    const chosenPlist = deployedInternal?.plist ?? sources[0]?.plist ?? null;
    const targetPath = expandTargetPath(selectManagedTarget(chosenPlist), home);
    const target = targetPath ? inspectTarget(targetPath, repositories, runCommand) : null;
    let checkout = null;
    if (target?.repoRoot && (deployedInternal || loadedInspection.loaded?.isLoaded)) {
      if (!checkoutCache.has(target.repoRoot)) {
        try {
          checkoutCache.set(target.repoRoot, inspectCheckout(target.repoRoot, runCommand));
        } catch (error) {
          checkoutCache.set(target.repoRoot, null);
          entryErrors.push(inspectionError("git-checkout", target.repoRoot, error));
        }
      }
      checkout = checkoutCache.get(target.repoRoot);
    }
    const envContract = chosenPlist ? findUnusedEnvironmentKeys(chosenPlist, readTargetSource(target)) : null;
    const deployed = deployedInternal ? { path: deployedInternal.path, sha256: deployedInternal.sha256 } : null;
    const plistMatch = sources.length > 0 && deployedInternal?.plist ? plistsMatch(sources[0].plist, deployedInternal.plist) : null;
    entries.push(buildLaunchdEntry({
      label,
      trackedSources: sources.map(publicSource),
      deployed,
      plistMatch,
      target,
      loaded: loadedInspection.loaded,
      checkout,
      envContract,
      retired,
      inspectionErrors: entryErrors,
    }));
  }

  entries.push(...buildHookEntries(sourceRoot, hooksDir, runCommand, reportErrors));
  entries.sort((left, right) => left.id.localeCompare(right.id));
  const sourceCommit = runCommand("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (!sourceCommit.ok) reportErrors.push(inspectionError("git-source-commit", sourceRoot, sourceCommit.stderr));
  return buildReport({
    source: { repoRoot: sourceRoot, commit: sourceCommit.ok ? sourceCommit.stdout.trim() : null },
    entries,
    inspectionErrors: reportErrors,
  });
}

function helpText() {
  return `Usage: node scripts/deploy-drift-check.mjs [options]\n\n` +
    `Read-only audit of golems launchd jobs and managed Claude hooks.\n\n` +
    `Options:\n` +
    `  --json                 emit only the versioned JSON report\n` +
    `  --home PATH            override the inspected home directory\n` +
    `  --gits-root PATH       override the ecosystem repository root\n` +
    `  --source-root PATH     override the checker source checkout\n` +
    `  --launch-agents PATH   override the installed plist directory\n` +
    `  --hooks-dir PATH       override the deployed hook directory\n` +
    `  -h, --help             show this help\n`;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(helpText());
    return 0;
  }
  const report = auditDeployDrift(options);
  process.stdout.write(options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : formatHumanReport(report));
  return reportExitCode(report);
}

if (process.argv[1] && canonicalExistingPath(process.argv[1]) === canonicalExistingPath(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
