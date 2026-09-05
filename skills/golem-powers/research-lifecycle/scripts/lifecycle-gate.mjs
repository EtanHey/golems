#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sharedDriveGate = fileURLToPath(
  new URL("../../_shared/research/drive-grounding-gate.sh", import.meta.url),
);
const expectedDriveAccount = process.env.RESEARCH_ACCOUNT?.trim() || "research-account@example.com";

function check(pass, detail) {
  return { pass: Boolean(pass), detail };
}

function duplicateNames(files) {
  const seen = new Set();
  const duplicates = new Set();
  for (const file of files) {
    if (seen.has(file.name)) duplicates.add(file.name);
    seen.add(file.name);
  }
  return [...duplicates].sort();
}

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validRelativeName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    value !== "." &&
    !value.startsWith("../") &&
    path.posix.normalize(value) === value
  );
}

function isGroundingHeader(line) {
  return /^ {0,3}#[ \t]+Grounding(?:[ \t]+\([^\r\n)]+\))?(?:[ \t]+#+)?[ \t]*$/.test(
    line,
  );
}

function validUniqueStrings(values, requireNonEmpty = false) {
  return (
    Array.isArray(values) &&
    (!requireNonEmpty || values.length > 0) &&
    values.every(
      (value) => typeof value === "string" && value.length > 0 && value === value.trim(),
    ) &&
    new Set(values).size === values.length
  );
}

export function collectLocalInventory(rootPath) {
  const root = path.resolve(rootPath);
  if (!statSync(root).isDirectory()) throw new Error(`local root is not a directory: ${root}`);

  const inventory = [];
  function visit(directory, relativeDirectory = "") {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativeName = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativeName);
      } else if (entry.isFile()) {
        const stats = statSync(absolutePath);
        inventory.push({
          name: relativeName,
          sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
          modifiedTime: stats.mtime.toISOString(),
        });
      }
    }
  }

  visit(root);
  return inventory;
}

