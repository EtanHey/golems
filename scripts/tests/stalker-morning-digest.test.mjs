import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { test, beforeEach, afterEach } from "node:test";

import { parseGems, runMorningDigest } from "../stalker/stalker-morning-digest.mjs";

let sends;
const notifyImpl = async (...args) => { sends.push(args); return {accepted: true}; };
beforeEach(() => { sends = []; });
afterEach(() => { assert.deepEqual(sends, []); });

const DATE = "2026-09-08";
const GEMS = `# Gems: examplechannel (${DATE})

### [95:25] Segment 139 (60s) Surprising Truth Behind Ox Alpha Model Revealed
**Score:** 7/10 | **Type:** take
**Gist:** The stream author reveals the model and its cost-performance.
**Volume spike:** yes

### [148:24] Segment 226 (40s) Absurd Value For The Money
**Score:** 9/10 | **Type:** hype
**Gist:** The stream author praises the model's value.

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
    gist: "The stream author reveals the model and its cost-performance.",
    volumeSpike: true,
    chatSpike: false,
  });
});

test("checks every eligible run on every invocation and includes a later same-day run", async (t) => {
  const { repoRoot, stalkerRoot, receiptPath } = await setup(t, "later-run");
  await eligibleRun(stalkerRoot, `examplechannel-${DATE}`);
  await eligibleRun(stalkerRoot, `examplechannel-${DATE}-030512`);
  await eligibleRun(stalkerRoot, `examplechannel-${DATE}-081500`);
  await mkdir(join(stalkerRoot, `examplechannel-${DATE}-unfinished`), { recursive: true });
  await eligibleRun(stalkerRoot, "examplechannel-2026-09-07-235959");
  await writeFile(receiptPath, JSON.stringify({
    status: "success",
    dashboard_url: `https://legacy.invalid/stalker/${DATE}.html`,
  }));

  const calls = [];
  const completeImpl = async (runDir) => {
    calls.push(basename(runDir));
    return verified(runDir, calls.filter((name) => name === basename(runDir)).length > 1);
  };
  const first = await runMorningDigest({ notifyImpl, date: DATE, repoRoot, completeImpl });
  assert.equal(first.status, "complete");
  assert.deepEqual(calls, [`examplechannel-${DATE}`, `examplechannel-${DATE}-030512`, `examplechannel-${DATE}-081500`]);

  await eligibleRun(stalkerRoot, `examplechannel-${DATE}-101501`);
  const second = await runMorningDigest({ notifyImpl, date: DATE, repoRoot, completeImpl });
  assert.equal(second.status, "complete");
  assert.deepEqual(calls, [
    `examplechannel-${DATE}`,
    `examplechannel-${DATE}-030512`,
    `examplechannel-${DATE}-081500`,
    `examplechannel-${DATE}`,
    `examplechannel-${DATE}-030512`,
    `examplechannel-${DATE}-081500`,
    `examplechannel-${DATE}-101501`,
  ]);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.deepEqual(receipt.runs.map((run) => run.run_name), [
    `examplechannel-${DATE}`,
    `examplechannel-${DATE}-030512`,
    `examplechannel-${DATE}-081500`,
    `examplechannel-${DATE}-101501`,
  ]);
});

test("pre-schedule absence is not success; post-schedule absence persists failure", async (t) => {
  const { repoRoot, receiptPath } = await setup(t, "no-runs");

  const early = await runMorningDigest({ notifyImpl,
    date: DATE,
    repoRoot,
    now: new Date("2026-09-08T03:00:00Z"),
  });
  assert.equal(early.status, "not-ready");
  await assert.rejects(readFile(receiptPath), { code: "ENOENT" });

  await assert.rejects(
    runMorningDigest({ notifyImpl,
      date: DATE,
      repoRoot,
      now: new Date("2026-09-08T05:00:00Z"),
      }),
    /FAILED at stage 6: no eligible Stalker runs found/,
  );
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.stage, 6);
  assert.match(receipt.reason, /no eligible Stalker runs found/);
});

test("a run-level failure persists FAILED without delivery", async (t) => {
  const { repoRoot, stalkerRoot, receiptPath } = await setup(t, "run-failure");
  await eligibleRun(stalkerRoot, `examplechannel-${DATE}-030512`);
  await assert.rejects(
    runMorningDigest({ notifyImpl,
      date: DATE,
      repoRoot,
      completeImpl: async () => {
        throw Object.assign(new Error("Stalker FAILED at stage 7: manifest missing"), { stage: 7 });
      },
    }),
    /FAILED at stage 7: manifest missing/,
  );
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.stage, 7);
  assert.equal(receipt.run_name, `examplechannel-${DATE}-030512`);
});

test("legacy skip options are rejected before completion can be certified", async (t) => {
  const { repoRoot, stalkerRoot, receiptPath } = await setup(t, "disabled");
  await eligibleRun(stalkerRoot, `examplechannel-${DATE}-030512`);
  let completions = 0;
  const completeImpl = async (runDir) => { completions += 1; return verified(runDir); };

  for (const disabled of [
    { sync: false, expected: /stage 7.*hub sync cannot be skipped/ },
    { verifyLive: false, expected: /stage 7.*live verification cannot be skipped/ },
  ]) {
    await assert.rejects(
      runMorningDigest({ notifyImpl, date: DATE, repoRoot, completeImpl, ...disabled }),
      disabled.expected,
    );
  }
  assert.equal(completions, 0);
  assert.equal(JSON.parse(await readFile(receiptPath, "utf8")).status, "failed");
});

test('retired skip-notify CLI option cannot certify completion', async t => {
  const {repoRoot, receiptPath} = await setup(t, 'retired-cli');
  const result = spawnSync(process.execPath, [new URL('../stalker/stalker-morning-digest.mjs', import.meta.url).pathname,
    '--skip-notify', '--date', DATE, '--repo-root', repoRoot], {
    encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME},
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /--skip-notify is retired/);
  await assert.rejects(readFile(receiptPath), {code: 'ENOENT'});
});
