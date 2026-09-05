import { existsSync, readFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const TAKE_CACHE_RECEIPT_VERSION = 1;

function receiptFor(segment, status, extra = {}) {
  return { segment, status, ...extra };
}

export function purgeRejectedTakeCaches({ artifacts = [], rejectedSegments = [], cacheDir } = {}) {
  const artifactById = new Map(artifacts.map((artifact) => [String(artifact.id), artifact]));
  const resolvedCacheDir = path.resolve(cacheDir ?? path.join(os.homedir(), ".narrationlayer", "tts-cache"));
  const receipts = [];
  const rejectionBySegment = new Map();
  for (const rejection of rejectedSegments) {
    const record = rejection && typeof rejection === "object" ? rejection : { segment: rejection };
    const segment = String(record.segment ?? record.id);
    const previous = rejectionBySegment.get(segment);
    rejectionBySegment.set(segment, {
      segment,
      sourceKind: previous?.sourceKind === "BYO" || record.sourceKind === "BYO" ? "BYO" : undefined,
    });
  }

  for (const { segment, sourceKind } of [...rejectionBySegment.values()].sort((a, b) => a.segment.localeCompare(b.segment))) {
    const artifact = artifactById.get(segment);
    if (sourceKind === "BYO" || artifact?.sourceKind === "BYO") {
      receipts.push(receiptFor(segment, "SKIP", { evidence: "BYO source is not managed by the TTS frozen-take cache" }));
      continue;
    }
    if (!artifact) {
      receipts.push(receiptFor(segment, "SKIP", { evidence: "rejected segment has no artifact record" }));
      continue;
    }
    const cacheReceiptPath = artifact.cacheReceiptPath ?? (artifact.wav ? `${artifact.wav}.cache.json` : undefined);
    if (!cacheReceiptPath || !existsSync(cacheReceiptPath)) {
      receipts.push(receiptFor(segment, "SKIP", { evidence: "cache receipt missing (BYO audio or pre-D6d take)" }));
      continue;
    }

    let metadata;
    try {
      metadata = JSON.parse(readFileSync(cacheReceiptPath, "utf8"));
    } catch (error) {
      receipts.push(receiptFor(segment, "ERROR", { evidence: `cache receipt unreadable: ${error?.message || error}` }));
      continue;
    }
    const cacheKey = String(metadata?.cacheKey ?? "");
    if (metadata?.version !== TAKE_CACHE_RECEIPT_VERSION || !/^[a-f0-9]{64}$/.test(cacheKey)) {
      receipts.push(receiptFor(segment, "ERROR", { evidence: "cache receipt has an unsupported version or unsafe key" }));
      continue;
    }

    const cachePath = path.join(resolvedCacheDir, `${cacheKey}.wav`);
    if (!existsSync(cachePath)) {
      receipts.push(receiptFor(segment, "MISSING", { cacheKey, cachePath, evidence: "frozen take already absent" }));
      continue;
    }
    try {
      unlinkSync(cachePath);
      receipts.push(receiptFor(segment, "PURGED", { cacheKey, cachePath, evidence: "rejected frozen take removed" }));
    } catch (error) {
      receipts.push(
        receiptFor(segment, "ERROR", {
          cacheKey,
          cachePath,
          evidence: `failed to remove rejected frozen take: ${error?.message || error}`,
        }),
      );
    }
  }
  return receipts;
}

export function formatCachePurgeReceipt(receipt) {
  return (
    `CACHE_PURGE segment=${receipt.segment} status=${receipt.status} key=${receipt.cacheKey ?? "n/a"} ` +
    `path=${JSON.stringify(receipt.cachePath ?? "n/a")} evidence=${JSON.stringify(receipt.evidence ?? "n/a")}`
  );
}
