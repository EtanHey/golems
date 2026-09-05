#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRetireEligible,
  buildGitInventoryCommand,
  buildManifestCommand,
  buildRetireCommands,
  buildSkillPushCommands,
  buildStandaloneSkillInstallCommands,
  buildStandaloneSkillVerifyCommand,
  compareManifests,
  compareGitInventory,
  needsStandaloneRecheck,
  parseArgs,
  parseManifestOutput,
  shellQuote,
  summarizeDrift,
  validateProfile,
} from "./reconcile-to-mac-lib.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function execute(program, args, options = {}) {
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

function runRemote(sshHost, command) {
  return execute("ssh", [sshHost, command]);
}

function buildCommittedManifest(sourceRef, skillPath, keyFiles) {
  const listing = execute("git", ["ls-tree", "-r", "--name-only", sourceRef, "--", skillPath]);
  if (!listing.ok) throw new Error(`cannot list ${sourceRef}:${skillPath}: ${listing.stderr.trim()}`);

  const files = {};
  for (const fullPath of listing.stdout.split("\n").filter(Boolean).sort()) {
    const relativePath = fullPath.slice(skillPath.length + 1);
    if (!keyFiles.includes(relativePath)) {
      files[relativePath] = null;
      continue;
    }
    const content = execute("git", ["show", `${sourceRef}:${fullPath}`]);
    if (!content.ok) throw new Error(`cannot read ${sourceRef}:${fullPath}: ${content.stderr.trim()}`);
    files[relativePath] = createHash("sha256").update(content.stdout).digest("hex");
  }
  return { files };
}

