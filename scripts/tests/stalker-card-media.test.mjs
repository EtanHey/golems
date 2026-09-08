import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { prepareCardMedia } from "../stalker-card-media.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(name) {
  const runDir = join(process.cwd(), `.test-stalker-card-media-${process.pid}-${name}`);
  roots.push(runDir);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "video.mp4"), "source-video");
  await writeFile(join(runDir, "transcript.md"), [
    "## [0:05] Segment 1 (10s)", "Opening evidence.",
    "## [1:30] Segment 2 (15s)", "Closing evidence.",
  ].join("\n"));
  const first = { timestamp: "0:05", title: "Opening", summary: "Summary", excerpt: "Opening evidence.", uncertain: false };
  const last = { timestamp: "1:30", title: "Closing", summary: "Summary", excerpt: "Closing evidence.", uncertain: false };
  return { runDir, summary: { topics: [first], highlights: [first, last], claims: [{ ...last, claim: "Claim" }] } };
}

async function writePlan(runDir, ends, overrides = {}) {
  const transcript = await readFile(join(runDir, "transcript.md"));
  const plan = {
    version: 1,
    transcriptSha256: createHash("sha256").update(transcript).digest("hex"),
    ends,
    ...overrides,
  };
  const bytes = `${JSON.stringify(plan, null, 2)}\n`;
  await writeFile(join(runDir, ".stalker-clip-windows.json"), bytes);
  return { plan, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function fakes({ invalidClip = false, fail = false, sourceDuration = 220 } = {}) {
  const calls = [];
  const clipDurations = new Map();
  return {
    calls,
    ffmpegImpl: async (request) => {
      calls.push(request);
      if (fail) throw new Error("synthetic ffmpeg failure");
      if (request.kind === "clip") {
        clipDurations.set(request.bounds.evidenceSeconds, request.bounds.endSeconds - request.bounds.startSeconds);
      }
      await writeFile(request.outputPath, request.kind === "clip" ? "encoded-clip" : "jpeg-poster");
    },
    ffprobeImpl: async ({ path }) => {
      if (path.endsWith("video.mp4")) return { durationSeconds: sourceDuration };
      const match = /(?:clip-|\.)([0-9]+)m([0-9]+)s(?:-|\.)/.exec(path);
      const evidenceSeconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
      return {
        durationSeconds: invalidClip ? 1 : clipDurations.get(evidenceSeconds),
        videoCodec: invalidClip ? "vp9" : "h264",
        audioCodec: "aac",
        width: 1280,
        height: 720,
      };
    },
  };
}

test("defaults to 20 seconds of lead-in and 90 seconds of follow-up", async () => {
  const { runDir, summary } = await fixture("bounds");
  const fake = fakes({ sourceDuration: 180 });
  const result = await prepareCardMedia({ runDir, summary, ...fake });
  assert.deepEqual(result.items.map(({ timestamp, startSeconds, endSeconds, evidenceSeconds }) =>
    ({ timestamp, startSeconds, endSeconds, evidenceSeconds })), [
    { timestamp: "0:05", startSeconds: 0, endSeconds: 105, evidenceSeconds: 5 },
    { timestamp: "1:30", startSeconds: 70, endSeconds: 180, evidenceSeconds: 90 },
  ]);
  assert.equal(fake.calls.filter(({ kind }) => kind === "clip").length, 2);
  assert.match(result.items[0].clip, /^card-media-v2\/clips\/clip-0m5s\.mp4$/);
  const clipCall = fake.calls.find(({ kind }) => kind === "clip");
  assert.deepEqual(clipCall.bounds, { startSeconds: 0, endSeconds: 105, evidenceSeconds: 5 });
  assert.match(clipCall.args.join(" "), /libx264.*aac.*faststart/);
  const receipt = JSON.parse(await readFile(join(runDir, "card-media-v2", "receipt.json"), "utf8"));
  assert.equal(receipt.version, 2);
  assert.deepEqual(receipt.provenance.clipPolicy, {
    leadInSeconds: 20,
    defaultFollowUpSeconds: 90,
    explicitEnds: "absolute-no-extra-tail",
  });
  assert.equal(receipt.provenance.clipWindowPlan, null);
});

test("uses a transcript-bound explicit end without adding a fixed tail", async () => {
  const { runDir, summary } = await fixture("explicit-end");
  await writeFile(join(runDir, "transcript.md"), [
    "## [32:13] Segment 1 (58s)",
    "Theo sends the agent prompt; its response and reaction settle by 36:22.",
  ].join("\n"));
  const item = { timestamp: "32:13", title: "Agent response", summary: "Summary", excerpt: "Response.", uncertain: false };
  summary.topics = [item];
  summary.highlights = [item];
  summary.claims = [{ ...item, claim: "Claim" }];
  const planIdentity = await writePlan(runDir, { "32:13": 2185 });
  const fake = fakes({ sourceDuration: 2200 });
  const result = await prepareCardMedia({ runDir, summary, ...fake });

  assert.deepEqual(result.items[0], {
    timestamp: "32:13",
    clip: "card-media-v2/clips/clip-32m13s.mp4",
    frame: "card-media-v2/frames/frame-32m13s.jpg",
    startSeconds: 1913,
    endSeconds: 2185,
    evidenceSeconds: 1933,
  });
  assert.equal(fake.calls.find(({ kind }) => kind === "clip").bounds.endSeconds, 2185);
  const receipt = JSON.parse(await readFile(join(runDir, "card-media-v2", "receipt.json"), "utf8"));
  assert.deepEqual(receipt.provenance.clipWindowPlan, {
    path: ".stalker-clip-windows.json",
    version: 1,
    sha256: planIdentity.sha256,
    transcriptSha256: planIdentity.plan.transcriptSha256,
  });
});

test("changed clip-window plan invalidates cached card media", async () => {
  const { runDir, summary } = await fixture("plan-cache");
  const fake = fakes();
  await writePlan(runDir, { "0:05": 80, "1:30": 210 });
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 4);
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 4, "unchanged plan reuses verified output");

  await writePlan(runDir, { "0:05": 120, "1:30": 210 });
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 8, "changed plan regenerates every card-media output");
});

