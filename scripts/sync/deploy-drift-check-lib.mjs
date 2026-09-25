const HOST_ENV_KEYS = new Set(["HOME", "PATH"]);
const CREDENTIAL_KEY_PATTERN = /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_?KEY|PRIVATE_?KEY)$/i;
const MANAGED_TARGET_PATTERN = /\.(?:bash|cjs|js|mjs|py|sh|ts|tsx|zsh)$/i;

export function isManagedLabel(label) {
  return typeof label === "string" && /^com\.golems(?:\.|zikaron\.)/.test(label);
}

function normalizeString(value) {
  return value
    .replaceAll("@GOLEMS_ROOT@", "$HOME/Gits/golems")
    .replaceAll("@HOME@", "$HOME")
    .replaceAll(/\/Users\/[^/\s]+/g, "$HOME");
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])]));
  }
  return typeof value === "string" ? normalizeString(value) : value;
}

export function isSensitiveEnvironmentKey(key) {
  return HOST_ENV_KEYS.has(key) || CREDENTIAL_KEY_PATTERN.test(key);
}

export function normalizePlist(plist) {
  const normalized = structuredClone(plist ?? {});
  if (normalized.EnvironmentVariables) {
    normalized.EnvironmentVariables = Object.fromEntries(
      Object.entries(normalized.EnvironmentVariables)
        .filter(([key]) => !isSensitiveEnvironmentKey(key))
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    if (Object.keys(normalized.EnvironmentVariables).length === 0) {
      delete normalized.EnvironmentVariables;
    }
  }
  return normalizeValue(normalized);
}

export function plistsMatch(source, deployed) {
  return JSON.stringify(normalizePlist(source)) === JSON.stringify(normalizePlist(deployed));
}

export function selectManagedTarget(plist) {
  const args = Array.isArray(plist?.ProgramArguments) ? plist.ProgramArguments : [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app-dir" && typeof args[index + 1] === "string") return args[index + 1];
  }
  const script = args.find((argument) => typeof argument === "string" && argument.startsWith("/") && MANAGED_TARGET_PATTERN.test(argument));
  if (script) return script;
  const direct = args.find((argument) => typeof argument === "string" && argument.startsWith("/") && !argument.startsWith("/bin/"));
  if (direct) return direct;
  if (typeof plist?.Program === "string") return plist.Program;
  return typeof args[0] === "string" ? args[0] : null;
}

function parseField(text, field) {
  const match = text.match(new RegExp(`^\\s*${field}\\s*=\\s*(.+?)\\s*$`, "m"));
  return match?.[1] ?? null;
}

export function parseLaunchctlPrint(text) {
  const rawLastExit = parseField(text, "last exit code");
  const rawRuns = parseField(text, "runs");
  return {
    isLoaded: true,
    state: parseField(text, "state"),
    lastExitCode: rawLastExit && /^-?\d+$/.test(rawLastExit) ? Number(rawLastExit) : null,
    plistPath: parseField(text, "path"),
    runs: rawRuns && /^\d+$/.test(rawRuns) ? Number(rawRuns) : null,
  };
}

export function buildLaunchdEntry({
  label,
  trackedSources = [],
  deployed = null,
  plistMatch = null,
  target = null,
  loaded = null,
  checkout = null,
  envContract = null,
  retired = false,
  inspectionErrors = [],
}) {
  const reasons = [];
  const warnings = [];
  let retiredState = null;
  const active = Boolean(deployed || loaded?.isLoaded);
  const untrackedDeployment = !retired && trackedSources.length === 0 && active;

  if (retired) {
    retiredState = deployed || loaded?.isLoaded ? "present" : "absent";
    if (retiredState === "present") reasons.push("retired job is unexpectedly present");
  } else {
    if (target?.exists === false) reasons.push("execution target is missing");
    if (loaded?.isLoaded && Number.isInteger(loaded.lastExitCode) && loaded.lastExitCode !== 0) {
      reasons.push(`loaded job last exited with code ${loaded.lastExitCode}`);
    }
    if (trackedSources.length > 1) reasons.push("multiple tracked plist sources declare this label");
    if (trackedSources.length > 0 && deployed && plistMatch === false) reasons.push("deployed plist differs from tracked source");
    if (untrackedDeployment) reasons.push("deployed plist has no tracked source");
    if (target?.repoRoot && target.tracked === false) {
      reasons.push(target.ignored ? "execution target is gitignored" : "execution target is not git-tracked");
    }
    if (active && checkout?.dirty) reasons.push("service checkout is dirty");
    if (active && checkout?.relation && checkout.relation !== "equal") reasons.push(`service checkout is ${checkout.relation} its upstream`);
    if (!active && trackedSources.length > 0) warnings.push("tracked source is not deployed or loaded");
    for (const key of envContract?.unusedKeys ?? []) warnings.push(`plist environment variable is not read by target: ${key}`);
  }

  let verdict = "OK";
  if (inspectionErrors.length > 0) {
    verdict = "DRIFT";
    reasons.push("inspection incomplete");
  } else if (retiredState === "present") {
    verdict = "DRIFT";
  } else if (reasons.some((reason) => reason === "execution target is missing" || reason.startsWith("loaded job last exited"))) {
    verdict = "DEAD";
  } else if (untrackedDeployment) {
    verdict = "UNTRACKED";
  } else if (reasons.length > 0) {
    verdict = "DRIFT";
  }

  return {
    kind: "launchd",
    id: label,
    label,
    retired,
    retiredState,
    trackedSource: trackedSources[0] ?? null,
    deployed,
    plistMatch,
    target,
    loaded,
    checkout,
    envContract,
    verdict,
    reasons,
    warnings,
    inspectionErrors,
  };
}

export function buildReport({ generatedAt = new Date().toISOString(), source, entries, inspectionErrors = [] }) {
  const summary = { OK: 0, DRIFT: 0, DEAD: 0, UNTRACKED: 0, total: entries.length };
  for (const entry of entries) summary[entry.verdict] += 1;
  return {
    schemaVersion: 1,
    generatedAt,
    readOnly: true,
    source,
    summary,
    inspectionErrors,
    entries,
  };
}

export function reportExitCode(report) {
  if (report.inspectionErrors.length > 0 || report.entries.some((entry) => entry.inspectionErrors?.length > 0)) return 2;
  return report.summary.DRIFT > 0 || report.summary.DEAD > 0 ? 1 : 0;
}

export function formatHumanReport(report) {
  const lines = [
    `Deploy drift report — ${report.generatedAt}`,
    `Source: ${report.source.repoRoot} @ ${report.source.commit ?? "unknown"}`,
    `Total: ${report.summary.total}`,
  ];
  for (const verdict of ["OK", "DRIFT", "DEAD", "UNTRACKED"]) {
    const entries = report.entries.filter((entry) => entry.verdict === verdict);
    lines.push("", `${verdict} (${entries.length})`);
    for (const entry of entries) {
      lines.push(`- ${entry.id}`);
      if (entry.trackedSource) {
        lines.push(`  source: ${entry.trackedSource.path} @ ${entry.trackedSource.commit ?? "unknown"} sha256:${entry.trackedSource.sha256 ?? "unavailable"}`);
      } else {
        lines.push("  source: absent");
      }
      if (entry.deployed) lines.push(`  deployed: ${entry.deployed.path} sha256:${entry.deployed.sha256 ?? "unavailable"}`);
      else lines.push("  deployed: absent");
      if (entry.target) lines.push(`  target: ${entry.target.path} exists=${entry.target.exists} tracked=${entry.target.tracked ?? "external"}`);
      if (entry.loaded) lines.push(`  loaded: state=${entry.loaded.state ?? "unknown"} lastExit=${entry.loaded.lastExitCode ?? "null"} runs=${entry.loaded.runs ?? "null"}`);
      else if (entry.kind === "launchd") lines.push("  loaded: no");
      for (const reason of entry.reasons ?? []) lines.push(`  reason: ${reason}`);
      for (const warning of entry.warnings ?? []) lines.push(`  warning: ${warning}`);
      for (const error of entry.inspectionErrors ?? []) lines.push(`  inspection-error: ${error.operation} ${error.subject}: ${error.message}`);
    }
  }
  if (report.inspectionErrors.length > 0) {
    lines.push("", `INSPECTION ERRORS (${report.inspectionErrors.length})`);
    for (const error of report.inspectionErrors) lines.push(`- ${error.operation} ${error.subject}: ${error.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceReadsEnvironmentKey(source, key) {
  const escaped = escapeRegExp(key);
  const patterns = [
    `(?:process|Bun)\\.env\\.${escaped}\\b`,
    `(?:process|Bun)\\.env\\[\\s*["']${escaped}["']\\s*\\]`,
    `os\\.(?:environ\\.get|environ\\.__getitem__|getenv)\\(\\s*["']${escaped}["']`,
    `(?:^|[^A-Za-z0-9_])\\$${escaped}\\b`,
    `\\$\\{${escaped}(?::?[-+?=][^}]*)?\\}`,
  ];
  return patterns.some((pattern) => new RegExp(pattern, "m").test(source));
}

export function findUnusedEnvironmentKeys(plist, targetSource = "") {
  const configuredKeys = Object.keys(plist?.EnvironmentVariables ?? {}).sort();
  const unusedKeys = configuredKeys.filter((key) => (
    !isSensitiveEnvironmentKey(key) && !sourceReadsEnvironmentKey(targetSource, key)
  ));
  return { configuredKeys, unusedKeys };
}

export function buildHookEntry({
  name,
  trackedSource,
  deployed = null,
  linkMode = "missing",
  linkTarget = null,
  inspectionErrors = [],
}) {
  const reasons = [];
  const warnings = [];
  const hashMatch = Boolean(deployed && trackedSource?.sha256 === deployed.sha256);

  if (!deployed) reasons.push("managed hook deployment is missing");
  else if (!hashMatch) reasons.push("deployed hook hash differs from tracked source");
  if (deployed && linkMode === "symlink" && linkTarget !== trackedSource.path) {
    reasons.push("deployed hook symlink does not target tracked source");
  }
  if (deployed && linkMode === "copy" && hashMatch) {
    warnings.push("deployed hook is a regular-file copy, not a symlink");
  }

  let verdict = "OK";
  if (inspectionErrors.length > 0) {
    verdict = "DRIFT";
    reasons.push("inspection incomplete");
  } else if (!deployed) {
    verdict = "DEAD";
  } else if (reasons.length > 0) {
    verdict = "DRIFT";
  }

  return {
    kind: "hook",
    id: `hook:${name}`,
    label: null,
    retired: false,
    retiredState: null,
    trackedSource,
    deployed,
    hashMatch,
    linkMode,
    linkTarget,
    verdict,
    reasons,
    warnings,
    inspectionErrors,
  };
}
