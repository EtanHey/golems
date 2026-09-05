import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildDashboard,
  execute,
  parseGems,
  runMorningDigest,
} from "../stalker-morning-digest.mjs";

const GEMS = `# Gems: theo (2026-08-27)

### [95:25] Segment 139 (60s) Surprising Truth Behind Ox Alpha Model Revealed
**Score:** 7/10 | **Type:** take
**Gist:** Theo reveals the model and its cost-performance.
**Volume spike:** yes

**Transcript:** Ox Alpha is GLM 5.3 Flash.

### [148:24] Segment 226 (40s) Absurd Value For The Money
**Score:** 9/10 | **Type:** hype
**Gist:** Theo praises the model's value.

**Transcript:** This model is absurdly good for the money.

---
Gems found: 2
Candidate segments scored: 2
Skipped non-candidates: 0
Scoring failures: 0
Scored: Thu Aug 27 06:50:52 IDT 2026
`;

test("parseGems preserves timestamps, scores, titles, types, and spike flags", () => {
  const gems = parseGems(GEMS);
  assert.equal(gems.length, 2);
  assert.deepEqual(gems[0], {
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

test("buildDashboard emits a usable filtered dashboard with clip URLs", () => {
  const html = buildDashboard({
    date: "2026-08-27",
    runs: [{ name: "theo-2026-08-27-011522", chatLines: 4612 }],
    gems: parseGems(GEMS).map((gem) => ({
      ...gem,
      runName: "theo-2026-08-27-011522",
      clip: `clip-${gem.timestamp.split(":")[0]}m${gem.timestamp.split(":")[1]}s.mp4`,
      frame: null,
    })),
  });
  assert.match(html, /Theo — 27 Aug 2026/);
  assert.match(html, /data-score="9"/);
  assert.match(html, /assets\/theo-2026-08-27-011522\/clip-148m24s\.mp4/);
  assert.match(html, /button\.dataset\.f/);
  assert.match(html, /\.gem\[hidden\]\{display:none\}/);
});

test("runMorningDigest publishes, receipts, and skips duplicate delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "stalker-morning-"));
  const repoRoot = join(root, "golems");
  const orchestratorRoot = join(root, "orchestrator");
  const stalkerRoot = join(repoRoot, "docs.local/stalker-golem");
  const runDir = join(stalkerRoot, "theo-2026-08-27-011522");
  await mkdir(join(stalkerRoot, "ben-2026-08-27-071500"), { recursive: true });
  await mkdir(join(runDir, "frames"), { recursive: true });
  await mkdir(join(runDir, "clips"), { recursive: true });
  await writeFile(join(runDir, "gems.md"), GEMS);
  await writeFile(join(runDir, "chat.log"), "one\ntwo\n");
  await writeFile(join(runDir, "clips/clip-95m25s.mp4"), "clip");
  await writeFile(join(runDir, "clips/clip-148m24s.mp4"), "clip");
  await writeFile(join(runDir, ".stage-process.done"), "");
  await writeFile(join(runDir, ".stage-scoring.done"), "");

  const first = await runMorningDigest({
    date: "2026-08-27",
    force: false,
    notify: false,
    sync: false,
    verifyLive: false,
    repoRoot,
    orchestratorRoot,
  });
  assert.equal(first.status, "success");
  assert.equal(first.gemCount, 2);

  const dashboardPath = join(
    orchestratorRoot,
    "docs.local/dashboards-serve/stalker/2026-08-27.html",
  );
  const dashboard = await readFile(dashboardPath, "utf8");
  assert.match(dashboard, /Absurd Value For The Money/);
  assert.match(dashboard, /clips\/clip-148m24s\.mp4/);
  const assets = await readFile(
    join(stalkerRoot, "LAST-RUN.json"),
    "utf8",
  ).then(JSON.parse);
  assert.equal(assets.status, "success");
  assert.equal(assets.digest_path, join(stalkerRoot, "digests/2026-08-27.md"));
  assert.equal(
    assets.dashboard_url,
    "https://dashboards.example.invalid/stalker/2026-08-27.html",
  );

  const linkedRun = join(
    orchestratorRoot,
    "docs.local/dashboards-serve/stalker/assets/theo-2026-08-27-011522",
  );
  assert.equal(await readFile(join(linkedRun, "gems.md"), "utf8"), GEMS);

  await rm(dashboardPath);
  const repaired = await runMorningDigest({
    date: "2026-08-27",
    force: false,
    notify: false,
    sync: false,
    verifyLive: false,
    repoRoot,
    orchestratorRoot,
  });
  assert.equal(repaired.status, "success");

  const second = await runMorningDigest({
    date: "2026-08-27",
    force: false,
    notify: false,
    sync: false,
    verifyLive: false,
    repoRoot,
    orchestratorRoot,
  });
  assert.equal(second.status, "skipped");

  await assert.rejects(
    runMorningDigest({
      date: "2026-08-27",
      force: true,
      notify: true,
      notifyImpl: async () => { throw new Error("notify offline"); },
      sync: false,
      verifyLive: false,
      repoRoot,
      orchestratorRoot,
    }),
    /notify offline/,
  );
  assert.equal(
    JSON.parse(await readFile(join(stalkerRoot, "LAST-RUN.json"), "utf8")).status,
    "failed",
  );
  const retry = await runMorningDigest({
    date: "2026-08-27",
    force: false,
    notify: false,
    sync: false,
    verifyLive: true,
    fetchImpl: async () => new Response(
      "<title>Theo · 27 Aug 2026 — 2 gems</title>",
      { status: 200 },
    ),
    repoRoot,
    orchestratorRoot,
  });
  assert.equal(retry.status, "success");

  let verifiedUrl;
  await assert.rejects(
    runMorningDigest({
      date: "2026-08-27",
      dashboardBase: "https://m1.tail.example/stalker",
      force: true,
      notify: false,
      sync: false,
      verifyLive: true,
      fetchImpl: async (url) => {
        verifiedUrl = url;
        return new Response("unavailable", { status: 500 });
      },
      repoRoot,
      orchestratorRoot,
    }),
    /live dashboard verification failed: HTTP 500/,
  );
  assert.equal(verifiedUrl, "https://m1.tail.example/stalker/2026-08-27.html");
  assert.equal(
    JSON.parse(await readFile(join(stalkerRoot, "LAST-RUN.json"), "utf8")).status,
    "failed",
  );
});

test("runMorningDigest writes a failed LAST-RUN receipt when no complete gems exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "stalker-morning-empty-"));
  const repoRoot = join(root, "golems");
  const orchestratorRoot = join(root, "orchestrator");
  await mkdir(join(repoRoot, "docs.local/stalker-golem"), { recursive: true });
  let notifications = 0;

  await assert.rejects(
    runMorningDigest({
      date: "2026-08-27",
      force: true,
      notify: true,
      notifyImpl: async () => { notifications += 1; },
      now: new Date("2026-08-27T03:00:00Z"),
      sync: false,
      verifyLive: false,
      repoRoot,
      orchestratorRoot,
    }),
    /no completed Stalker gems/,
  );
  const receipt = JSON.parse(
    await readFile(join(repoRoot, "docs.local/stalker-golem/LAST-RUN.json"), "utf8"),
  );
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.digest_path, "");
  assert.equal(receipt.dashboard_url, "");
  assert.equal(notifications, 0, "RunAtLoad before 07:30 IDT should log, not page");

  await assert.rejects(
    runMorningDigest({
      date: "2026-08-27",
      force: true,
      notify: true,
      notifyImpl: async () => { notifications += 1; },
      now: new Date("2026-08-27T05:00:00Z"),
      sync: false,
      verifyLive: false,
      repoRoot,
      orchestratorRoot,
    }),
    /no completed Stalker gems/,
  );
  assert.equal(notifications, 1, "07:30-or-later failure should page once");
});

test("execute terminates a stuck child at the configured deadline", async () => {
  const started = Date.now();
  await assert.rejects(
    execute("/bin/sleep", ["5"], undefined, 50),
    /timed out after 50ms/,
  );
  assert.ok(Date.now() - started < 2000);
});
