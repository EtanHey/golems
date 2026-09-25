const PRIVATE_ASSET_PATTERN = /(?:\btheo\b|\bben\b|\bhuberman\b|voice[-_ ]?clone|voices\/)/i;
const SAFE_SKILL_PATH = /^skills\/golem-powers\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_REMOTE_PATH = /^\$HOME(?:\/[A-Za-z0-9._-]+)+$/;
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;
const SAFE_SSH_HOST = /^[A-Za-z0-9._@-]+$/;
const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_SOURCE_ROOT = /^skills\/golem-powers$/;
const SAFE_COMMIT = /^[0-9a-f]{40}$/;

function isSafeRemotePath(value) {
  if (!SAFE_REMOTE_PATH.test(value)) return false;
  return value.slice("$HOME/".length).split("/").every((segment) => segment !== "." && segment !== "..");
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function compareManifests(committed, installed) {
  const committedFiles = committed?.files ?? {};
  const installedFiles = installed?.files ?? {};
  const missing = Object.keys(committedFiles).filter((path) => !(path in installedFiles)).sort();
  const extra = Object.keys(installedFiles).filter((path) => !(path in committedFiles)).sort();
  const changed = Object.keys(committedFiles)
    .filter((path) => committedFiles[path] !== null && path in installedFiles && committedFiles[path] !== installedFiles[path])
    .sort();

  return {
    drifted: missing.length + extra.length + changed.length > 0,
    missing,
    extra,
    changed,
  };
}

export function compareGitInventory(actual, allowed, required = allowed) {
  if (!Array.isArray(actual) || !Array.isArray(allowed) || !Array.isArray(required)
    || [...actual, ...allowed, ...required].some((name) => !SAFE_COMPONENT.test(name))
    || required.some((name) => !allowed.includes(name))) {
    throw new Error("git inventory names must be safe components");
  }
  const actualSet = new Set(actual);
  const allowedSet = new Set(allowed);
  const requiredSet = new Set(required);
  const extra = [...actualSet].filter((name) => !allowedSet.has(name)).sort();
  const missing = [...requiredSet].filter((name) => !actualSet.has(name)).sort();
  return { clean: extra.length === 0 && missing.length === 0, extra, missing };
}

export function buildGitInventoryCommand(root) {
  if (!isSafeRemotePath(root)) throw new Error("git inventory root must be a canonical $HOME-relative path");
  return [
    "set -euo pipefail",
    `test -d "${root}"`,
    `find "${root}" -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; | sort`,
  ].join("; ");
}

export function buildSkillPushCommands({ sourceRef, target, targetRepo, installRoot, skillPath }) {
  if (!SAFE_REF.test(sourceRef) || !SAFE_SSH_HOST.test(target) || !SAFE_SKILL_PATH.test(skillPath)) {
    throw new Error("unsafe source ref, SSH host, or skill path");
  }
  if (!isSafeRemotePath(targetRepo) || !isSafeRemotePath(installRoot)) {
    throw new Error("remote paths must be canonical $HOME-relative paths");
  }
  const skillName = skillPath.split("/").at(-1);
  const archive = `git archive ${sourceRef} -- ${skillPath}`;
  const remote = [
    "set -euo pipefail",
    `repo="${targetRepo}"`,
    `dest="$repo/${skillPath}"`,
    `installed="${installRoot}/${skillName}"`,
    'ts=$(date +%Y%m%d-%H%M%S)',
    `backup="$HOME/${skillName}-bak-$ts"`,
    'if [ -e "$dest" ] || [ -L "$dest" ]; then mv "$dest" "$backup"; fi',
    'mkdir -p "$(dirname "$dest")" "$(dirname "$installed")"',
    'tar -xf - -C "$repo"',
    'if [ -e "$installed" ] && [ ! -L "$installed" ]; then mv "$installed" "$HOME/' + skillName + '-installed-bak-$ts"; fi',
    'ln -sfn "$dest" "$installed"',
  ].join("; ");

  return {
    archive,
    remote,
    pipeline: `${archive} | ssh ${target} ${shellQuote(remote)}`,
  };
}

export function buildStandaloneSkillInstallCommands({ sourceRef, target, installRoot, linkRoot, skillPath }) {
  if (!SAFE_REF.test(sourceRef)) throw new Error("unsafe source ref");
  if (!SAFE_SSH_HOST.test(target)) throw new Error("unsafe SSH host");
  if (!SAFE_SKILL_PATH.test(skillPath)) throw new Error("unsafe canonical skill path");
  if (!isSafeRemotePath(installRoot) || !isSafeRemotePath(linkRoot)) {
    throw new Error("standalone install paths must be canonical $HOME-relative paths");
  }

  const skillName = skillPath.split("/").at(-1);
  const stripComponents = skillPath.split("/").length;
  const archive = [
    `source_commit=$(git rev-parse --verify ${sourceRef}^{commit})`,
    `git archive --format=tar --add-virtual-file=${skillPath}/.golems-source-commit:"$source_commit" "$source_commit" -- ${skillPath}`,
  ].join(" && ");
  const remote = [
    "set -euo pipefail",
    `dest="${installRoot}/${skillName}"`,
    `link="${linkRoot}/${skillName}"`,
    "ts=$(date +%Y%m%d-%H%M%S)",
    'stage="${dest}.stage-$ts"',
    'backup="${dest}.backup-$ts"',
    'link_backup="${link}.backup-$ts"',
    'mkdir -p "$stage" "$(dirname "$dest")" "$(dirname "$link")"',
    `tar -xf - -C "$stage" --strip-components=${stripComponents}`,
    'test ! -L "$stage"',
    'test -f "$stage/.golems-source-commit"',
    'if [ -e "$dest" ] || [ -L "$dest" ]; then mv "$dest" "$backup"; fi',
    'mv "$stage" "$dest"',
    'if [ -e "$link" ] || [ -L "$link" ]; then mv "$link" "$link_backup"; fi',
    'ln -s "$dest" "$link"',
  ].join("; ");

  return {
    archive,
    remote,
    pipeline: `${archive} | ssh ${target} ${shellQuote(remote)}`,
  };
}

export function buildStandaloneSkillVerifyCommand({ installRoot, linkRoot, skillName, sourceCommit }) {
  if (!isSafeRemotePath(installRoot) || !isSafeRemotePath(linkRoot)) {
    throw new Error("standalone verify paths must be canonical $HOME-relative paths");
  }
  if (!SAFE_COMPONENT.test(skillName) || !SAFE_COMMIT.test(sourceCommit)) {
    throw new Error("unsafe standalone skill name or source commit");
  }
  const dest = `${installRoot}/${skillName}`;
  const link = `${linkRoot}/${skillName}`;
  return [
    "set -euo pipefail",
    `dest="${dest}"`,
    `link="${link}"`,
    'test -d "$dest"',
    'test ! -L "$dest"',
    'test -f "$dest/SKILL.md"',
    `test "$(cat "$dest/.golems-source-commit")" = "${sourceCommit}"`,
    'test -L "$link"',
    'test "$(readlink "$link")" = "$dest"',
  ].join("; ");
}

export function buildManifestCommand(skillDirectory) {
  if (!isSafeRemotePath(skillDirectory)) {
    throw new Error("manifest path must be a canonical $HOME-relative path");
  }
  return [
    "set -euo pipefail",
    `cd "${skillDirectory}"`,
    "find . -type f -print0 | sort -z | while IFS= read -r -d '' file; do hash=$(shasum -a 256 \"$file\" | awk '{print $1}'); printf '%s\\t%s\\n' \"${file#./}\" \"$hash\"; done",
  ].join("; ");
}

export function assertRetireEligible(component, phaseStatuses) {
  if (!component || !SAFE_COMPONENT.test(component.name) || !Array.isArray(component.requiresGreen) || component.requiresGreen.length === 0) {
    throw new Error("retire component must have a safe name and a non-empty requiresGreen list");
  }
  for (const phase of component.requiresGreen) {
    if (!SAFE_COMPONENT.test(phase)) throw new Error(`unsafe retire phase id: ${phase}`);
    if (phaseStatuses?.[phase] !== "green") {
      throw new Error(`retire guard is not green: ${phase}`);
    }
  }
  return true;
}

export function buildRetiredMarkerContent({ component, replacement, checkoutPath, backupPath }) {
  if (!SAFE_COMPONENT.test(component)) throw new Error("unsafe retire component");
  if (!isSafeRemotePath(checkoutPath) || !isSafeRemotePath(backupPath)) {
    throw new Error("retire paths must be canonical $HOME-relative paths");
  }
  if (typeof replacement !== "string" || replacement.length === 0 || /[\r\n]/.test(replacement)) {
    throw new Error("retire replacement must be a non-empty single line");
  }
  return [
    `# ${component} was retired`,
    "",
    `Replaced by: ${replacement}`,
    "",
    `Backup path: ${backupPath}`,
    "",
    "Restore exactly with:",
    `mv '${backupPath}' '${checkoutPath}'`,
    "",
  ].join("\n");
}

export function buildRetireCommands({ target, gitRoot, backupRoot, component, replacement }) {
  if (!SAFE_SSH_HOST.test(target)) throw new Error("unsafe SSH host");
  if (!isSafeRemotePath(gitRoot) || !isSafeRemotePath(backupRoot)) {
    throw new Error("retire roots must be canonical $HOME-relative paths");
  }
  if (!SAFE_COMPONENT.test(component)) throw new Error("unsafe retire component");
  if (typeof replacement !== "string" || replacement.length === 0 || /[\r\n]/.test(replacement)) {
    throw new Error("retire replacement must be a non-empty single line");
  }

  const remote = [
    "set -euo pipefail",
    `component="${component}"`,
    `git_root="${gitRoot}"`,
    `backup_root="${backupRoot}"`,
    `checkout="${gitRoot}/${component}"`,
    `replacement=${shellQuote(replacement)}`,
    "ts=$(date +%Y%m%d-%H%M%S)",
    "marker_stamp=$(date +%Y-%m-%d-%H%M%S)",
    `backup_dir="${backupRoot}/M1-retired-$ts"`,
    'backup="$backup_dir/$component"',
    `marker="${gitRoot}/$component.RETIRED-$marker_stamp.md"`,
    'pending="${marker}.pending"',
    'if [ ! -e "$checkout" ]; then marker=""; if [ -d "$git_root" ]; then marker=$(find "$git_root" -maxdepth 1 -type f -name "$component.RETIRED-*.md" -print | sort | tail -1); fi; if [ -n "$marker" ]; then existing_backup=$(sed -n "s/^Backup path: //p" "$marker" | tail -1); backup_lines=$(grep -c "^Backup path: " "$marker" || true); expected_restore="mv \'$existing_backup\' \'$checkout\'"; backup_shape=0; case "$existing_backup" in "$backup_root"/M1-retired-*/"$component") backup_shape=1;; esac; if [ "$backup_shape" -eq 1 ] && [ "$backup_lines" -eq 1 ] && [ -d "$existing_backup" ] && grep -Fqx "$expected_restore" "$marker"; then printf "RETIRE ALREADY COMPLETE: %s\\nMARKER: %s\\nBACKUP: %s\\n" "$component" "$marker" "$existing_backup"; exit 0; fi; fi; printf "RETIRE FAILED CLOSED: %s checkout absent without a valid RETIRED marker and backup\\n" "$component" >&2; exit 4; fi',
    'test ! -e "$backup"',
    'test ! -e "$marker"',
    'mkdir -p "$backup_dir"',
    'printf "# %s was retired\\n\\nReplaced by: %s\\n\\nBackup path: %s\\n\\nRestore exactly with:\\nmv \'%s\' \'%s\'\\n" "$component" "$replacement" "$backup" "$backup" "$checkout" > "$pending"',
    'mv "$checkout" "$backup"',
    'if mv "$pending" "$marker"; then printf "RETIRE COMPLETE: %s -> %s\\nMARKER: %s\\nRESTORE: mv \'%s\' \'%s\'\\n" "$checkout" "$backup" "$marker" "$backup" "$checkout"; else mv "$backup" "$checkout"; printf "RETIRE ROLLBACK: marker publication failed for %s\\n" "$component" >&2; exit 1; fi',
  ].join("; ");

  return {
    remote,
    command: `ssh ${target} ${shellQuote(remote)}`,
  };
}

export function parseManifestOutput(output) {
  const files = {};
  for (const line of String(output).split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("\t");
    if (separator < 1) throw new Error(`invalid manifest line: ${line}`);
    files[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return { files };
}

export function summarizeDrift({ skills, hostEnv, runtime, phases = [], fix }) {
  const entries = [
    ...skills.map((item) => ["skill", item.name, item.status]),
    ...hostEnv.map((item) => ["host-env", item.id, item.status]),
    ...runtime.map((item) => ["runtime", item.id, item.status]),
    ...phases.map((item) => ["phase", item.id, item.status]),
  ];
  const healthy = new Set(["ok", "skipped", "green", "retired", "eligible"]);
  const repaired = new Set(["synced", "provisioned", "retired"]);
  const found = entries.filter(([, , status]) => repaired.has(status) || !healthy.has(status));
  const remaining = entries.filter(([, , status]) => !healthy.has(status) && !repaired.has(status));
  return {
    status: remaining.length === 0 ? "clean" : "found",
    found,
    remaining,
    fixed: Boolean(fix && found.length > 0 && remaining.length === 0),
  };
}

export function needsStandaloneRecheck({ fix, status }) {
  return Boolean(fix && status && status !== "green");
}

export function validateProfile(profile) {
  if (!profile || profile.version !== 1 || typeof profile.targets !== "object") {
    throw new Error("profile must use schema version 1 and declare targets");
  }

  const serialized = JSON.stringify(profile, (key, value) => key === "gitInventory" ? undefined : value);
  if (PRIVATE_ASSET_PATTERN.test(serialized)) {
    throw new Error("profile references a private voice asset; private carveout content is forbidden");
  }
  if (/mimir/i.test(serialized)) {
    throw new Error("profile must not contain mimir path operations");
  }

  for (const [targetName, target] of Object.entries(profile.targets)) {
    if (!SAFE_SSH_HOST.test(target.sshHost ?? "")) {
      throw new Error(`target ${targetName} must declare a safe sshHost`);
    }
    if (!Array.isArray(target.skills) || !Array.isArray(target.hostEnvCheckers) || !Array.isArray(target.runtimeChecks)) {
      throw new Error(`target ${targetName} must declare skills, hostEnvCheckers, and runtimeChecks arrays`);
    }
    if (target.skills.length > 0) {
      if (!isSafeRemotePath(target.repoPath ?? "") || !isSafeRemotePath(target.installRoot ?? "")) {
        throw new Error(`target ${targetName} legacy skills require safe repoPath and installRoot`);
      }
      if (!Array.isArray(target.keepList) || !target.keepList.includes(target.repoPath)) {
        throw new Error(`target ${targetName} keepList must preserve its legacy golems repo path`);
      }
    }
    for (const skill of target.skills ?? []) {
      if (!SAFE_SKILL_PATH.test(skill.path)) {
        throw new Error(`unsafe canonical skill path: ${skill.path}`);
      }
      if (!Array.isArray(skill.keyFiles) || skill.keyFiles.length === 0) {
        throw new Error(`skill ${skill.path} must declare at least one key file`);
      }
    }

    const standalone = target.standaloneSkills;
    if (standalone) {
      if (!SAFE_COMPONENT.test(standalone.id ?? "") || !SAFE_SOURCE_ROOT.test(standalone.sourceRoot ?? "")) {
        throw new Error(`target ${targetName} has an unsafe standalone skills phase`);
      }
      if (!isSafeRemotePath(standalone.installRoot ?? "") || !isSafeRemotePath(standalone.linkRoot ?? "")) {
        throw new Error(`target ${targetName} standalone skill roots must be safe`);
      }
      if (!isSafeRemotePath(standalone.legacyCheckoutRoot ?? "")) {
        throw new Error(`target ${targetName} standalone legacy checkout root must be safe`);
      }
      if (standalone.include !== undefined && (!Array.isArray(standalone.include) || standalone.include.some((name) => !SAFE_COMPONENT.test(name)))) {
        throw new Error(`target ${targetName} standalone skill include list is unsafe`);
      }
      if (!Array.isArray(standalone.verifyCommands) || standalone.verifyCommands.some((command) => typeof command !== "string" || !command)) {
        throw new Error(`target ${targetName} standalone skills must declare verifyCommands`);
      }
    }

    for (const phase of [target.ralphtools, ...(target.rewires ?? [])].filter(Boolean)) {
      if (!SAFE_COMPONENT.test(phase.id ?? "")) throw new Error(`target ${targetName} has an unsafe managed phase id`);
      for (const key of ["checkCommand", "fixCommand", "verifyCommand"]) {
        if (typeof phase[key] !== "string" || !phase[key]) throw new Error(`managed phase ${phase.id} must declare ${key}`);
      }
    }
    if (!Array.isArray(target.rewires ?? [])) throw new Error(`target ${targetName} rewires must be an array`);

    const inventory = target.gitInventory;
    if (inventory) {
      if (!SAFE_COMPONENT.test(inventory.id ?? "") || !isSafeRemotePath(inventory.root ?? "")
        || !Array.isArray(inventory.allow) || inventory.allow.length === 0
        || inventory.allow.some((name) => !SAFE_COMPONENT.test(name))
        || !Array.isArray(inventory.required) || inventory.required.length === 0
        || inventory.required.some((name) => !inventory.allow.includes(name))) {
        throw new Error(`target ${targetName} has an unsafe git inventory`);
      }
    }

    const phaseIds = [
      standalone?.id,
      target.ralphtools?.id,
      ...(target.rewires ?? []).map((phase) => phase.id),
      ...target.hostEnvCheckers.map((phase) => phase.id),
      ...target.runtimeChecks.map((phase) => phase.id),
      inventory?.id,
    ].filter(Boolean);
    if (phaseIds.some((id) => !SAFE_COMPONENT.test(id))) {
      throw new Error(`target ${targetName} has an unsafe phase id`);
    }
    if (new Set(phaseIds).size !== phaseIds.length) {
      throw new Error(`target ${targetName} has a duplicate phase id`);
    }
    const knownPhases = new Set(phaseIds);
    if ((target.retire ?? []).length > 0
      && (!isSafeRemotePath(target.retireGitRoot ?? "") || !isSafeRemotePath(target.retireBackupRoot ?? ""))) {
      throw new Error(`target ${targetName} retire roots must be safe`);
    }
    for (const component of target.retire ?? []) {
      if (!SAFE_COMPONENT.test(component.name ?? "") || !Array.isArray(component.requiresGreen) || component.requiresGreen.length === 0) {
        throw new Error(`target ${targetName} retire component has an unsafe name or empty requiresGreen`);
      }
      if (typeof component.replacement !== "string" || !component.replacement || /[\r\n]/.test(component.replacement)) {
        throw new Error(`retire component ${component.name} must declare a single-line replacement`);
      }
      for (const phase of component.requiresGreen) {
        if (!knownPhases.has(phase)) throw new Error(`retire component ${component.name} requires unknown phase ${phase}`);
      }
    }
    if (!Array.isArray(target.retire ?? [])) throw new Error(`target ${targetName} retire must be an array`);
  }

  return profile;
}

export function parseArgs(argv) {
  const options = { target: undefined, profile: undefined, apply: false, fix: false, json: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--fix") options.fix = true;
    else if (arg === "--target") options.target = argv[++index];
    else if (arg === "--profile") options.profile = argv[++index];
    else if (arg === "--no-json") options.json = false;
    else if (arg === "--dry-run") options.apply = false;
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (options.fix && !options.apply) throw new Error("--fix requires --apply");
  return options;
}
