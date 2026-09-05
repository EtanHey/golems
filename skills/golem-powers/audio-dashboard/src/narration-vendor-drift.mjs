import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const GATE = "NARRATION_VENDOR_DRIFT";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function manifestRecord(metric, evidence, runbook) {
  return {
    gate: GATE,
    verdict: "REJECTED",
    pairId: "manifest",
    sourcePath: "<env:NARRATIONLAYER_UPSTREAM>",
    vendorPath: "vendor/narrationlayer/VENDOR-VERSION",
    target: "vendor/narrationlayer/VENDOR-VERSION",
    metric,
    value: metric === "STAMP_MISSING" ? "missing" : "invalid",
    threshold: "valid schema-v1 paired-hash manifest",
    evidence,
    runbook,
  };
}

function driftRecord(pair, metric, value, threshold, evidence, runbook) {
  return {
    gate: GATE,
    verdict: "REJECTED",
    pairId: pair.id,
    sourcePath: pair.sourcePath,
    vendorPath: pair.vendorPath,
    target: pair.vendorPath,
    metric,
    value,
    threshold,
    evidence,
    runbook,
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRepository(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!raw) return undefined;
  const hosted = raw.match(/(?:^|@|:\/\/)(?:[^/@]+@)?github\.com[:/]([^\s]+)$/i);
  const slug = (hosted?.[1] ?? (/^[^/\s]+\/[^/\s]+$/.test(raw) ? raw : undefined))
    ?.replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  return slug?.toLowerCase();
}

function isSafeRelativePath(value, requiredPrefix) {
  if (!isNonEmptyString(value) || value.includes("\0")) return false;
  const portable = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(portable) || path.win32.isAbsolute(value)) return false;
  const segments = portable.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return requiredPrefix ? portable.startsWith(requiredPrefix) : true;
}

function validateStamp(stamp) {
  if (!stamp || typeof stamp !== "object" || Array.isArray(stamp)) return "stamp must be an object";
  if (stamp.schemaVersion !== 1) return "schemaVersion must equal 1";
  if (stamp.vendor !== "narrationlayer") return "vendor must equal narrationlayer";
  if (!isNonEmptyString(stamp.vendorDate)) return "vendorDate must be a non-empty string";
  if (!stamp.upstream || !isNonEmptyString(stamp.upstream.repository)) return "upstream.repository is required";
  if (!COMMIT.test(stamp.upstream.commit ?? "")) return "upstream.commit must be a 40-character commit hash";
  if (!Array.isArray(stamp.pairs) || stamp.pairs.length === 0) return "pairs must be a non-empty array";

  const ids = new Set();
  for (const pair of stamp.pairs) {
    if (!isNonEmptyString(pair?.id) || ids.has(pair.id)) return "pair ids must be non-empty and unique";
    ids.add(pair.id);
    if (!isNonEmptyString(pair.vendorPath) || !isNonEmptyString(pair.sourcePath)) {
      return `pair ${pair.id} requires vendorPath and sourcePath`;
    }
    if (
      !isSafeRelativePath(pair.vendorPath, "vendor/narrationlayer/") ||
      !isSafeRelativePath(pair.sourcePath)
    ) {
      return `pair ${pair.id} must use paths relative to its tree without traversal`;
    }
    if (!SHA256.test(pair.vendorSha256 ?? "") || !SHA256.test(pair.sourceSha256 ?? "")) {
      return `pair ${pair.id} requires valid SHA-256 hashes`;
    }
  }

  if (!Array.isArray(stamp.vendorSideFirst)) return "vendorSideFirst must be an array";
  for (const debt of stamp.vendorSideFirst) {
    if (!isNonEmptyString(debt?.id) || !ids.has(debt.pairId)) return "every debt requires an id and known pairId";
    if (debt.status !== "open" && debt.status !== "resolved") return `debt ${debt.id} has invalid status`;
    if (
      !Array.isArray(debt.requiredUpstreamPatterns) ||
      debt.requiredUpstreamPatterns.length === 0 ||
      !debt.requiredUpstreamPatterns.every(isNonEmptyString)
    ) {
      return `debt ${debt.id} requires non-empty requiredUpstreamPatterns`;
    }
    if (
      !Array.isArray(debt.testCommand) ||
      debt.testCommand.length === 0 ||
      !debt.testCommand.every(isNonEmptyString)
    ) {
      return `debt ${debt.id} requires a non-empty testCommand`;
    }
    if (debt.status === "resolved" && !COMMIT.test(debt.resolvedUpstreamCommit ?? "")) {
      return `resolved debt ${debt.id} requires resolvedUpstreamCommit`;
    }
  }
  if (!Array.isArray(stamp.upstreamSideFirst)) return "upstreamSideFirst must be an array";
  for (const debt of stamp.upstreamSideFirst) {
    if (!isNonEmptyString(debt?.id) || !ids.has(debt.pairId)) return "every upstream-first debt requires an id and known pairId";
    if (debt.status !== "open" && debt.status !== "resolved") return `debt ${debt.id} has invalid status`;
    if (
      !Array.isArray(debt.requiredUpstreamPatterns) ||
      debt.requiredUpstreamPatterns.length === 0 ||
      !debt.requiredUpstreamPatterns.every(isNonEmptyString)
    ) {
      return `debt ${debt.id} requires non-empty requiredUpstreamPatterns`;
    }
    if (
      !Array.isArray(debt.testCommand) ||
      debt.testCommand.length === 0 ||
      !debt.testCommand.every(isNonEmptyString)
    ) {
      return `debt ${debt.id} requires a non-empty testCommand`;
    }
    if (debt.status === "resolved" && !COMMIT.test(debt.resolvedVendorCommit ?? "")) {
      return `resolved debt ${debt.id} requires resolvedVendorCommit`;
    }
  }
  return undefined;
}

