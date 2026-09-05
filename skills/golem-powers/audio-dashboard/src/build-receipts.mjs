import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseVendorStamp } from "./narration-vendor-drift.mjs";

export const BUILD_RECEIPTS_VERSION = 1;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function portableIdentifier(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      return path.basename(new URL(raw).pathname) || fallback;
    } catch {
      return fallback;
    }
  }
  return path.basename(raw.replaceAll("\\", "/")) || fallback;
}

export function buildReceiptsPath(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.receipts.json`);
}

export function readNarrationVendorStamp(skillRoot) {
  const stampPath = path.join(skillRoot, "vendor", "narrationlayer", "VENDOR-VERSION");
  if (!existsSync(stampPath)) return "unstamped";
  const value = readFileSync(stampPath, "utf8").trim();
  if (!value) return "unstamped";
  const parsed = parseVendorStamp(value);
  if (parsed.ok) {
    return `narrationlayer@${parsed.stamp.upstream.commit.slice(0, 12)}`;
  }
  return "unstamped";
}

export function resolveWhisperModelBasename() {
  if (process.env.NARRATIONLAYER_WHISPER_MODEL) {
    return portableIdentifier(process.env.NARRATIONLAYER_WHISPER_MODEL, "unknown");
  }
  const home = process.env.HOME;
  const candidates = home
    ? [
        path.join(home, ".cache", "whisper", "ggml-large-v3-turbo.bin"),
        path.join(home, ".cache", "whisper", "ggml-large-v3-turbo-q5_0.bin"),
        path.join(home, ".cache", "whisper", "ggml-base.en.bin"),
        path.join(home, ".cache", "whisper", "ggml-base.bin"),
      ]
    : [];
  return portableIdentifier(candidates.find(existsSync), "unknown");
}

export function createBuildReceipts({ outputPath, jobId, spec, vendorStamp, whisperModel }) {
  const scenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
  const allByo = scenes.length > 0 && scenes.every((scene) => scene.audioWav);
  const profiles = {};
  for (const scene of scenes) {
    const role = portableIdentifier(scene.role, "default");
    const profile = scene.audioWav
      ? "byo-wav"
      : portableIdentifier(scene.reference ?? scene.profile, "unspecified");
    profiles[role] = profile;
  }
  const deferrals = (Array.isArray(spec?.deferredScenes) ? spec.deferredScenes : []).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    reason: String(row.reason),
    ruling: String(row.ruling),
  }));
  return {
    version: BUILD_RECEIPTS_VERSION,
    artifact: path.basename(outputPath),
    artifactSha256: sha256(""),
    jobId: portableIdentifier(jobId, "audio-dashboard-job"),
    pipeline: {
      name: "audio-dashboard",
      vendorStamp: portableIdentifier(vendorStamp, "unstamped"),
    },
    engine: {
      substrate: allByo ? "byo-wav" : "qwen3:8880",
      profiles,
      whisperModel: portableIdentifier(whisperModel, "unknown"),
    },
    gates: [],
    purges: [],
    ...(deferrals.length ? { deferrals } : {}),
  };
}

function portableViolation(violation) {
  return {
    segment: String(violation.segment),
    ...(violation.role == null ? {} : { role: String(violation.role) }),
    metric: String(violation.metric ?? violation.code),
    value: violation.value ?? null,
    threshold: violation.threshold ?? null,
    evidence: String(violation.evidence ?? "No additional evidence supplied."),
  };
}

export function upsertBuildGate(
  receipts,
  { gate, result, config, runbook, derivedAliases, ranAt = new Date().toISOString() },
) {
  const verdict = result.verdict === "PASS" ? "PASS" : "REJECT";
  const row = {
    gate,
    stage: "BUILD",
    verdict,
    config: { ...config },
    violations: (result.violations ?? []).map(portableViolation),
    ...(derivedAliases === undefined
      ? {}
      : {
          derivedAliases: derivedAliases.map((alias) => ({
            segment: String(alias.segment),
            term: String(alias.term),
            spoken: String(alias.spoken),
          })),
        }),
    ...(verdict === "REJECT" ? { runbook } : {}),
    ranAt,
  };
  const index = receipts.gates.findIndex((item) => item.gate === gate && item.stage === "BUILD");
  if (index === -1) receipts.gates.push(row);
  else receipts.gates[index] = row;
  return row;
}

export function appendCompletedPurges(
  receipts,
  purgeResults,
  reason,
  purgedAt = new Date().toISOString(),
) {
  for (const result of purgeResults) {
    if (result.status !== "PURGED" || !result.cacheKey) continue;
    const row = { cacheKey: result.cacheKey, segment: result.segment, reason, purgedAt };
    const index = receipts.purges.findIndex(
      (item) => item.cacheKey === row.cacheKey && item.segment === row.segment && item.reason === row.reason,
    );
    if (index === -1) receipts.purges.push(row);
    else receipts.purges[index] = row;
  }
}

function containsAbsolutePath(value) {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return true;
  if (/file:\/\//i.test(value)) return true;
  if (/(?:^|[\s=("'`:,])\/(?!\/)[^\s"'`)]/.test(value)) return true;
  if (/(?:^|[\s=("'`:,])[A-Za-z]:[\\/]/.test(value)) return true;
  return /(?:^|[\s=("'`:,])(?:\\\\|\/\/)[^\\/\s]+[\\/]/.test(value);
}

function assertPortable(value, pointer = "$") {
  if (typeof value === "string") {
    if (containsAbsolutePath(value)) {
      throw new Error(`receipts sidecar contains a forbidden absolute path at ${pointer}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPortable(item, `${pointer}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertPortable(item, `${pointer}.${key}`);
  }
}

export function writeBuildReceipts(outputPath, receipts, htmlCandidate = "") {
  receipts.artifactSha256 = sha256(htmlCandidate);
  assertPortable(receipts);
  const receiptsPath = buildReceiptsPath(outputPath);
  mkdirSync(path.dirname(receiptsPath), { recursive: true });
  const temporaryPath = `${receiptsPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(receipts, null, 2)}\n`);
  renameSync(temporaryPath, receiptsPath);
  return receiptsPath;
}
