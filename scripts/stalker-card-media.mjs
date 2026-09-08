import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { cleanTranscript } from "./stalker-digest-evidence.mjs";

const execFileAsync = promisify(execFile);
const RECEIPT_VERSION = 1;
const CONTEXT_SECONDS = 20;
const MAX_CLIP_BYTES = 250 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

function timestampSeconds(value) {
  const match = /^([0-9]+):([0-5][0-9])$/.exec(value ?? "");
  if (!match) throw new Error(`invalid timestamp: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function timestampName(timestamp) {
  const [minutes, seconds] = timestamp.split(":").map(Number);
  return `${minutes}m${seconds}s`;
}

async function runTool(program, args) {
  try {
    return await execFileAsync(program, args, {
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`${program} failed${error.killed ? " (timed out)" : ""}: ${error.message}`);
  }
}

async function defaultFfprobe({ path }) {
  const { stdout } = await runTool("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
    "-of", "json", path,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams?.find(({ codec_type }) => codec_type === "video");
  const audio = data.streams?.find(({ codec_type }) => codec_type === "audio");
  return {
    durationSeconds: Number(data.format?.duration),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    width: video?.width,
    height: video?.height,
  };
}

async function defaultFfmpeg({ args }) {
  await runTool("ffmpeg", args);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function clipArgs(sourcePath, outputPath, { startSeconds, endSeconds }) {
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", String(startSeconds), "-i", sourcePath,
    "-t", String(endSeconds - startSeconds), "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath,
  ];
}

function frameArgs(sourcePath, outputPath, evidenceSeconds) {
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", String(evidenceSeconds), "-i", sourcePath,
    "-frames:v", "1", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease",
    "-q:v", "2", outputPath,
  ];
}

async function verifyClip(path, expectedDuration, ffprobeImpl, expectedBytes, expectedSha256) {
  const file = await stat(path).catch(() => null);
  if (!file?.isFile() || file.size === 0 || file.size >= MAX_CLIP_BYTES || (expectedBytes && file.size !== expectedBytes)) return false;
  if (expectedSha256 && await hashFile(path) !== expectedSha256) return false;
  const probe = await ffprobeImpl({ path }).catch(() => null);
  return Boolean(probe && Math.abs(probe.durationSeconds - expectedDuration) <= 2
    && probe.videoCodec === "h264" && probe.audioCodec === "aac"
    && probe.width > 0 && probe.height > 0 && probe.width <= 1280 && probe.height <= 720);
}

async function verifyFrame(path, expectedBytes, expectedSha256) {
  const file = await stat(path).catch(() => null);
  return Boolean(file?.isFile() && file.size > 0 && (!expectedBytes || file.size === expectedBytes)
    && (!expectedSha256 || await hashFile(path) === expectedSha256));
}

function stableEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function prepareCardMedia({
  runDir,
  summary,
  outputDir = join(resolve(runDir ?? ""), "card-media"),
  ffmpegImpl = defaultFfmpeg,
  ffprobeImpl = defaultFfprobe,
  renameImpl = rename,
}) {
  const absoluteRunDir = resolve(runDir ?? "");
  const absoluteOutputDir = resolve(outputDir);
  const outputRelative = relative(absoluteRunDir, absoluteOutputDir);
  if (outputRelative.startsWith(`..${sep}`) || outputRelative === ".." || isAbsolute(outputRelative)) {
    throw new Error("outputDir must be inside runDir");
  }
  const sourcePath = join(absoluteRunDir, "video.mp4");
  const transcriptPath = join(absoluteRunDir, "transcript.md");
  const transcript = await readFile(transcriptPath, "utf8").catch((error) => {
    throw new Error(`cannot read transcript ${transcriptPath}: ${error.message}`);
  });
  const receiptPath = join(absoluteOutputDir, "receipt.json");
  const prior = await readFile(receiptPath, "utf8").then(JSON.parse).catch(() => null);
  const sourceStat = await stat(sourcePath).catch(() => null);
  const sourceAvailable = Boolean(sourceStat?.isFile() && sourceStat.size > 0);
  let source;
  if (sourceAvailable) {
    const sourceProbe = await ffprobeImpl({ path: sourcePath });
    if (!Number.isFinite(sourceProbe.durationSeconds) || sourceProbe.durationSeconds <= 0) throw new Error("invalid source video duration");
    source = { path: "video.mp4", bytes: sourceStat.size, sha256: await hashFile(sourcePath), durationSeconds: sourceProbe.durationSeconds };
  } else {
    source = prior?.provenance?.source;
    if (prior?.version !== RECEIPT_VERSION || !source || !Number.isFinite(source.durationSeconds) || !/^[a-f0-9]{64}$/.test(source.sha256 ?? "")) {
      throw new Error(`cannot read source video ${sourcePath} and no verified card-media receipt is available`);
    }
  }
  const segments = new Map(cleanTranscript(transcript).map((segment) => [segment.timestamp, segment]));
  const collections = [summary?.topics, summary?.highlights, summary?.claims];
  if (collections.some((items) => !Array.isArray(items))) throw new Error("summary must contain topics, highlights, and claims arrays");
  const timestamps = [...new Set(collections.flat().map(({ timestamp }) => timestamp))]
    .sort((a, b) => timestampSeconds(a) - timestampSeconds(b));
  const items = timestamps.map((timestamp) => {
    const evidenceSeconds = timestampSeconds(timestamp);
    const segment = segments.get(timestamp);
    if (!segment) throw new Error(`invalid timestamp ${timestamp}: no matching transcript segment`);
    const startSeconds = Math.max(0, evidenceSeconds - CONTEXT_SECONDS);
    const endSeconds = Math.min(source.durationSeconds, evidenceSeconds + segment.durationSeconds + CONTEXT_SECONDS);
    if (!(endSeconds > startSeconds)) throw new Error(`invalid clip bounds for ${timestamp}`);
    const name = timestampName(timestamp);
    const prefix = outputRelative ? `${outputRelative}/` : "";
    return {
      timestamp,
      clip: `${prefix}clips/clip-${name}.mp4`,
      frame: `${prefix}frames/frame-${name}.jpg`,
      startSeconds,
      endSeconds,
      evidenceSeconds,
    };
  });
  const provenance = {
    version: RECEIPT_VERSION,
    source,
    transcriptSha256: createHash("sha256").update(transcript).digest("hex"),
    contextSeconds: CONTEXT_SECONDS,
    items,
  };
  if (prior?.version === RECEIPT_VERSION && stableEqual(prior.provenance, provenance)) {
    const verified = await Promise.all(items.map(async (item, index) => {
      const recorded = prior.outputs?.[index];
      if (!Number.isInteger(recorded?.clipBytes) || !Number.isInteger(recorded?.frameBytes)
        || !/^[a-f0-9]{64}$/.test(recorded?.clipSha256 ?? "") || !/^[a-f0-9]{64}$/.test(recorded?.frameSha256 ?? "")) return false;
      return await verifyClip(join(absoluteRunDir, item.clip), item.endSeconds - item.startSeconds, ffprobeImpl, recorded?.clipBytes, recorded?.clipSha256)
        && await verifyFrame(join(absoluteRunDir, item.frame), recorded?.frameBytes, recorded?.frameSha256);
    }));
    if (verified.every(Boolean)) return { items, receiptPath };
  }
  if (!sourceAvailable) throw new Error(`cannot regenerate card media without source video ${sourcePath}`);
  await Promise.all([mkdir(join(absoluteOutputDir, "clips"), { recursive: true }), mkdir(join(absoluteOutputDir, "frames"), { recursive: true })]);
  const nonce = `${process.pid}-${Date.now()}`;
  const temporary = [];
  try {
    for (const item of items) {
      const bounds = { startSeconds: item.startSeconds, endSeconds: item.endSeconds, evidenceSeconds: item.evidenceSeconds };
      const clipPath = join(absoluteRunDir, item.clip);
      const framePath = join(absoluteRunDir, item.frame);
      const clipTemp = join(absoluteOutputDir, "clips", `.${timestampName(item.timestamp)}-${nonce}.mp4`);
      const frameTemp = join(absoluteOutputDir, "frames", `.${timestampName(item.timestamp)}-${nonce}.jpg`);
      temporary.push(clipTemp, frameTemp);
      await ffmpegImpl({ kind: "clip", sourcePath, outputPath: clipTemp, bounds, args: clipArgs(sourcePath, clipTemp, bounds) });
      await ffmpegImpl({ kind: "frame", sourcePath, outputPath: frameTemp, bounds, args: frameArgs(sourcePath, frameTemp, item.evidenceSeconds) });
      if (!await verifyClip(clipTemp, item.endSeconds - item.startSeconds, ffprobeImpl)) throw new Error(`invalid card clip for ${item.timestamp}`);
      if (!await verifyFrame(frameTemp)) throw new Error(`invalid card poster for ${item.timestamp}`);
      await renameImpl(clipTemp, clipPath);
      await renameImpl(frameTemp, framePath);
    }
    const outputs = await Promise.all(items.map(async (item) => ({
      clipBytes: (await stat(join(absoluteRunDir, item.clip))).size,
      clipSha256: await hashFile(join(absoluteRunDir, item.clip)),
      frameBytes: (await stat(join(absoluteRunDir, item.frame))).size,
      frameSha256: await hashFile(join(absoluteRunDir, item.frame)),
    })));
    const receiptTemp = join(absoluteOutputDir, `.receipt-${nonce}.json`);
    temporary.push(receiptTemp);
    await writeFile(receiptTemp, `${JSON.stringify({ version: RECEIPT_VERSION, provenance, outputs }, null, 2)}\n`);
    await renameImpl(receiptTemp, receiptPath);
    return { items, receiptPath };
  } finally {
    await Promise.all(temporary.map((path) => rm(path, { force: true })));
  }
}