export function parseVendorStamp(text) {
  if (text == null || String(text).trim() === "") {
    return {
      ok: false,
      record: manifestRecord(
        "STAMP_MISSING",
        "vendor/narrationlayer/VENDOR-VERSION is absent or empty.",
        "Create the stamp from a verified upstream/vendor snapshot, then rerun the lint.",
      ),
    };
  }
  try {
    const stamp = JSON.parse(String(text));
    const validationError = validateStamp(stamp);
    if (validationError) throw new Error(validationError);
    return { ok: true, stamp };
  } catch (error) {
    return {
      ok: false,
      record: manifestRecord(
        "STAMP_INVALID",
        `VENDOR-VERSION cannot be validated: ${error instanceof Error ? error.message : String(error)}`,
        "Repair or regenerate the schema-v1 paired-hash manifest, then rerun the lint.",
      ),
    };
  }
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function runGit(upstreamRoot, args) {
  const result = spawnSync("git", args, { cwd: upstreamRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `upstream git inspection failed: git ${args.join(" ")}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

async function defaultInspectUpstream(upstreamRoot) {
  return {
    head: runGit(upstreamRoot, ["rev-parse", "HEAD"]),
    committedAt: runGit(upstreamRoot, ["show", "-s", "--format=%cI", "HEAD"]),
    dirty: runGit(upstreamRoot, ["status", "--porcelain", "--untracked-files=all"]),
    repository: normalizeRepository(runGit(upstreamRoot, ["remote", "get-url", "origin"])),
  };
}

export async function isExpectedUpstreamCheckout(upstreamRoot, stamp) {
  if (!isNonEmptyString(upstreamRoot)) return false;
  try {
    const inspected = await defaultInspectUpstream(upstreamRoot);
    return (
      normalizeRepository(inspected.repository) ===
      normalizeRepository(stamp?.upstream?.repository)
    );
  } catch {
    return false;
  }
}

async function defaultRunTest(command, upstreamRoot) {
  if (!Array.isArray(command) || command.length === 0 || !command.every(isNonEmptyString)) {
    throw new Error("targeted test command must be a non-empty string array");
  }
  const result = spawnSync(command[0], command.slice(1), {
    cwd: upstreamRoot,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function writeStampAtomic(stampPath, stamp) {
  const temporaryPath = `${stampPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
    await rename(temporaryPath, stampPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function refreshVendorStamp({
  skillRoot,
  upstreamRoot,
  stampPath,
  stamp,
  inspectUpstream = defaultInspectUpstream,
  runTest = defaultRunTest,
  vendorDate = new Date().toISOString().slice(0, 10),
}) {
  if (!isNonEmptyString(upstreamRoot)) throw new Error("upstream unavailable; stamp refresh requires a checkout");
  const inspected = await inspectUpstream(upstreamRoot);
  if (!COMMIT.test(inspected?.head ?? "")) throw new Error("upstream HEAD is not a committed 40-character hash");
  if (!isNonEmptyString(inspected?.committedAt)) throw new Error("upstream commit date is unavailable");
  const expectedRepository = normalizeRepository(stamp?.upstream?.repository);
  const inspectedRepository = normalizeRepository(inspected?.repository);
  if (!expectedRepository || inspectedRepository !== expectedRepository) {
    throw new Error(
      `upstream repository mismatch: expected ${expectedRepository ?? "invalid stamp repository"}, observed ${inspectedRepository ?? "unrecognized origin"}`,
    );
  }
  if (isNonEmptyString(inspected?.dirty)) {
    throw new Error(`dirty upstream checkout cannot refresh the stamp: ${inspected.dirty}`);
  }

  const nextStamp = JSON.parse(JSON.stringify(stamp));
  const openDebts = nextStamp.vendorSideFirst.filter((item) => item.status === "open");
  if (openDebts.length === 0) {
    throw new Error("no open vendor-first debt is available for debt-resolution refresh");
  }
  const openPairIds = new Set(openDebts.map((debt) => debt.pairId));
  const beforeRefresh = await observeVendorState({ skillRoot, upstreamRoot, stamp: nextStamp });
  const beforeById = new Map(beforeRefresh.pairs.map((pair) => [pair.id, pair]));
  const unexpectedDrift = nextStamp.pairs.filter((pair) => {
    if (openPairIds.has(pair.id)) return false;
    const observed = beforeById.get(pair.id) ?? {};
    return (
      observed.vendorSha256 !== pair.vendorSha256 ||
      observed.sourceSha256 !== pair.sourceSha256
    );
  });
  if (unexpectedDrift.length > 0) {
    throw new Error(
      `unexpected drift outside open debt pairs: ${unexpectedDrift.map((pair) => pair.id).join(", ")}`,
    );
  }
  const testResults = [];
  for (const debt of openDebts) {
    const pair = nextStamp.pairs.find((item) => item.id === debt.pairId);
    if (!pair) throw new Error(`open debt ${debt.id} references missing pair ${debt.pairId}`);
    const source = await readFile(path.join(upstreamRoot, pair.sourcePath), "utf8");
    for (const pattern of debt.requiredUpstreamPatterns ?? []) {
      if (!source.includes(pattern)) {
        throw new Error(`required upstream pattern missing for ${debt.id}: ${pattern}`);
      }
    }
    const result = await runTest(debt.testCommand, upstreamRoot);
    testResults.push({ debtId: debt.id, command: debt.testCommand, ...result });
    if (result.status !== 0) {
      throw new Error(
        `targeted test failed for ${debt.id}: ${debt.testCommand.join(" ")}: ${(result.stderr || result.stdout || "no output").trim()}`,
      );
    }
    debt.status = "resolved";
    debt.resolvedUpstreamCommit = inspected.head;
  }

  const finalInspection = await inspectUpstream(upstreamRoot);
  if (
    isNonEmptyString(finalInspection?.dirty) ||
    finalInspection?.head !== inspected.head ||
    finalInspection?.committedAt !== inspected.committedAt ||
    normalizeRepository(finalInspection?.repository) !== inspectedRepository
  ) {
    throw new Error("upstream changed during stamp refresh; refusing to bind hashes to an unstable checkout");
  }

  nextStamp.vendorDate = vendorDate;
  nextStamp.upstream.commit = inspected.head;
  nextStamp.upstream.committedAt = inspected.committedAt;
  nextStamp.pairs = await Promise.all(
    nextStamp.pairs.map(async (pair) => ({
      ...pair,
      vendorSha256: await sha256File(path.join(skillRoot, pair.vendorPath)),
      sourceSha256: await sha256File(path.join(upstreamRoot, pair.sourcePath)),
    })),
  );

  const hashedInspection = await inspectUpstream(upstreamRoot);
  if (
    isNonEmptyString(hashedInspection?.dirty) ||
    hashedInspection?.head !== inspected.head ||
    hashedInspection?.committedAt !== inspected.committedAt ||
    normalizeRepository(hashedInspection?.repository) !== inspectedRepository
  ) {
    throw new Error(
      "upstream changed while paired hashes were read; refusing to attribute unstable bytes to the stamped commit",
    );
  }

  const validationError = validateStamp(nextStamp);
  if (validationError) throw new Error(`refreshed stamp is invalid: ${validationError}`);
  const observed = {
    upstreamHead: inspected.head,
    pairs: nextStamp.pairs.map((pair) => ({
      id: pair.id,
      vendorSha256: pair.vendorSha256,
      sourceSha256: pair.sourceSha256,
    })),
  };
  const preflight = classifyVendorDrift(nextStamp, observed);
  const openUpstreamDebtByPair = new Map(
    nextStamp.upstreamSideFirst
      .filter((debt) => debt.status === "open")
      .map((debt) => [debt.pairId, debt]),
  );
  const unexpectedPreflightRecords = preflight.records.filter((record) => {
    const debt = openUpstreamDebtByPair.get(record.pairId);
    return !(
      debt &&
      record.metric === "VENDOR_BEHIND" &&
      record.value === "open" &&
      record.evidence.includes(`${debt.id}:`)
    );
  });
  if (unexpectedPreflightRecords.length > 0) {
    throw new Error(
      `refreshed stamp preflight rejected ${unexpectedPreflightRecords.length} unexpected record(s)`,
    );
  }
  await writeStampAtomic(stampPath, nextStamp);
  return { stamp: nextStamp, verdict: preflight.verdict, tests: testResults };
}

export function parseVendorDriftArgs(argv) {
  const known = new Set(["--refresh-stamp", "--resolve-open-debt"]);
  const unknown = argv.find((argument) => !known.has(argument));
  if (unknown) throw new Error(`unknown argument: ${unknown}`);
  const refreshStamp = argv.includes("--refresh-stamp");
  const resolveOpenDebt = argv.includes("--resolve-open-debt");
  if (refreshStamp !== resolveOpenDebt) {
    throw new Error("--refresh-stamp and --resolve-open-debt must be used together");
  }
  return { refreshStamp };
}

export async function observeVendorState({ skillRoot, upstreamRoot, stamp }) {
  const pairs = await Promise.all(
    stamp.pairs.map(async (pair) => {
      const vendorSha256 = await sha256File(path.join(skillRoot, pair.vendorPath)).catch(() => null);
      const sourceSha256 = upstreamRoot
        ? await sha256File(path.join(upstreamRoot, pair.sourcePath)).catch(() => null)
        : undefined;
      return { id: pair.id, vendorSha256, ...(upstreamRoot ? { sourceSha256 } : {}) };
    }),
  );
  return { upstreamHead: null, pairs };
}

function sortRecords(records) {
  return records.sort(
    (left, right) => left.target.localeCompare(right.target) || left.metric.localeCompare(right.metric),
  );
}

export function classifyVendorDrift(stamp, observed, { upstreamAvailable = true } = {}) {
  const observedById = new Map((observed?.pairs ?? []).map((pair) => [pair.id, pair]));
  const openVendorDebtByPair = new Map(
    stamp.vendorSideFirst.filter((item) => item.status === "open").map((debt) => [debt.pairId, debt]),
  );
  const openUpstreamDebtByPair = new Map(
    (stamp.upstreamSideFirst ?? [])
      .filter((item) => item.status === "open")
      .map((debt) => [debt.pairId, debt]),
  );
  const records = [];

  if (!upstreamAvailable) {
    records.push({
      gate: GATE,
      verdict: "DEGRADED",
      pairId: "manifest",
      sourcePath: "<env:NARRATIONLAYER_UPSTREAM>",
      vendorPath: "vendor/narrationlayer/VENDOR-VERSION",
      target: "vendor/narrationlayer/VENDOR-VERSION",
      metric: "UPSTREAM_UNAVAILABLE",
      value: "stamp-only",
      threshold: "full-upstream-comparison",
      evidence: "NARRATIONLAYER_UPSTREAM is unset or unavailable; validating stamped vendor hashes only.",
      runbook: "Set NARRATIONLAYER_UPSTREAM to a readable narrationlayer checkout for the full two-way comparison.",
    });
  }

  for (const pair of stamp.pairs) {
    const current = observedById.get(pair.id) ?? {};
    const openVendorDebt = openVendorDebtByPair.get(pair.id);
    const openUpstreamDebt = openUpstreamDebtByPair.get(pair.id);
    const vendorChanged = current.vendorSha256 !== pair.vendorSha256;
    const sourceChanged = upstreamAvailable && current.sourceSha256 !== pair.sourceSha256;
    const vendorDiverged = vendorChanged || Boolean(openVendorDebt);
    const sourceDiverged = sourceChanged || Boolean(openUpstreamDebt);
    if (vendorDiverged && sourceDiverged) {
      records.push(
        driftRecord(
          pair,
          "BIDIRECTIONAL_DRIFT",
          `vendor=${openVendorDebt ? `open-debt:${openVendorDebt.id}` : current.vendorSha256 ?? "missing"};source=${openUpstreamDebt ? `open-debt:${openUpstreamDebt.id}` : current.sourceSha256 ?? "missing"}`,
          `vendor=${pair.vendorSha256};source=${pair.sourceSha256}`,
          [
            openVendorDebt ? `${openVendorDebt.id}: ${openVendorDebt.aidevNote}` : undefined,
            openUpstreamDebt ? `${openUpstreamDebt.id}: ${openUpstreamDebt.aidevNote}` : undefined,
          ]
            .filter(Boolean)
            .join(" ") || "Both the vendored runtime and upstream source moved since the stamp.",
          "Reconcile both versions deliberately, run both repositories' tests, then refresh the stamp.",
        ),
      );
    } else if (vendorChanged) {
      records.push(
        driftRecord(
          pair,
          "VENDOR_AHEAD",
          openVendorDebt ? "open" : current.vendorSha256 ?? "missing",
          openVendorDebt ? "resolved" : pair.vendorSha256,
          openVendorDebt ? `${openVendorDebt.id}: ${openVendorDebt.aidevNote}` : "The vendored runtime differs from its stamped bytes.",
          "Port the vendor-first change upstream or restore the stamped vendor bytes; never refresh an open debt blindly.",
        ),
      );
    } else if (sourceChanged) {
      records.push(
        driftRecord(
          pair,
          "VENDOR_BEHIND",
          openUpstreamDebt
            ? `open-debt:${openUpstreamDebt.id};source=${current.sourceSha256 ?? "missing"}`
            : current.sourceSha256 ?? "missing",
          openUpstreamDebt ? `resolved;source=${pair.sourceSha256}` : pair.sourceSha256,
          openUpstreamDebt
            ? `The upstream source moved again while upstream-first debt remains open. ${openUpstreamDebt.id}: ${openUpstreamDebt.aidevNote}`
            : "The upstream source differs from the revision represented by the vendored runtime.",
          "Review and re-vendor the upstream change, run the audio-dashboard eval, then refresh the stamp.",
        ),
      );
    } else if (openVendorDebt) {
      records.push(
        driftRecord(
          pair,
          "VENDOR_AHEAD",
          "open",
          "resolved",
          `${openVendorDebt.id}: ${openVendorDebt.aidevNote}`,
          `Port ${openVendorDebt.id} to ${pair.sourcePath}, pass ${openVendorDebt.testCommand.join(" ")}, then resolve debt atomically while refreshing the stamp.`,
        ),
      );
    } else if (openUpstreamDebt) {
      records.push(
        driftRecord(
          pair,
          "VENDOR_BEHIND",
          "open",
          "resolved",
          `${openUpstreamDebt.id}: ${openUpstreamDebt.aidevNote}`,
          `Re-vendor ${openUpstreamDebt.id} from ${pair.sourcePath}, pass ${openUpstreamDebt.testCommand.join(" ")}, then mark the reviewed debt pair resolved while refreshing the stamp.`,
        ),
      );
    }
  }

  sortRecords(records);
  const rejected = records.some((record) => record.verdict === "REJECTED");
  return {
    verdict: rejected ? "REJECTED" : records.length ? "DEGRADED" : "PASS",
    records,
  };
}

export function formatTypedRecord(record) {
  return JSON.stringify(record);
}
