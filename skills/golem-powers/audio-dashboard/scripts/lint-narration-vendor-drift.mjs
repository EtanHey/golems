#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyVendorDrift,
  formatTypedRecord,
  isExpectedUpstreamCheckout,
  observeVendorState,
  parseVendorDriftArgs,
  parseVendorStamp,
  refreshVendorStamp,
} from "../src/narration-vendor-drift.mjs";

const skillRoot = path.resolve(import.meta.dir, "..");
const stampPath = path.join(skillRoot, "vendor", "narrationlayer", "VENDOR-VERSION");
let cliArgs;
try {
  cliArgs = parseVendorDriftArgs(process.argv.slice(2));
} catch (error) {
  process.stdout.write(
    `${formatTypedRecord({
      gate: "NARRATION_VENDOR_DRIFT",
      verdict: "REJECTED",
      pairId: "arguments",
      sourcePath: "<cli>",
      vendorPath: "vendor/narrationlayer/VENDOR-VERSION",
      target: "vendor/narrationlayer/VENDOR-VERSION",
      metric: "ARGUMENT_INVALID",
      value: "invalid",
      threshold: "no arguments, or --refresh-stamp --resolve-open-debt",
      evidence: error instanceof Error ? error.message : String(error),
      runbook: "Use both refresh flags together after committing and testing the upstream synchronization.",
    })}\n`,
  );
  process.exit(1);
}
const parsed = parseVendorStamp(existsSync(stampPath) ? readFileSync(stampPath, "utf8") : undefined);

if (!parsed.ok) {
  process.stdout.write(`${formatTypedRecord(parsed.record)}\n`);
  process.exit(1);
}

const configuredUpstream = process.env.NARRATIONLAYER_UPSTREAM?.trim();
const upstreamRoot = configuredUpstream ? path.resolve(configuredUpstream) : undefined;
const upstreamAvailable = Boolean(
  upstreamRoot && (await isExpectedUpstreamCheckout(upstreamRoot, parsed.stamp)),
);
let stamp = parsed.stamp;
const refreshRecords = [];
if (cliArgs.refreshStamp) {
  if (!upstreamAvailable) {
    refreshRecords.push({
      gate: "NARRATION_VENDOR_DRIFT",
      verdict: "REJECTED",
      pairId: "manifest",
      sourcePath: "<env:NARRATIONLAYER_UPSTREAM>",
      vendorPath: "vendor/narrationlayer/VENDOR-VERSION",
      target: "vendor/narrationlayer/VENDOR-VERSION",
      metric: "STAMP_REFRESH_REJECTED",
      value: "upstream unavailable, stamp-only",
      threshold: "clean committed upstream checkout",
      evidence: "The manifest was not changed because refresh requires full upstream verification.",
      runbook: "Set NARRATIONLAYER_UPSTREAM to the clean synchronized checkout, then rerun both refresh flags.",
    });
  } else {
    try {
      const refreshed = await refreshVendorStamp({
        skillRoot,
        upstreamRoot,
        stampPath,
        stamp,
      });
      stamp = refreshed.stamp;
      refreshRecords.push({
        gate: "NARRATION_VENDOR_DRIFT",
        verdict: "PASS",
        pairId: "manifest",
        sourcePath: "<env:NARRATIONLAYER_UPSTREAM>",
        vendorPath: "vendor/narrationlayer/VENDOR-VERSION",
        target: "vendor/narrationlayer/VENDOR-VERSION",
        metric: "STAMP_REFRESHED",
        value: stamp.upstream.commit,
        threshold: "clean committed upstream + required patterns + targeted tests",
        evidence: `${refreshed.tests.length} vendor-first debt test command(s) passed before atomic replacement.`,
        runbook: "Commit the refreshed stamp with the reconciled vendored runtime.",
      });
    } catch (error) {
      refreshRecords.push({
        gate: "NARRATION_VENDOR_DRIFT",
        verdict: "REJECTED",
        pairId: "manifest",
        sourcePath: "<env:NARRATIONLAYER_UPSTREAM>",
        vendorPath: "vendor/narrationlayer/VENDOR-VERSION",
        target: "vendor/narrationlayer/VENDOR-VERSION",
        metric: "STAMP_REFRESH_REJECTED",
        value: "unchanged",
        threshold: "clean committed upstream + required patterns + targeted tests",
        evidence: error instanceof Error ? error.message : String(error),
        runbook: "Repair the rejected precondition; the existing stamp was not replaced.",
      });
    }
  }
}
const observed = await observeVendorState({
  skillRoot,
  upstreamRoot: upstreamAvailable ? upstreamRoot : undefined,
  stamp,
});
const result = classifyVendorDrift(stamp, observed, { upstreamAvailable });
const records = [...refreshRecords, ...result.records];
const verdict = records.some((record) => record.verdict === "REJECTED")
  ? "REJECTED"
  : result.verdict;

for (const record of records) process.stdout.write(`${formatTypedRecord(record)}\n`);
process.stdout.write(
  `${formatTypedRecord({
    gate: "NARRATION_VENDOR_DRIFT",
    verdict,
    pairId: "summary",
    sourcePath: "<env:NARRATIONLAYER_UPSTREAM>",
    vendorPath: "vendor/narrationlayer",
    target: "vendor/narrationlayer",
    metric: "SUMMARY",
    value: records.filter((record) => record.verdict === "REJECTED").length,
    threshold: 0,
    evidence: `${records.length} typed record(s) emitted.`,
    runbook: verdict === "REJECTED" ? "Resolve every rejected record, then rerun this command." : "No repair required.",
  })}\n`,
);
process.exit(verdict === "REJECTED" ? 1 : 0);