export function evaluateGeminiPreflight(promptText) {
  const text = typeof promptText === "string" ? promptText : "";
  const lines = text.split(/\r?\n/);
  const groundingIndexes = lines
    .map((line, index) => (isGroundingHeader(line) ? index : -1))
    .filter((index) => index >= 0);

  const singleGrounding = groundingIndexes.length === 1;
  const groundingLines = [];
  if (singleGrounding) {
    for (let index = groundingIndexes[0] + 1; index < lines.length; index += 1) {
      if (/^#\s/.test(lines[index])) break;
      if (lines[index].trim()) groundingLines.push(lines[index].trim());
    }
  }

  const documentEntries = groundingLines
    .map((line) => line.match(/^-\s+"([^"]+)"(?:\s.*)?$/))
    .filter(Boolean);
  const hasDocumentPlaceholder = documentEntries.some((match) => /[<>]/.test(match[1]));
  const namedDocument = documentEntries.some((match) => !/[<>]/.test(match[1]));
  const explicitWebOnly = groundingLines.includes("None — web-only research");
  const groundingSourceValid = (namedDocument || explicitWebOnly) && !hasDocumentPlaceholder;
  const sharedResult = spawnSync("bash", [sharedDriveGate, "-"], {
    input: text,
    encoding: "utf8",
  });

  const checks = {
    GROUNDING_BLOCK: check(
      singleGrounding,
      `expected exactly one # Grounding block; found ${groundingIndexes.length}`,
    ),
    GROUNDING_SOURCE: check(
      groundingSourceValid,
      hasDocumentPlaceholder
        ? "unexpanded document placeholder present"
        : namedDocument
          ? "named Drive document present"
          : explicitWebOnly
            ? "explicit web-only grounding present"
            : "missing a quoted Drive document name or exact web-only line",
    ),
    NO_ATTACH_INSTRUCTION: check(
      sharedResult.status === 0,
      (sharedResult.stderr || sharedResult.stdout || "drive-grounding gate failed").trim(),
    ),
  };

  const failedChecks = Object.entries(checks)
    .filter(([, result]) => !result.pass)
    .map(([name]) => name);

  return {
    gate: "gemini-preflight",
    pass: failedChecks.length === 0,
    verdict: failedChecks.length === 0 ? "PASS" : "FAIL",
    failedChecks,
    checks,
  };
}

export function evaluateLifecycleReceipt(receipt, preflight, canonicalLocalFiles) {
  const value = receipt && typeof receipt === "object" ? receipt : {};
  const routeTools = new Set(value.driveRoute?.resolvedWith ?? []);
  const reportedLocalFiles = Array.isArray(value.localFiles) ? value.localFiles : [];
  const localFiles = Array.isArray(canonicalLocalFiles) ? canonicalLocalFiles : [];
  const driveFiles = Array.isArray(value.driveFiles) ? value.driveFiles : [];
  const reportedLocalDuplicates = duplicateNames(reportedLocalFiles);
  const localDuplicates = duplicateNames(localFiles);
  const driveDuplicates = duplicateNames(driveFiles);
  const reportedLocalNamesValid = reportedLocalFiles.every((file) => validRelativeName(file.name));
  const localNamesValid = localFiles.every((file) => validRelativeName(file.name));
  const driveNamesValid = driveFiles.every((file) => validRelativeName(file.name));
  const reportedLocalNames = reportedLocalFiles.map((file) => file.name).sort();
  const localNames = localFiles.map((file) => file.name).sort();
  const driveNames = driveFiles.map((file) => file.name).sort();
  const reportedByName = new Map(reportedLocalFiles.map((file) => [file.name, file]));
  const reportedMatchesCanonical =
    localFiles.length > 0 &&
    reportedLocalNamesValid &&
    localNamesValid &&
    reportedLocalDuplicates.length === 0 &&
    localDuplicates.length === 0 &&
    JSON.stringify(reportedLocalNames) === JSON.stringify(localNames) &&
    localFiles.every((canonicalFile) => {
      const reportedFile = reportedByName.get(canonicalFile.name);
      const canonicalTime = validTimestamp(canonicalFile.modifiedTime);
      const reportedTime = validTimestamp(reportedFile?.modifiedTime);
      return (
        validDigest(canonicalFile.sha256) &&
        validDigest(reportedFile?.sha256) &&
        canonicalFile.sha256.toLowerCase() === reportedFile.sha256.toLowerCase() &&
        canonicalTime !== null &&
        reportedTime === canonicalTime
      );
    });
  const exactFileSet =
    localFiles.length > 0 &&
    localNamesValid &&
    driveNamesValid &&
    localDuplicates.length === 0 &&
    driveDuplicates.length === 0 &&
    JSON.stringify(localNames) === JSON.stringify(driveNames);

  const driveByName = new Map(driveFiles.map((file) => [file.name, file]));
  const fileComparisons = localFiles.map((localFile) => {
    const driveFile = driveByName.get(localFile.name);
    const localTime = validTimestamp(localFile.modifiedTime);
    const driveTime = validTimestamp(driveFile?.modifiedTime);
    const digestMatches =
      validDigest(localFile.sha256) &&
      validDigest(driveFile?.sha256) &&
      localFile.sha256.toLowerCase() === driveFile.sha256.toLowerCase();
    const timestampFresh = localTime !== null && driveTime !== null && driveTime >= localTime;
    return {
      name: localFile.name,
      present: Boolean(driveFile),
      digestMatches,
      timestampFresh,
    };
  });
  const contentAndTimeFresh =
    exactFileSet &&
    fileComparisons.length > 0 &&
    fileComparisons.every((comparison) => comparison.digestMatches && comparison.timestampFresh);

  const accountVerification = value.accountVerification ?? {};
  const accountMatches =
    accountVerification.callSucceeded === true &&
    accountVerification.match === true &&
    accountVerification.expected === expectedDriveAccount &&
    accountVerification.drive_account === expectedDriveAccount &&
    (value.notebooklm?.exists !== true ||
      accountVerification.notebooklm_account === expectedDriveAccount);
  const notebookExists = value.notebooklm?.exists;
  const expectedReplacementIds = value.notebooklm?.expectedReplacementIds;
  const indexedSourceIds = value.notebooklm?.indexedSourceIds;
  const staleSourceIds = value.notebooklm?.staleSourceIds;
  const notebookEvidenceValid =
    validUniqueStrings(expectedReplacementIds, true) &&
    validUniqueStrings(indexedSourceIds, true) &&
    validUniqueStrings(staleSourceIds);
  const indexedSourceSet = new Set(Array.isArray(indexedSourceIds) ? indexedSourceIds : []);
  const notebookFresh =
    notebookExists === false ||
    (notebookExists === true &&
      notebookEvidenceValid &&
      expectedReplacementIds.every((sourceId) => indexedSourceSet.has(sourceId)) &&
      staleSourceIds.every((sourceId) => !indexedSourceSet.has(sourceId)));
  const preflightPassed = preflight?.pass === true;

  const checks = {
    DRIVE_ROUTE: check(
      value.driveRoute?.canonical === true &&
        routeTools.has("/drive-usage") &&
        routeTools.has("/braindrive"),
      "canonical route must be resolved with /drive-usage and /braindrive",
    ),
    DRIVE_AUTH: check(
      value.driveAuth?.callSucceeded === true && value.driveAuth?.authed === true,
      "authGetStatus must be a successful real call that returns authed",
    ),
    DRIVE_ACCOUNT: check(
      accountMatches,
      accountMatches
        ? `active Drive account matches ${expectedDriveAccount}`
        : `verify-account.sh must succeed for ${expectedDriveAccount} and record the active identity`,
    ),
    LOCAL_INVENTORY: check(
      reportedMatchesCanonical,
      reportedMatchesCanonical
        ? "receipt localFiles exactly match the inventory derived from --local-root"
        : "receipt localFiles do not cover the canonical inventory derived from --local-root",
    ),
    DRIVE_FILESET: check(
      exactFileSet,
      exactFileSet
        ? "Drive managed file set exactly matches local"
        : `file-set mismatch; local duplicates=${localDuplicates.join(",") || "none"}; Drive duplicates=${driveDuplicates.join(",") || "none"}`,
    ),
    DRIVE_FRESHNESS: check(
      contentAndTimeFresh,
      contentAndTimeFresh
        ? "every Drive file matches the local digest and is at least as new"
        : JSON.stringify(fileComparisons),
    ),
    NOTEBOOKLM_FRESHNESS: check(
      notebookFresh,
      notebookExists === false
        ? "not applicable: no project notebook"
        : notebookFresh
          ? "replacement source IDs are indexed and stale source IDs are absent"
          : "project notebook lacks valid replacement/indexed/stale source-ID evidence",
    ),
    GEMINI_PREFLIGHT: check(
      preflightPassed,
      preflightPassed ? "Gemini grounding preflight passed" : "Gemini grounding preflight failed",
    ),
  };

  const failedChecks = Object.entries(checks)
    .filter(([, result]) => !result.pass)
    .map(([name]) => name);

  return {
    gate: "research-lifecycle",
    verdict: failedChecks.length === 0 ? "PASS" : "FAIL",
    failedChecks,
    checks,
    fileComparisons,
  };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  lifecycle-gate.mjs preflight --prompt <prompt.md>\n" +
      "  lifecycle-gate.mjs completion --receipt <receipt.json> --prompt <prompt.md> --local-root <context-dir>\n",
  );
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.verdict === "PASS" ? 0 : 1;
}

function main() {
  const [action, ...args] = process.argv.slice(2);
  const promptPath = option(args, "--prompt");

  if (action === "preflight" && promptPath) {
    printResult(evaluateGeminiPreflight(readFileSync(promptPath, "utf8")));
    return;
  }

  const receiptPath = option(args, "--receipt");
  const localRoot = option(args, "--local-root");
  if (action === "completion" && receiptPath && promptPath && localRoot) {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    const preflight = evaluateGeminiPreflight(readFileSync(promptPath, "utf8"));
    printResult(evaluateLifecycleReceipt(receipt, preflight, collectLocalInventory(localRoot)));
    return;
  }

  usage();
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