function resolveSourceCommit(sourceRef) {
  const result = execute("git", ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
  if (!result.ok) throw new Error(`cannot resolve ${sourceRef}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function listStandaloneSkillNames(sourceRef, standalone) {
  if (standalone.include) return [...standalone.include].sort();
  const listing = execute("git", ["ls-tree", "-r", "--name-only", sourceRef, "--", standalone.sourceRoot]);
  if (!listing.ok) throw new Error(`cannot list standalone skills at ${sourceRef}:${standalone.sourceRoot}: ${listing.stderr.trim()}`);
  const prefix = `${standalone.sourceRoot}/`;
  return listing.stdout.split("\n")
    .filter((path) => path.startsWith(prefix) && path.endsWith("/SKILL.md"))
    .map((path) => path.slice(prefix.length, -"/SKILL.md".length))
    .filter((name) => name && !name.includes("/"))
    .sort();
}

function staleCheckoutLinksCommand(standalone, moveStale) {
  const pieces = [
    "set -euo pipefail",
    `link_root="${standalone.linkRoot}"`,
    `checkout_root="${standalone.legacyCheckoutRoot}"`,
  ];
  if (moveStale) {
    pieces.push(
      "ts=$(date +%Y%m%d-%H%M%S)",
      'backup="$HOME/.claude/skills-retired-$ts"',
      'mkdir -p "$backup"',
      'for link in "$link_root"/*; do [ -L "$link" ] || continue; target=$(readlink "$link"); case "$target" in "$checkout_root"/*) printf "STALE SKILL LINK BACKUP: %s -> %s\\n" "$link" "$backup/$(basename "$link")"; mv "$link" "$backup/";; esac; done',
    );
  } else {
    pieces.push(
      'for link in "$link_root"/*; do [ -L "$link" ] || continue; target=$(readlink "$link"); case "$target" in "$checkout_root"/*) printf "checkout-backed skill link remains: %s -> %s\\n" "$link" "$target" >&2; exit 1;; esac; done',
    );
  }
  return pieces.join("; ");
}

function plannedStandaloneSkill(target, sourceRef, sourceCommit, standalone, skillName) {
  const skillPath = `${standalone.sourceRoot}/${skillName}`;
  const commands = buildStandaloneSkillInstallCommands({
    sourceRef,
    target: target.sshHost,
    installRoot: standalone.installRoot,
    linkRoot: standalone.linkRoot,
    skillPath,
  });
  const verify = buildStandaloneSkillVerifyCommand({
    installRoot: standalone.installRoot,
    linkRoot: standalone.linkRoot,
    skillName,
    sourceCommit,
  });
  return {
    name: skillName,
    path: skillPath,
    status: "planned",
    commands: {
      ...commands,
      verify: `ssh ${target.sshHost} ${shellQuote(verify)}`,
    },
    verifyRemote: verify,
  };
}

function auditStandaloneSkill(target, sourceRef, sourceCommit, standalone, skillName) {
  const plan = plannedStandaloneSkill(target, sourceRef, sourceCommit, standalone, skillName);
  const verified = runRemote(target.sshHost, plan.verifyRemote);
  const { verifyRemote, ...receipt } = plan;
  return {
    ...receipt,
    status: verified.ok ? "ok" : "drift",
    detail: verified.ok ? undefined : (verified.stdout || verified.stderr).trim(),
  };
}

function reconcileStandaloneSkill(target, sourceRef, sourceCommit, standalone, skillName, fix) {
  let result = auditStandaloneSkill(target, sourceRef, sourceCommit, standalone, skillName);
  if (result.status !== "drift" || !fix) return result;
  const commands = buildStandaloneSkillInstallCommands({
    sourceRef: sourceCommit,
    target: target.sshHost,
    installRoot: standalone.installRoot,
    linkRoot: standalone.linkRoot,
    skillPath: `${standalone.sourceRoot}/${skillName}`,
  });
  const pushed = execute("sh", ["-c", commands.pipeline]);
  if (!pushed.ok) return { ...result, status: "failed", error: (pushed.stderr || pushed.stdout).trim() };
  const verified = auditStandaloneSkill(target, sourceRef, sourceCommit, standalone, skillName);
  return { ...verified, status: verified.status === "ok" ? "synced" : "failed" };
}

function plannedStandalonePhase(target, sourceRef, sourceCommit) {
  const standalone = target.standaloneSkills;
  if (!standalone) return null;
  const names = listStandaloneSkillNames(sourceRef, standalone);
  return {
    id: standalone.id,
    status: "planned",
    sourceCommit,
    skills: names.map((name) => {
      const { verifyRemote, ...plan } = plannedStandaloneSkill(target, sourceRef, sourceCommit, standalone, name);
      return plan;
    }),
    commands: {
      staleLinkCleanup: `ssh ${target.sshHost} ${shellQuote(staleCheckoutLinksCommand(standalone, true))}`,
      noCheckoutLinks: `ssh ${target.sshHost} ${shellQuote(staleCheckoutLinksCommand(standalone, false))}`,
      verify: standalone.verifyCommands.map((command) => `ssh ${target.sshHost} ${shellQuote(command)}`),
    },
  };
}

function reconcileStandalonePhase(target, sourceRef, sourceCommit, fix) {
  const standalone = target.standaloneSkills;
  if (!standalone) return null;
  const names = listStandaloneSkillNames(sourceRef, standalone);
  const skills = names.map((name) => reconcileStandaloneSkill(target, sourceRef, sourceCommit, standalone, name, fix));
  const healthySkill = (skill) => ["ok", "synced"].includes(skill.status);
  let cleanup = { ok: true, stdout: "", stderr: "" };
  if (fix && skills.every(healthySkill)) cleanup = runRemote(target.sshHost, staleCheckoutLinksCommand(standalone, true));
  else if (fix) cleanup = { ok: false, stdout: "", stderr: "stale-link cleanup withheld because a canonical skill install failed" };
  const noCheckoutLinks = runRemote(target.sshHost, staleCheckoutLinksCommand(standalone, false));
  const verifies = standalone.verifyCommands.map((command) => runRemote(target.sshHost, command));
  const green = skills.every(healthySkill) && cleanup.ok && noCheckoutLinks.ok && verifies.every((result) => result.ok);
  return {
    id: standalone.id,
    status: green ? "green" : "drift",
    sourceCommit,
    skills,
    cleanup: { status: cleanup.ok ? "ok" : "failed", detail: (cleanup.stdout || cleanup.stderr).trim() },
    noCheckoutLinks: { status: noCheckoutLinks.ok ? "ok" : "drift", detail: (noCheckoutLinks.stdout || noCheckoutLinks.stderr).trim() },
    verify: verifies.map((result, index) => ({
      command: standalone.verifyCommands[index],
      status: result.ok ? "ok" : "drift",
      detail: (result.stdout || result.stderr).trim(),
    })),
  };
}

function plannedManagedPhase(target, phase) {
  if (!phase) return null;
  return {
    id: phase.id,
    status: "planned",
    commands: {
      check: `ssh ${target.sshHost} ${shellQuote(phase.checkCommand)}`,
      fix: `ssh ${target.sshHost} ${shellQuote(phase.fixCommand)}`,
      verify: `ssh ${target.sshHost} ${shellQuote(phase.verifyCommand)}`,
    },
  };
}

function reconcileManagedPhase(target, phase, fix) {
  if (!phase) return null;
  const checked = runRemote(target.sshHost, phase.checkCommand);
  if (checked.ok) return { id: phase.id, status: "green", detail: checked.stdout.trim() };
  if (!fix) return { id: phase.id, status: "drift", detail: (checked.stdout || checked.stderr).trim() };
  const changed = runRemote(target.sshHost, phase.fixCommand);
  if (!changed.ok) return { id: phase.id, status: "failed", detail: (changed.stdout || changed.stderr).trim() };
  const verified = runRemote(target.sshHost, phase.verifyCommand);
  return {
    id: phase.id,
    status: verified.ok ? "green" : "failed",
    changed: true,
    detail: (verified.stdout || verified.stderr).trim(),
  };
}

function plannedSkill(target, sourceRef, skill) {
  const skillName = skill.path.split("/").at(-1);
  const directory = `${target.repoPath}/${skill.path}`;
  const installed = `${target.installRoot}/${skillName}`;
  const commands = buildSkillPushCommands({
    sourceRef,
    target: target.sshHost,
    targetRepo: target.repoPath,
    installRoot: target.installRoot,
    skillPath: skill.path,
  });
  return {
    name: skillName,
    path: skill.path,
    status: "planned",
    commands: {
      ...commands,
      committedManifest: `git ls-tree -r --name-only ${sourceRef} -- ${skill.path}`,
      installedManifest: `ssh ${target.sshHost} ${shellQuote(buildManifestCommand(directory))}`,
      symlink: `ssh ${target.sshHost} ${shellQuote(`test -L \"${installed}\" && test \"$(readlink \"${installed}\")\" = \"${directory}\"`)}`,
    },
  };
}

function auditSkill(target, sourceRef, skill) {
  const plan = plannedSkill(target, sourceRef, skill);
  const committed = buildCommittedManifest(sourceRef, skill.path, skill.keyFiles);
  const directory = `${target.repoPath}/${skill.path}`;
  const installed = `${target.installRoot}/${plan.name}`;
  const remoteManifest = runRemote(target.sshHost, buildManifestCommand(directory));
  const installedManifest = remoteManifest.ok ? parseManifestOutput(remoteManifest.stdout) : { files: {} };
  const content = compareManifests(committed, installedManifest);
  const symlinkCommand = `test -L "${installed}" && test "$(readlink "${installed}")" = "${directory}"`;
  const symlink = runRemote(target.sshHost, symlinkCommand);
  return {
    ...plan,
    status: content.drifted || !symlink.ok ? "drift" : "skipped",
    drift: {
      ...content,
      symlinkDrifted: !symlink.ok,
      detail: remoteManifest.ok ? undefined : (remoteManifest.stderr || remoteManifest.stdout).trim(),
    },
  };
}

function reconcileSkill(target, sourceRef, skill, fix) {
  let result = auditSkill(target, sourceRef, skill);
  if (result.status !== "drift" || !fix) return result;

  const pushed = execute("sh", ["-c", result.commands.pipeline]);
  if (!pushed.ok) {
    return { ...result, status: "failed", error: (pushed.stderr || pushed.stdout).trim() };
  }
  const verified = auditSkill(target, sourceRef, skill);
  return {
    ...verified,
    status: verified.status === "skipped" ? "synced" : "failed",
    fixed: verified.status === "skipped",
    detectedDrift: result.drift,
  };
}

function reconcileHostChecker(target, checker, fix) {
  const checked = runRemote(target.sshHost, checker.checkCommand);
  if (checked.ok) {
    return { id: checker.id, status: "ok", check: checked.stdout.trim() };
  }
  if (!fix) {
    return {
      id: checker.id,
      status: "drift",
      detail: (checked.stdout || checked.stderr).trim(),
      installHint: checker.installHint,
    };
  }

  const provisioned = runRemote(target.sshHost, checker.provisionCommand);
  if (!provisioned.ok) {
    return {
      id: checker.id,
      status: "failed",
      detail: (provisioned.stdout || provisioned.stderr).trim(),
      installHint: checker.installHint,
    };
  }
  const verified = runRemote(target.sshHost, checker.verifyCommand ?? checker.checkCommand);
  return {
    id: checker.id,
    status: verified.ok ? "provisioned" : "failed",
    detectedDetail: (checked.stdout || checked.stderr).trim(),
    detail: (verified.stdout || verified.stderr).trim(),
    installHint: verified.ok ? undefined : checker.installHint,
  };
}

function checkRuntime(target, runtime) {
  const checked = runRemote(target.sshHost, runtime.checkCommand);
  return {
    id: runtime.id,
    status: checked.ok ? "ok" : "drift",
    detail: (checked.stdout || checked.stderr).trim(),
    installHint: checked.ok ? undefined : runtime.installHint,
  };
}

function plannedRetire(target, component) {
  const commands = buildRetireCommands({
    target: target.sshHost,
    gitRoot: target.retireGitRoot,
    backupRoot: target.retireBackupRoot,
    component: component.name,
    replacement: component.replacement,
  });
  return {
    name: component.name,
    status: "guarded",
    requiresGreen: component.requiresGreen,
    command: commands.command,
  };
}

function plannedGitInventory(target) {
  const inventory = target.gitInventory;
  if (!inventory) return null;
  return {
    id: inventory.id,
    status: "planned",
    allow: inventory.allow,
    required: inventory.required,
    command: `ssh ${target.sshHost} ${shellQuote(buildGitInventoryCommand(inventory.root))}`,
  };
}

function checkGitInventory(target) {
  const inventory = target.gitInventory;
  if (!inventory) return null;
  const checked = runRemote(target.sshHost, buildGitInventoryCommand(inventory.root));
  if (!checked.ok) {
    return { id: inventory.id, status: "failed", allow: inventory.allow, required: inventory.required, detail: (checked.stdout || checked.stderr).trim() };
  }
  const actual = checked.stdout.split("\n").filter(Boolean);
  const comparison = compareGitInventory(actual, inventory.allow, inventory.required);
  return {
    id: inventory.id,
    status: comparison.clean ? "green" : "drift",
    allow: inventory.allow,
    required: inventory.required,
    actual,
    ...comparison,
  };
}

function reconcileRetire(target, component, phaseStatuses, fix) {
  try {
    assertRetireEligible(component, phaseStatuses);
  } catch (error) {
    return {
      name: component.name,
      status: "blocked",
      requiresGreen: component.requiresGreen,
      detail: error.message,
    };
  }
  if (!fix) return { ...plannedRetire(target, component), status: "eligible" };

  const commands = buildRetireCommands({
    target: target.sshHost,
    gitRoot: target.retireGitRoot,
    backupRoot: target.retireBackupRoot,
    component: component.name,
    replacement: component.replacement,
  });
  const retired = runRemote(target.sshHost, commands.remote);
  return {
    name: component.name,
    status: retired.ok ? "retired" : "failed",
    requiresGreen: component.requiresGreen,
    detail: (retired.stdout || retired.stderr).trim(),
  };
}

function dryRunReceipt(targetName, target, sourceRef, sourceCommit) {
  return {
    mode: "dry-run",
    target: targetName,
    sshHost: target.sshHost,
    sourceRef,
    keepList: target.keepList,
    skills: target.skills.map((skill) => plannedSkill(target, sourceRef, skill)),
    skillsInstall: plannedStandalonePhase(target, sourceRef, sourceCommit),
    ralphtools: plannedManagedPhase(target, target.ralphtools),
    rewires: (target.rewires ?? []).map((phase) => plannedManagedPhase(target, phase)),
    hostEnv: target.hostEnvCheckers.map((checker) => ({
      id: checker.id,
      status: "planned",
      commands: {
        check: `ssh ${target.sshHost} ${shellQuote(checker.checkCommand)}`,
        provision: `ssh ${target.sshHost} ${shellQuote(checker.provisionCommand)}`,
        verify: `ssh ${target.sshHost} ${shellQuote(checker.verifyCommand ?? checker.checkCommand)}`,
      },
      installHint: checker.installHint,
    })),
    runtime: target.runtimeChecks.map((runtime) => ({
      id: runtime.id,
      status: "planned",
      command: `ssh ${target.sshHost} ${shellQuote(runtime.checkCommand)}`,
      installHint: runtime.installHint,
    })),
    retire: (target.retire ?? []).map((component) => plannedRetire(target, component)),
    gitInventory: plannedGitInventory(target),
    drift: { status: "not-executed", found: null, fixed: false },
  };
}

function applyReceipt(targetName, target, sourceRef, sourceCommit, fix) {
  const skills = target.skills.map((skill) => reconcileSkill(target, sourceRef, skill, fix));
  let skillsInstall = reconcileStandalonePhase(target, sourceRef, sourceCommit, fix);
  const ralphtools = reconcileManagedPhase(target, target.ralphtools, fix);
  const rewires = (target.rewires ?? []).map((phase) => reconcileManagedPhase(target, phase, fix));
  const hostEnv = target.hostEnvCheckers.map((checker) => reconcileHostChecker(target, checker, fix));
  const runtime = target.runtimeChecks.map((check) => checkRuntime(target, check));
  if (needsStandaloneRecheck({ fix, status: skillsInstall?.status })) {
    skillsInstall = reconcileStandalonePhase(target, sourceRef, sourceCommit, false);
  }
  const phaseStatuses = Object.fromEntries([
    skillsInstall && [skillsInstall.id, skillsInstall.status],
    ralphtools && [ralphtools.id, ralphtools.status],
    ...rewires.map((phase) => [phase.id, phase.status]),
    ...hostEnv.map((phase) => [phase.id, ["ok", "provisioned"].includes(phase.status) ? "green" : phase.status]),
    ...runtime.map((phase) => [phase.id, phase.status === "ok" ? "green" : phase.status]),
  ].filter(Boolean));
  const retire = (target.retire ?? []).map((component) => reconcileRetire(target, component, phaseStatuses, fix));
  const gitInventory = checkGitInventory(target);
  const phases = [skillsInstall, ralphtools, ...rewires, ...retire, gitInventory]
    .filter(Boolean)
    .map((phase) => ({ id: phase.id ?? phase.name, status: phase.status }));
  const drift = summarizeDrift({ skills, hostEnv, runtime, phases, fix });

  return {
    mode: fix ? "apply-fix" : "apply-lint",
    target: targetName,
    sshHost: target.sshHost,
    sourceRef,
    keepList: target.keepList,
    skills,
    skillsInstall,
    ralphtools,
    rewires,
    hostEnv,
    runtime,
    retire,
    gitInventory,
    drift,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const profilePath = resolve(options.profile ?? join(scriptDir, "reconcile-profile.json"));
  const profile = validateProfile(JSON.parse(readFileSync(profilePath, "utf8")));
  const targetName = options.target ?? profile.defaults.target;
  const target = profile.targets[targetName];
  if (!target) throw new Error(`unknown target profile: ${targetName}`);
  const sourceRef = profile.defaults.sourceRef;
  const sourceCommit = resolveSourceCommit(sourceRef);
  const receipt = options.apply
    ? applyReceipt(targetName, target, sourceRef, sourceCommit, options.fix)
    : dryRunReceipt(targetName, target, sourceRef, sourceCommit);
  console.log(JSON.stringify(receipt, null, 2));
  if (options.apply && receipt.drift.status !== "clean") process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
}