test("rejects missing sources, unknown timestamps, invalid clips, and subprocess failures", async (t) => {
  await t.test("missing source", async () => {
    const { runDir, summary } = await fixture("missing");
    await rm(join(runDir, "video.mp4"));
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /cannot read source video/);
  });
  await t.test("unknown timestamp", async () => {
    const { runDir, summary } = await fixture("timestamp");
    summary.topics[0].timestamp = "0:06";
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /no matching transcript segment/);
  });
  await t.test("invalid encoded clip", async () => {
    const { runDir, summary } = await fixture("invalid-clip");
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes({ invalidClip: true }) }), /invalid card clip/);
  });
  await t.test("subprocess failure", async () => {
    const { runDir, summary } = await fixture("failure");
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes({ fail: true }) }), /synthetic ffmpeg failure/);
    await assert.rejects(stat(join(runDir, "card-media-v2", "receipt.json")), /ENOENT/);
  });
});

test("rejects malformed, ungrounded, and out-of-bounds clip-window plans", async (t) => {
  await t.test("malformed JSON", async () => {
    const { runDir, summary } = await fixture("plan-malformed");
    await writeFile(join(runDir, ".stalker-clip-windows.json"), "{not-json\n");
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /invalid clip-window plan/);
  });
  await t.test("mismatched transcript hash", async () => {
    const { runDir, summary } = await fixture("plan-hash");
    await writePlan(runDir, { "0:05": 80 }, { transcriptSha256: "0".repeat(64) });
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /transcriptSha256 does not match/);
  });
  await t.test("unknown cited timestamp", async () => {
    const { runDir, summary } = await fixture("plan-timestamp");
    await writePlan(runDir, { "0:06": 80 });
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /unknown cited timestamp 0:06/);
  });
  await t.test("nonfinite end", async () => {
    const { runDir, summary } = await fixture("plan-nonfinite");
    const transcript = await readFile(join(runDir, "transcript.md"));
    const transcriptSha256 = createHash("sha256").update(transcript).digest("hex");
    await writeFile(join(runDir, ".stalker-clip-windows.json"), `{"version":1,"transcriptSha256":"${transcriptSha256}","ends":{"0:05":1e999}}`);
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /end for 0:05 must be finite/);
  });
  await t.test("end before cited segment end", async () => {
    const { runDir, summary } = await fixture("plan-before-segment");
    await writePlan(runDir, { "0:05": 14 });
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /end for 0:05 precedes transcript segment end/);
  });
  await t.test("end beyond recording", async () => {
    const { runDir, summary } = await fixture("plan-beyond-recording");
    await writePlan(runDir, { "0:05": 221 });
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /end for 0:05 exceeds source duration/);
  });
});

test("refuses stale legacy clips and reuses only receipt-verified card media", async () => {
  const { runDir, summary } = await fixture("reuse");
  await mkdir(join(runDir, "clips"));
  await writeFile(join(runDir, "clips", "clip-0m5s.mp4"), "old-fixed-45-second-media");
  await mkdir(join(runDir, "card-media", "clips"), { recursive: true });
  await writeFile(join(runDir, "card-media", "clips", "clip-0m5s.mp4"), "preserved-v1-card-media");
  const fake = fakes();
  const first = await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 4);
  assert.notEqual(first.items[0].clip, "clips/clip-0m5s.mp4");
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 4, "matching receipt reuses verified outputs");
  const clipPath = join(runDir, first.items[0].clip);
  await writeFile(clipPath, Buffer.alloc((await stat(clipPath)).size, "x"));
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 8, "same-size clip replacement invalidates the receipt");
  const framePath = join(runDir, first.items[0].frame);
  await writeFile(framePath, Buffer.alloc((await stat(framePath)).size, "y"));
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 12, "same-size poster replacement invalidates the receipt");
  assert.equal(await readFile(join(runDir, "card-media", "clips", "clip-0m5s.mp4"), "utf8"), "preserved-v1-card-media");
  const receipt = JSON.parse(await readFile(join(runDir, "card-media-v2", "receipt.json"), "utf8"));
  assert.equal(receipt.version, 2);
  assert.equal(receipt.provenance.items.length, 2);
  assert.match(receipt.provenance.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.outputs[0].clipSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.outputs[0].frameSha256, /^[a-f0-9]{64}$/);
  await rm(join(runDir, "video.mp4"));
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 12, "verified card-media remains reusable after source offload");
  await writePlan(runDir, { "0:05": 80 });
  await assert.rejects(prepareCardMedia({ runDir, summary, ...fake }), /cannot regenerate card media without source video/);
  await rm(join(runDir, ".stalker-clip-windows.json"));
  delete receipt.outputs[0].clipSha256;
  await writeFile(join(runDir, "card-media-v2", "receipt.json"), JSON.stringify(receipt));
  await assert.rejects(prepareCardMedia({ runDir, summary, ...fake }), /cannot regenerate card media without source video/);
});
