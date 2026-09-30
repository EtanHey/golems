// Deterministic replay gate for fleet-wrap-gate (gen-18 Track 1 #6).
// Pinned RED (terminal-state cron-still-armed) + GREEN (cron-count=0 / N-A)
// transcript fixtures ARE the replayable gate — same fixtures in → same pass/fail
// out (R-003/R-014 pattern, T6 smoke-spec shape). Runs under `bun test` and
// `node --test`.

import { test, expect, setDefaultTimeout } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectFleetWrap } from "../../src/fleet-wrap-gate.mjs";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

const here = path.dirname(fileURLToPath(new URL("../fleet-wrap-gate.test.mjs", import.meta.url).href));
const redDir = path.join(here, "fixtures", "red");
const greenDir = path.join(here, "fixtures", "green");

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);

// ── FLEETWRAP_CLEANUP_RECEIPT_MISSING (cleanliness standard Mechanism 1) ─────
// Advisory only: a lane DONE report (PR merged or handed off, a written
// DONE_<ID> marker, or a DONE line with a PR URL) must carry a CLEANUP RECEIPT.

const RECEIPT = [
  "CLEANUP RECEIPT",
  "- worktree: .worktrees/x kept because PR #88 awaits lead merge",
  "- branch: feat/x kept because PR #88 awaits lead merge",
  "- files this PR added outside src/tests: none",
  "- docs.local this lane created: none",
].join("\n");

function receiptCodes(transcript, options) {
  return detectFleetWrap(transcript, options).violations.map((v) => v.code);
}

// ── Round 2 (cx9 REQUEST_CHANGES at 9240eda7) ────────────────────────────────

const cli = path.join(here, "..", "scripts", "fleet-wrap-gate-cli.mjs");
const runCli = (fixture) => spawnSync(process.execPath, [cli, fixture], { encoding: "utf8", timeout: 5_000 });

const realWatch = greens.find(fx => fx.file === "26-real-orc-watch-task-state.json");

const watchCommand = realWatch.events[0].tools[0].input.command;

const simpleWatch = 'f=collab/topic.md; while true; do sleep 10; if grep -q "event" "$f"; then exit 0; fi; done';

export { test, expect, setDefaultTimeout, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, spawnSync, tmpdir, fileURLToPath, path, detectFleetWrap, here, redDir, greenDir, loadFixtures, reds, greens, RECEIPT, receiptCodes, cli, runCli, realWatch, watchCommand, simpleWatch };
