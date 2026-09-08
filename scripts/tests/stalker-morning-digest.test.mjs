import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";

import { parseGems, runMorningDigest } from "../stalker-morning-digest.mjs";

const DATE = "2026-09-08";
const GEMS = `# Gems: theo (${DATE})

### [95:25] Segment 139 (60s) Surprising Truth Behind Ox Alpha Model Revealed
**Score:** 7/10 | **Type:** take
**Gist:** Theo reveals the model and its cost-performance.
**Volume spike:** yes

### [148:24] Segment 226 (40s) Absurd Value For The Money
**Score:** 9/10 | **Type:** hype
**Gist:** Theo praises the model's value.

Scored: Tue Sep 8 06:50:52 IDT 2026
`;

async function setup(t, name) {
  const root = join(import.meta.dirname, `.stalker-morning-${process.pid}-${name}`);
  await rm(root, { recursive: true, force: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, "golems");
  const stalkerRoot = join(repoRoot, "docs.local/stalker-golem");
  await mkdir(stalkerRoot, { recursive: true });
  return { repoRoot, stalkerRoot, receiptPath: join(stalkerRoot, "LAST-RUN.json") };
}

async function eligibleRun(stalkerRoot, name) {
  const runDir = join(stalkerRoot, name);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, ".stage-process.done"), "done\n");
  await writeFile(join(runDir, ".stage-scoring.done"), "done\n");
  return runDir;
}

function verified(runDir, skipped = false) {
  const runName = basename(runDir);
  return {
    status: "complete",
    runName,
    dashboardUrl: `https://hub.example.test/dashboards/golems/stalker/${runName}.html`,
    ...(skipped ? { skipped: true } : {}),
  };
}

test("parseGems preserves timestamps, scores, titles, types, and spike flags", () => {
  assert.deepEqual(parseGems(GEMS)[0], {
    timestamp: "95:25",
    seconds: 5725,
    title: "Surprising Truth Behind Ox Alpha Model Revealed",
    score: 7,
    type: "take",
    gist: "Theo reveals the model and its cost-performance.",
    volumeSpike: true,
    chatSpike: false,
  });
});

test("checks every eligible run on every invocation and includes a later same-day run", async (t) => {
  const { repoRoot, stalkerRoot, receiptPath } = await setup(t, "later-run");
  await eligibleRun(stalkerRoot, `theo-${DATE}`);
  await eligibleRun(stalkerRoot, `theo-${DATE}-030512`);
  await eligibleRun(stalkerRoot, `theo-${DATE}-081500`);
  await mkdir(join(stalkerRoot, `theo-${DATE}-unfinished`), { recursive: true });
  await eligibleRun(stalkerRoot, "theo-2026-09-07-235959");
  await writeFile(receiptPath, JSON.stringify({
    status: "success",
    dashboard_url: `https://legacy.invalid/stalker/${DATE}.html`,
  }));

  const calls = [];
  const completeImpl = async (runDir) => {
    calls.push(basename(runDir));
    return verified(runDir, calls.filter((name) => name === basename(runDir)).length > 1);
  };
  const first = await runMorningDigest({ date: DATE, repoRoot, completeImpl });
  assert.equal(first.status, "complete");
  assert.deepEqual(calls, [`theo-${DATE}`, `theo-${DATE}-030512`, `theo-${DATE}-081500`]);

  await eligibleRun(stalkerRoot, `theo-${DATE}-101501`);
  const second = await runMorningDigest({ date: DATE, repoRoot, completeImpl });
  assert.equal(second.status, "complete");
  assert.deepEqual(calls, [
    `theo-${DATE}`,
    `theo-${DATE}-030512`,
    `theo-${DATE}-081500`,
    `theo-${DATE}`,
    `theo-${DATE}-030512`,
    `theo-${DATE}-081500`,
    `theo-${DATE}-101501`,
  ]);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.deepEqual(receipt.runs.map((run) => run.run_name), [
    `theo-${DATE}`,
    `theo-${DATE}-030512`,
    `theo-${DATE}-081500`,
    `theo-${DATE}-101501`,
  ]);
});

test("pre-schedule absence is not success; post-schedule absence persists and alerts failure", async (t) => {
  const { repoRoot, receiptPath } = await setup(t, "no-runs");
  const notifications = [];
  const notifyImpl = async (...args) => { notifications.push(args); return { accepted: true }; };

  const early = await runMorningDigest({
    date: DATE,
    repoRoot,
    now: new Date("2026-09-08T03:00:00Z"),
    notifyImpl,
  });
  assert.equal(early.status, "not-ready");
  assert.equal(notifications.length, 0);
  await assert.rejects(readFile(receiptPath), { code: "ENOENT" });

  await assert.rejects(
    runMorningDigest({
      date: DATE,
      repoRoot,
      now: new Date("2026-09-08T05:00:00Z"),
      notifyImpl,
    }),
    /FAILED at stage 6: no eligible Stalker runs found/,
  );
  assert.match(notifications[0][0], /Stalker FAILED at stage 6/);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.stage, 6);
  assert.match(receipt.reason, /no eligible Stalker runs found/);
});

test("a run-level failure persists FAILED without a duplicate wrapper alert", async (t) => {
  const { repoRoot, stalkerRoot, receiptPath } = await setup(t, "run-failure");
  await eligibleRun(stalkerRoot, `theo-${DATE}-030512`);
  let wrapperNotifications = 0;
  await assert.rejects(
    runMorningDigest({
      date: DATE,
      repoRoot,
      completeImpl: async () => {
        throw Object.assign(new Error("Stalker FAILED at stage 7: manifest missing"), { stage: 7 });
      },
      notifyImpl: async () => { wrapperNotifications += 1; },
    }),
    /FAILED at stage 7: manifest missing/,
  );
  assert.equal(wrapperNotifications, 0);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.stage, 7);
  assert.equal(receipt.run_name, `theo-${DATE}-030512`);
});

test("legacy skip options are rejected before completion can be certified", async (t) => {
  const { repoRoot, stalkerRoot, receiptPath } = await setup(t, "disabled");
  await eligibleRun(stalkerRoot, `theo-${DATE}-030512`);
  let completions = 0;
  const completeImpl = async (runDir) => { completions += 1; return verified(runDir); };
  const notifications = [];
  const notifyImpl = async (...args) => { notifications.push(args); };

  for (const disabled of [
    { notify: false, expected: /stage 8.*notifications cannot be skipped/ },
    { sync: false, expected: /stage 7.*hub sync cannot be skipped/ },
    { verifyLive: false, expected: /stage 7.*live verification cannot be skipped/ },
  ]) {
    await assert.rejects(
      runMorningDigest({ date: DATE, repoRoot, completeImpl, notifyImpl, ...disabled }),
      disabled.expected,
    );
  }
  assert.equal(completions, 0);
  assert.equal(notifications.length, 3);
  assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).status, "failed");
});
