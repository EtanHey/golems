#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const canonicalPath = (candidate) => { try { return realpathSync(candidate); } catch { return resolve(candidate); } };
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const maxClockSkewMs = 5 * 60_000;
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
  const options = { repo: null, manifest: resolve(scriptRoot, "release-gate.json"), json: false, releaseOnly: false, callback: false, sha: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--callback") options.callback = true;
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
  if (options.callback && !options.releaseOnly) throw new Error("--callback requires --release-only");
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

function latestTag(repo, remoteRef, pattern, runCommand, kind) {
  // Same-day SHA suffixes do not sort chronologically. Release pushes tag the
  // first-parent master history, so select its nearest matching release tag.
  const output = kind === 'github-release'
    ? checked('git', ['-C', repo, 'log', '--first-parent', '--decorate=short', '--format=%D', remoteRef], { runCommand }).split(/\r?\n/).flatMap(line => [...line.matchAll(/(?:^|, )tag: ([^,]+)/g)].map(match => match[1])).join('\n')
    : checked("git", ["-C", repo, "for-each-ref", `--merged=${remoteRef}`, "--sort=-version:refname", "--format=%(refname:short)", "refs/tags"], { runCommand });
  const matcher = new RegExp(pattern || defaultTagPattern);
  const tag = output.split(/\r?\n/).find((candidate) => matcher.test(candidate));
  if (!tag) throw new Error(`no release tag matching ${matcher}`);
  return tag;
}

function commitCounts(repo, tag, remoteRef, ignorePaths, runCommand, includeAge = false) {
  const shas = checked("git", ["-C", repo, "rev-list", "--reverse", `${tag}..${remoteRef}`], { runCommand }).split(/\s+/).filter(Boolean);
  const raw = Number.parseInt(checked("git", ["-C", repo, "rev-list", "--count", `${tag}..${remoteRef}`], { runCommand }), 10);
  const ignoredBy = ignorePaths.map((pattern) => globRegex(pattern));
  const shippable = shas.filter((sha) => {
    const paths = checked("git", ["-C", repo, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-m", sha], { runCommand });
    return [...new Set(paths.split(/\r?\n/).filter(Boolean))].some((path) => !ignoredBy.some((matcher) => matcher.test(path)));
  });
  const counts = { raw, shippable: shippable.length };
  if (includeAge && shippable.length) {
    // Integration time on the default branch, not the age of a topic commit.
    const integrations = checked("git", ["-C", repo, "log", "--first-parent", "--reverse", "--format=%H:%ct", `${tag}..${remoteRef}`], { runCommand });
    const oldest = integrations.split(/\r?\n/).map(line => line.split(":"))
      .find(([sha]) => shippable.includes(sha));
    const timestamp = Number(oldest?.[1]) * 1000;
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + maxClockSkewMs) throw new Error("cannot determine oldest unreleased integration time");
    counts.oldestShippableAt = new Date(timestamp).toISOString();
  }
  return counts;
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
  if (artifact.kind === "github-release") {
    try {
      const installed = JSON.parse(readFileSync(artifact.releaseJson ?? artifact.installedJson ?? resolve(homedir(), '.golems/release.json'), 'utf8'));
      return typeof installed.version === 'string' && /^\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7}$/.test(installed.version) ? installed.version : null;
    } catch { return null; }
  } else if (artifact.kind === "macos-app") {
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

// The owner installer records this pin; a hostname alone never selects this path.
// A receipt and owner marker together are ambiguous, including explicit receipt paths.
function detectInstallation(options, config, repository, runCommand) {
  const artifact = config.artifact;
  if (artifact.kind !== "github-release") {
    return { installedVersion: detectInstalledVersion(artifact, runCommand) };
  }
  const home = options.home ?? homedir();
  const receipt = artifact.releaseJson ?? artifact.installedJson ?? resolve(home, ".golems/release.json");
  const client = {
    installedVersion: detectInstalledVersion({ ...artifact, releaseJson: receipt }, runCommand),
    installationDetection: "release-json",
  };
  if (repository !== "EtanHey/golems") {
    return client;
  }
  let receiptPresent = true;
  try {
    lstatSync(receipt);
  } catch (error) {
    if (error.code === "ENOENT") {
      receiptPresent = false;
    }
  }
  const ownerMarker = resolve(home, ".claude/hooks/golems-hooks-live.sha");
  let markerPresent = false;
  try {
    lstatSync(ownerMarker);
    markerPresent = true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      return { ...client, installationDetection: "owner-checkout", installationError: error.message };
    }
  }
  if (receiptPresent && markerPresent) {
    const reason = "ambiguous installation: both client release.json and owner golems-hooks-live.sha are present";
    return { installedVersion: null, installationDetection: "ambiguous", installationError: reason, reason };
  }
  if (artifact.releaseJson || artifact.installedJson || receiptPresent || !markerPresent) {
    return client;
  }
  let pin;
  try {
    pin = readFileSync(ownerMarker, "utf8").trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      return client;
    }
    return { ...client, installationDetection: "owner-checkout", installationError: error.message };
  }
  const owner = { installedVersion: null, installationDetection: "owner-checkout" };
  try {
    if (!/^[0-9a-f]{40}$/.test(pin)) {
      throw new Error("invalid owner hooks-live pin");
    }
    const repo = realpathSync(options.repo);
    const hooks = realpathSync(resolve(repo, ".worktrees/hooks-live"));
    const git = (at, ...args) => checked("git", ["-C", at, ...args], { runCommand });
    for (const at of [repo, hooks]) {
      if (realpathSync(git(at, "rev-parse", "--show-toplevel")) !== at) {
        throw new Error("owner source is not a worktree root");
      }
      if (git(at, "rev-parse", "--is-shallow-repository") !== "false") {
        throw new Error("owner source is shallow");
      }
    }
    if (realpathSync(git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")) !==
        realpathSync(git(hooks, "rev-parse", "--path-format=absolute", "--git-common-dir"))) {
      throw new Error("owner sources do not share a repository");
    }
    const skillsHead = git(repo, "rev-parse", "HEAD");
    const hooksHead = git(hooks, "rev-parse", "HEAD");
    owner.installedCommits = { skills: skillsHead, hooks: hooksHead };
    if (hooksHead !== pin) {
      throw new Error("hooks-live HEAD differs from the recorded owner pin");
    }
    const catalog = JSON.parse(readFileSync(resolve(repo, "skills/catalog.json"), "utf8"));
    for (const [key, directory] of [["claude", ".claude/skills"], ["agents", ".agents/skills"]]) {
      const names = catalog.roots?.[key];
      if (!Array.isArray(names) || !names.length) {
        throw new Error(`owner ${key} skill catalog is missing`);
      }
      for (const name of names) {
        const link = resolve(home, directory, name);
        const target = realpathSync(resolve(repo, "skills/golem-powers", name));
        if (!lstatSync(link).isSymbolicLink() || realpathSync(link) !== target) {
          throw new Error(`owner ${key} skill link differs: ${name}`);
        }
      }
    }
    const common = git(repo, "merge-base", skillsHead, hooksHead);
    const tags = git(repo, "log", "--first-parent", "--decorate=short", "--format=%D", common);
    const matcher = new RegExp(config.tagPattern ?? defaultTagPattern);
    const installedTag = [...tags.matchAll(/(?:^|, |\n)tag: ([^,\n]+)/g)].map(match => match[1]).find(tag => matcher.test(tag));
    // A pre-release-channel checkout is still a known installation, but has no installed release tag.
    owner.installedVersion = installedTag ? cleanVersion(installedTag) : `checkout:${skillsHead}+hooks-live:${hooksHead}`;
    return owner;
  } catch (error) {
    return { ...owner, installationError: error.message };
  }
}

function containmentUnknown(report, reason) {
  return { ...report, verdict: "UNKNOWN", reason };
}

function publishedReleaseError(repository, tag, channel, runCommand) {
  const result = runCommand('gh', ['api', `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`]);
  if (result.status !== 0) return `GitHub Release unavailable for ${tag}: ${(result.stderr || result.stdout).trim()}`;
  try {
    const release = JSON.parse(result.stdout);
    const expected = [`golems-${cleanVersion(tag)}.tar.gz`, 'MANIFEST.json', 'SHA256SUMS'];
    if (release.draft || (release.prerelease && channel !== 'nightly') || expected.some(name => !release.assets?.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0))) return `GitHub Release ${tag} is unpublished or missing release assets`;
    return null;
  } catch { return `invalid GitHub Release response for ${tag}`; }
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
  const installation = detectInstallation(options, { ...config, tagPattern: config.tagPattern ?? manifest.tagPattern }, identity.slug, runCommand);
  Object.assign(report, installation);
  const { installedVersion } = installation;
  if (installation.installationError) return containmentUnknown(report, installation.installationError);
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
  if (config.artifact.kind === 'github-release') {
    const error = publishedReleaseError(identity.slug, report.tag, config.channel, runCommand);
    if (error) return containmentUnknown(report, error);
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
  const tag = latestTag(repo, remoteRef, config.tagPattern ?? manifest.tagPattern, runCommand, config.artifact.kind);
  const ignorePaths = config.ignorePaths ?? manifest.ignorePaths ?? defaultIgnores;
  const commits = commitCounts(repo, tag, remoteRef, ignorePaths, runCommand, options.callback);
  if (config.artifact.kind === 'github-release') {
    const error = publishedReleaseError(identity.slug, tag, config.channel, runCommand);
    if (error) return { verdict: 'UNKNOWN', repo, repository: identity.slug, latestTag: tag, artifact: config.artifact, error };
  }
  const installation = options.releaseOnly ? { installedVersion: null } : detectInstallation(options, { ...config, tagPattern: config.tagPattern ?? manifest.tagPattern }, identity.slug, runCommand);
  const { installedVersion } = installation;
  const installedComparison = options.releaseOnly || !installedVersion ? null : compareVersions(installedVersion, tag);
  let verdict = "CLEAN";
  if (installation.installationDetection === "ambiguous") verdict = "UNKNOWN";
  else if (commits.shippable > 0) verdict = "MERGED_UNRELEASED";
  else if (installation.installationError || (!options.releaseOnly && !installedVersion)) verdict = "UNKNOWN";
  else if (installation.installationDetection === "owner-checkout") {
    const tagCommit = checked("git", ["-C", repo, "rev-parse", "--verify", `refs/tags/${tag}^{commit}`], { runCommand });
    for (const [component, head] of Object.entries(installation.installedCommits)) {
      const ancestor = runCommand("git", ["-C", repo, "merge-base", "--is-ancestor", tagCommit, head]);
      if (ancestor.status !== 0 && ancestor.status !== 1) throw new Error("owner release ancestry could not be determined");
      if (ancestor.status === 1) {
        verdict = "RELEASED_UNINSTALLED";
        if (component === "hooks") {
          installation.reason = `hooks-live does not contain latest release ${tag}`;
          installation.remediation = "bash scripts/hooks/install-hooks.sh --host mbp --update --apply";
        }
      }
    }
  }
  else if (!options.releaseOnly && installedComparison === null) verdict = "UNKNOWN";
  else if (!options.releaseOnly && (installedComparison === -1 || (config.artifact.kind === 'github-release' && installedVersion !== cleanVersion(tag)))) verdict = "RELEASED_UNINSTALLED";
  return {
    verdict, repo, repository: identity.slug, defaultBranch: branch, remoteRef, latestTag: tag,
    releasedVersion: cleanVersion(tag), ...installation, installationCheck: options.releaseOnly ? "skipped" : "performed",
    artifact: config.artifact, commits, ignorePaths,
  };
}

export function formatHuman(report) {
  if (report.verdict === 'UNKNOWN' && report.error) return `RELEASE GATE: UNKNOWN\n${report.error}`;
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
      ...(report.installationDetection ? [`Installation detection: ${report.installationDetection}`] : []),
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
    ...(report.installationDetection ? [`Installation detection: ${report.installationDetection}`] : []),
    ...(report.installedCommits ? [`Installed commits: skills=${report.installedCommits.skills} hooks=${report.installedCommits.hooks}`] : []),
    ...(report.installationError ? [`Installation error: ${report.installationError}`] : []),
    ...(report.reason && !report.installationError ? [`Reason: ${report.reason}`] : []),
    ...(report.remediation ? [`Fix: ${report.remediation}`] : []),
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

// Callback grace is deliberately separate from the strict local batch gate.
export function callbackResult(report, now = Date.now()) {
  if (report.verdict !== "MERGED_UNRELEASED") return { code: releaseExitCode(report.verdict) };
  const age = now - Date.parse(report.commits?.oldestShippableAt);
  if (!Number.isFinite(age) || age < -maxClockSkewMs) throw new Error("invalid unreleased integration time");
  // Observed merge-to-release cadence is 1–7 minutes (d5d3a289: 6m49s);
  // transient failed-gate runs cleared about 2 minutes later. Two hours allows
  // queue delays without hiding a stalled backlog for a full daily cron cycle.
  const overdue = Math.max(0, age) >= 2 * 3600_000;
  return {
    code: overdue ? 1 : 0,
    annotation: overdue ? "error" : "warning",
    message: `MERGED_UNRELEASED: oldest shippable integration ${report.commits.oldestShippableAt}; grace period 2 hours; ${overdue ? "overdue, repair publication" : "publication pending"}`,
  };
}

function callbackOutput(report) {
  const result = callbackResult(report);
  if (result.message) console.error(`::${result.annotation}::${result.message}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Release gate: ${report.verdict}\n\n${result.message ?? report.error ?? "Release inspection completed."}\n`);
  }
  return result.code;
}

if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url))) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.callback && process.env.RELEASE_WORKFLOW_CONCLUSION &&
        !["success", "cancelled", "skipped"].includes(process.env.RELEASE_WORKFLOW_CONCLUSION)) {
      throw new Error(`release publisher concluded ${process.env.RELEASE_WORKFLOW_CONCLUSION}; inspect Golems release logs`);
    }
    const report = inspectRelease(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatHuman(report));
    process.exitCode = options.callback ? callbackOutput(report) : releaseExitCode(report.verdict);
  } catch (error) {
    const argv = process.argv.slice(2);
    const shaIndex = argv.indexOf("--sha");
    const requestedSha = shaIndex >= 0 ? argv[shaIndex + 1] : argv.find((argument) => argument.startsWith("--sha="))?.slice(6);
    options ??= { repo: process.cwd(), json: process.argv.includes("--json"), sha: requestedSha || null };
    const report = unknownReport(options, error);
    console.log(options.json ? JSON.stringify(report, null, 2) : `RELEASE GATE: UNKNOWN\n${report.error}`);
    if (options.callback) callbackOutput(report);
    process.exitCode = 2;
  }
}
