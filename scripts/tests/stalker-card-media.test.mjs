import assert from "node:assert/strict";
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

function fakes({ invalidClip = false, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    ffmpegImpl: async (request) => {
      calls.push(request);
      if (fail) throw new Error("synthetic ffmpeg failure");
      await writeFile(request.outputPath, request.kind === "clip" ? "encoded-clip" : "jpeg-poster");
    },
    ffprobeImpl: async ({ path }) => path.endsWith("video.mp4")
      ? { durationSeconds: 100 }
      : { durationSeconds: invalidClip ? 1 : path.includes("1m30s") ? 30 : 35, videoCodec: invalidClip ? "vp9" : "h264", audioCodec: "aac", width: 1280, height: 720 },
  };
}

test("clips +/-20 seconds to recording bounds and deduplicates timestamps", async () => {
  const { runDir, summary } = await fixture("bounds");
  const fake = fakes();
  const result = await prepareCardMedia({ runDir, summary, ...fake });
  assert.deepEqual(result.items.map(({ timestamp, startSeconds, endSeconds, evidenceSeconds }) =>
    ({ timestamp, startSeconds, endSeconds, evidenceSeconds })), [
    { timestamp: "0:05", startSeconds: 0, endSeconds: 35, evidenceSeconds: 5 },
    { timestamp: "1:30", startSeconds: 70, endSeconds: 100, evidenceSeconds: 90 },
  ]);
  assert.equal(fake.calls.filter(({ kind }) => kind === "clip").length, 2);
  assert.match(result.items[0].clip, /^card-media\/clips\/clip-0m5s\.mp4$/);
  const clipCall = fake.calls.find(({ kind }) => kind === "clip");
  assert.deepEqual(clipCall.bounds, { startSeconds: 0, endSeconds: 35, evidenceSeconds: 5 });
  assert.match(clipCall.args.join(" "), /libx264.*aac.*faststart/);
});

test("rejects missing sources, unknown timestamps, invalid clips, and subprocess failures", async (t) => {
  await t.test("missing source", async () => {
    const { runDir, summary } = await fixture("missing");
    await rm(join(runDir, "video.mp4"));
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /cannot read source video/);
  });
  await t.test("unknown timestamp", async () => {
    const { runDir, summary } = await fixture("timestamp");
    summary.topics[0].timestamp = "0:99";
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes() }), /invalid timestamp/);
  });
  await t.test("invalid encoded clip", async () => {
    const { runDir, summary } = await fixture("invalid-clip");
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes({ invalidClip: true }) }), /invalid card clip/);
  });
  await t.test("subprocess failure", async () => {
    const { runDir, summary } = await fixture("failure");
    await assert.rejects(prepareCardMedia({ runDir, summary, ...fakes({ fail: true }) }), /synthetic ffmpeg failure/);
    await assert.rejects(stat(join(runDir, "card-media", "receipt.json")), /ENOENT/);
  });
});

test("refuses stale legacy clips and reuses only receipt-verified card media", async () => {
  const { runDir, summary } = await fixture("reuse");
  await mkdir(join(runDir, "clips"));
  await writeFile(join(runDir, "clips", "clip-0m5s.mp4"), "old-fixed-45-second-media");
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
  const receipt = JSON.parse(await readFile(join(runDir, "card-media", "receipt.json"), "utf8"));
  assert.equal(receipt.version, 1);
  assert.equal(receipt.provenance.items.length, 2);
  assert.match(receipt.provenance.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.outputs[0].clipSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.outputs[0].frameSha256, /^[a-f0-9]{64}$/);
  await rm(join(runDir, "video.mp4"));
  await prepareCardMedia({ runDir, summary, ...fake });
  assert.equal(fake.calls.length, 12, "verified card-media remains reusable after source offload");
  delete receipt.outputs[0].clipSha256;
  await writeFile(join(runDir, "card-media", "receipt.json"), JSON.stringify(receipt));
  await assert.rejects(prepareCardMedia({ runDir, summary, ...fake }), /cannot regenerate card media without source video/);
});
