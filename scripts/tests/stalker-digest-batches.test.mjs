import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  assertExactBatchCoverage,
  runDigestMaps,
  splitDigestBatches,
} from "../stalker-digest-batches.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("partitions/maps by bytes without dropping or reordering items", async () => {
  const root = join(process.cwd(), `.test-stalker-digest-batches-${process.pid}`);
  const workDir = join(root, ".digest-work");
  roots.push(root);
  await mkdir(workDir, { recursive: true });
  const items = Array.from({ length: 7 }, (_, index) => ({ timestamp: `0${index}:00`, text: "x".repeat(30) }));
  const batches = splitDigestBatches(items, 100);
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat().map(({ timestamp }) => timestamp), items.map(({ timestamp }) => timestamp));
  const calls = [];
  const results = await runDigestMaps({
    items,
    maxBatchBytes: 100,
    concurrency: 2,
    workDir,
    mapSchema: { type: "object" },
    inputForBatch: (batch) => JSON.stringify(batch),
    validateResult: (value, batch) => ({ ...value, timestamps: batch.map(({ timestamp }) => timestamp) }),
    runImpl: async (request) => {
      calls.push(request);
      await writeFile(request.outputPath, JSON.stringify({ label: request.diagnosticLabel }));
    },
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    timeoutMs: 180_000,
  });
  assert.deepEqual(results.flatMap(({ timestamps }) => timestamps), items.map(({ timestamp }) => timestamp));
  assert.equal(new Set(calls.map(({ diagnosticLabel }) => diagnosticLabel)).size, batches.length);
});

test("coverage requires every batch timestamp exactly once and in order", () => {
  const batch = [{ timestamp: "00:00" }, { timestamp: "00:30" }];
  assert.doesNotThrow(() => assertExactBatchCoverage(["00:00", "00:30"], batch));
  assert.throws(() => assertExactBatchCoverage(["00:00"], batch), /coverage mismatch/);
  assert.throws(() => assertExactBatchCoverage(["00:00", "00:00"], batch), /coverage mismatch/);
  assert.throws(() => assertExactBatchCoverage(["00:30", "00:00"], batch), /coverage mismatch/);
});

test("invalid model output gets one corrective retry without repeating valid batches", async () => {
  const workDir = join(process.cwd(), `.test-stalker-digest-batches-${process.pid}-retry`);
  roots.push(workDir);
  const calls = [];
  const request = {
    items: [{timestamp: '00:00'}, {timestamp: '00:10'}], maxBatchBytes: 25, concurrency: 1, workDir,
    mapSchema: {}, inputForBatch: batch => JSON.stringify(batch),
    validateResult: value => { if (!value.valid) throw new Error('excerpt is not grounded'); return value; },
    runImpl: async ({input, outputPath, diagnosticLabel}) => {
      calls.push({input, diagnosticLabel});
      await writeFile(outputPath, JSON.stringify({valid: diagnosticLabel.endsWith('001') || diagnosticLabel.endsWith('-retry')}));
    },
  };
  assert.equal((await runDigestMaps(request)).length, 2);
  assert.deepEqual(calls.map(({diagnosticLabel}) => diagnosticLabel), ['human-digest-map-001', 'human-digest-map-002', 'human-digest-map-002-retry']);
  assert.match(calls[2].input, /excerpt is not grounded/);
  calls.length = 0;
  request.runImpl = async ({outputPath}) => { calls.push({}); await writeFile(outputPath, '{"valid":false}'); };
  await assert.rejects(runDigestMaps(request), /not grounded/);
  assert.equal(calls.length, 2);
});

test("waits for in-flight workers after the first failure and schedules no more", async () => {
  const root = join(process.cwd(), `.test-stalker-digest-batches-${process.pid}-failure`);
  const workDir = join(root, ".digest-work");
  roots.push(root);
  await mkdir(workDir, { recursive: true });
  let startSecond;
  let releaseSecond;
  const secondStarted = new Promise((resolve) => { startSecond = resolve; });
  const secondRelease = new Promise((resolve) => { releaseSecond = resolve; });
  const failure = new Error("first map failed");
  const calls = [];
  let secondSettled = false;
  const running = runDigestMaps({
    items: Array.from({ length: 3 }, (_, index) => ({ timestamp: `0${index}:00`, text: "x".repeat(30) })),
    maxBatchBytes: 60,
    concurrency: 2,
    workDir,
    mapSchema: { type: "object" },
    inputForBatch: JSON.stringify,
    validateResult: (value) => value,
    runImpl: async ({ diagnosticLabel, outputPath }) => {
      calls.push(diagnosticLabel);
      if (diagnosticLabel === "human-digest-map-001") {
        await secondStarted;
        throw failure;
      }
      startSecond();
      await secondRelease;
      secondSettled = true;
      await writeFile(outputPath, "{}");
    },
  });
  await secondStarted;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondSettled, false);
  assert.deepEqual(calls, ["human-digest-map-001", "human-digest-map-002"]);
  releaseSecond();
  await assert.rejects(running, (error) => error === failure);
  assert.equal(secondSettled, true);
  assert.deepEqual(calls, ["human-digest-map-001", "human-digest-map-002"]);
});
