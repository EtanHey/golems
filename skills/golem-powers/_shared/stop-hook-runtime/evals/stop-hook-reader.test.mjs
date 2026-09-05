import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadStopHookContext,
  MAX_STATE_FILES,
  MAX_STATE_FILE_BYTES,
  StopHookInputError,
} from "../stop-hook-reader.mjs";
import { detectFalseGreen } from "../../../false-green-gate/src/false-green-gate.mjs";
import { detectIdleDwell } from "../../../idle-dwell-gate/src/idle-dwell-gate.mjs";
import { materializeOversizeTranscript, readFixture } from "./helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures");
const scratch = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

test("bounded reader evaluates the JSONL tail instead of silently allowing an oversized transcript", () => {
  const fixture = readFixture(path.join(fixtureRoot, "oversize-tail.json"));
  const root = mkdtempSync(path.join(tmpdir(), "stop-hook-reader-"));
  scratch.push(root);
  const transcriptPath = path.join(root, "oversize.jsonl");
  const totalBytes = materializeOversizeTranscript(transcriptPath, fixture);

  const context = loadStopHookContext({ transcript_path: transcriptPath });
  const result = detectFalseGreen(context.transcript);
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((item) => item.code)).toContain(fixture.expectedReason);
  expect(context.receipt.transcriptTail).toBe(true);
  expect(context.receipt.transcriptBytesTotal).toBe(totalBytes);
  expect(context.receipt.transcriptBytesRead).toBeLessThan(totalBytes);
  expect(context.receipt.transcriptBytesRead).toBeGreaterThan(0);
});

test("bounded reader returns top-level durable state to the detector", () => {
  const fixture = readFixture(path.join(fixtureRoot, "durable-state.json"));
  const context = loadStopHookContext({
    transcript: fixture.transcript,
    state: fixture.state,
  });
  const result = detectIdleDwell(context.transcript, { state: context.state });
  expect(result.hookDecision).toBe("block");
  expect(result.violations.map((item) => item.code)).toContain(fixture.expectedReason);
});

test("bounded reader loads durable state from an explicit state path and accounts for its bytes", () => {
  const fixture = readFixture(path.join(fixtureRoot, "durable-state.json"));
  const root = mkdtempSync(path.join(tmpdir(), "stop-hook-state-"));
  scratch.push(root);
  const statePath = path.join(root, "state.json");
  const stateText = `${JSON.stringify(fixture.state)}\n`;
  writeFileSync(statePath, stateText, "utf8");

  const context = loadStopHookContext({
    transcript: fixture.transcript,
    state_path: statePath,
  });
  const result = detectIdleDwell(context.transcript, { state: context.state });
  expect(result.hookDecision).toBe("block");
  expect(result.violations.map((item) => item.code)).toContain(fixture.expectedReason);
  expect(context.receipt.stateBytesRead).toBe(Buffer.byteLength(stateText));
  expect(context.receipt.bytesRead).toBe(Buffer.byteLength(stateText));
});

test("bounded reader reports a malformed explicit state file instead of silently allowing", () => {
  const fixture = readFixture(path.join(fixtureRoot, "durable-state.json"));
  const root = mkdtempSync(path.join(tmpdir(), "stop-hook-state-error-"));
  scratch.push(root);
  const statePath = path.join(root, "state.json");
  writeFileSync(statePath, "{not-json}\n", "utf8");

  expect(() => loadStopHookContext({
    transcript: fixture.transcript,
    state_path: statePath,
  })).toThrow(StopHookInputError);
  try {
    loadStopHookContext({ transcript: fixture.transcript, state_path: statePath });
  } catch (error) {
    expect(error.code).toBe("invalid-input");
    expect(error.receipt.stateBytesRead).toBe(Buffer.byteLength("{not-json}\n"));
  }
});

test("task discovery bounds attempted JSON files even when oversized files are skipped", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stop-hook-task-bound-"));
  scratch.push(root);
  for (let index = 0; index < MAX_STATE_FILES; index += 1) {
    const batch = path.join(root, `batch-${Math.floor(index / 100)}`);
    mkdirSync(batch, { recursive: true });
    const filePath = path.join(batch, `oversized-${String(index).padStart(3, "0")}.json`);
    writeFileSync(filePath, "", "utf8");
    truncateSync(filePath, MAX_STATE_FILE_BYTES + 1);
  }
  const finalBatch = path.join(root, "batch-2");
  mkdirSync(finalBatch);
  writeFileSync(
    path.join(finalBatch, "would-exceed-bound.json"),
    JSON.stringify({ id: "too-late", status: "running" }),
    "utf8",
  );

  const context = loadStopHookContext({ transcript: { result: "in progress" }, tasks_dir: root });
  expect(context.receipt.stateFilesAttempted).toBe(MAX_STATE_FILES);
});

test("task discovery rejects dot-segment session ids instead of escaping tasks_dir", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stop-hook-session-scope-"));
  scratch.push(root);
  const tasksDir = path.join(root, "tasks");
  mkdirSync(tasksDir);
  const otherSessionDir = path.join(tasksDir, "other-session");
  mkdirSync(otherSessionDir);
  writeFileSync(
    path.join(otherSessionDir, "other-session.json"),
    JSON.stringify({ id: "other-session-task", status: "running" }),
    "utf8",
  );
  writeFileSync(
    path.join(root, "unrelated.json"),
    JSON.stringify({ id: "outside-tasks-dir", status: "running" }),
    "utf8",
  );

  const context = loadStopHookContext({
    transcript: { result: "in progress" },
    tasks_dir: tasksDir,
    session_id: "..",
  });
  expect(context.state.tasks).toEqual([]);
  expect(context.receipt.stateFilesAttempted).toBe(0);
});
