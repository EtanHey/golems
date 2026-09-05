#!/usr/bin/env bun
/**
 * synth-segments — SKILL-LOCAL, PORTABLE replacement for narrationlayer's
 * one-off `bin/aftercode-tonight-synth.ts` + `docs.local/regen-*-real-word-timings.ts`.
 *
 * It runs the canonical STT-after-TTS engine entirely against the vendored libs
 * in this skill — no dependency on $HOME/Gits/narrationlayer or agent-html:
 *
 *   for each scene:
 *     1. TTS  : vendored local-tts-runner.ts (fail-closed voice-profile gate,
 *               qwen3 daemon)  ->  <id>.wav      [SKIPPED when scene.audioWav given]
 *     2. mp3  : ffmpeg wav -> mp3   (cinema embeds mp3 data URIs)
 *     3. STT  : vendored runWhisperCliWordTimings(wav)     (whisper-cli word timings)
 *     4. align: vendored normalizeWordTimingsForScript(script, rawWords, duration)
 *               (the mandatory STT-after-TTS DP alignment/repair step)
 *     5. write <jobDir>/segments/<id>/words.raw.json (untouched Whisper) and
 *              <jobDir>/segments/<id>/words.json     (repaired display timing)
 *
 * INVARIANT (fail-closed): if alignment can match ZERO script words to the audio
 * (estimated === true), that is a degenerate even-split — NOT real word timing —
 * and we EXIT NONZERO rather than ship estimated/WPM timing. Same for empty words.
 *
 * BYO-AUDIO: a scene may carry `audioWav` (path to an already-produced real speech
 * WAV). Then step 1 is skipped and steps 2-5 run on that WAV. This makes the STT +
 * align + render pipeline runnable WITHOUT a live TTS daemon (used by the packaged
 * eval / cmux smoke), and is a legitimate bring-your-own-voice path.
 *
 * Usage:
 *   bun scripts/synth-segments.mjs --spec <job.json> [--job-dir <dir>] [--json]
 *   bun scripts/synth-segments.mjs --spec <job.json> --resynth-scene <id> [--resynth-scene <id>...]
 *
 * job.json shape (see evals/fixtures/spec-*.json):
 *   { "id": "...", "scenes": [ { "id":"c1q", "script":"...", "reference":"<profile|.wav>",
 *                                "role":"host", "audioWav":"<optional existing .wav>" } ] }
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { runWhisperCliWordTimings } from "../vendor/narrationlayer/word-timings.ts";
import { normalizeWordTimingsForScript } from "../vendor/narrationlayer/word-timing-repair.ts";
import { deriveSpeechAliases } from "../vendor/narrationlayer/text-normalize.ts";
import { clearTakeCacheReceiptForByo, writeWordTimingArtifacts } from "../src/word-timing-artifacts.mjs";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TTS_RUNNER = path.join(SKILL_ROOT, "vendor", "narrationlayer", "local-tts-runner.ts");

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value?.startsWith?.("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function fail(message) {
  console.error(`[synth-segments] FATAL: ${message}`);
  process.exit(1);
}

function safePathId(value, label) {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    fail(`${label} must be a slug-safe path segment: ${id || "<empty>"}`);
  }
  return id;
}

function parseArgs(argv) {
  const args = { json: false, noCache: false, resynthScenes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--spec") args.spec = argv[++i];
    else if (a === "--job-dir") args.jobDir = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--no-cache") args.noCache = true;
    else if (a === "--resynth-scene") {
      args.resynthScenes.push(safePathId(argv[++i], "--resynth-scene"));
      args.noCache = true;
    }
    else if (a === "-h" || a === "--help") args.help = true;
    else fail(`unknown argument: ${a}`);
  }
  return args;
}

function ffprobeDurationSeconds(wavPath) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath],
    { encoding: "utf8" },
  );
  if (r.error) fail(`ffprobe not runnable (${r.error.message}). Run scripts/bootstrap.mjs.`);
  if (r.status !== 0) fail(`ffprobe duration failed for ${wavPath} (exit ${r.status})`);
  const d = Number((r.stdout || "").trim());
  if (!Number.isFinite(d) || d <= 0) {
    fail(`ffprobe returned invalid duration for ${wavPath}: ${(r.stdout || "").trim() || "<empty>"}`);
  }
  return d;
}

function wavToMp3(wavPath, mp3Path) {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-q:a", "3", mp3Path],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.error) fail(`ffmpeg not runnable (${r.error.message}). Run scripts/bootstrap.mjs.`);
  if (r.status !== 0) fail(`ffmpeg wav->mp3 failed for ${wavPath} (exit ${r.status})`);
}

function runTts(scene, wavPath, { noCache = false } = {}) {
  const ref = scene.reference ?? scene.profile;
  if (!ref) fail(`scene ${scene.id}: no audioWav and no reference/profile — cannot synthesize`);
  const directWavReference = /\.wav$/i.test(String(ref));
  if (!directWavReference && !process.env.NARRATIONLAYER_PROFILES_FILE && !process.env.NARRATIONLAYER_ROOT) {
    fail(
      `scene ${scene.id}: reference "${ref}" looks like a voice profile, but NARRATIONLAYER_PROFILES_FILE is unset. ` +
        "Set NARRATIONLAYER_PROFILES_FILE to profiles.local.yaml, set NARRATIONLAYER_ROOT, or pass a direct .wav reference.",
    );
  }
  const runnerArgs = [
    TTS_RUNNER,
    "--text", scene.script,
    "--output", wavPath,
    "--reference", ref,
    ...(scene.role ? ["--role", scene.role] : []),
    ...(noCache ? ["--no-cache"] : []),
  ];
  const r = spawnSync("bun", runnerArgs, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.error) fail(`bun not runnable (${r.error.message}). Run scripts/bootstrap.mjs.`);
  if (r.status !== 0) {
    // The vendored runner is fail-closed: a down daemon / missing profile /
    // missing clone exits nonzero. We propagate LOUD — never fall back to
    // estimated timing or system TTS.
    fail(`TTS synth failed for scene ${scene.id} (exit ${r.status}). The vendored local-tts-runner is fail-closed: check the qwen3 daemon (:8880), the voice profile/clone, and NARRATIONLAYER_PROFILES_FILE. Run scripts/bootstrap.mjs to diagnose.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: bun scripts/synth-segments.mjs --spec <job.json> [--job-dir <dir>] [--json] [--no-cache] [--resynth-scene <id>...]");
    process.exit(0);
  }
  if (!args.spec) fail("--spec <job.json> is required");
  const specPath = path.resolve(expandHome(args.spec));
  const specDir = path.dirname(specPath);
  const resolveSpecPath = (value) => {
    const expanded = expandHome(value);
    return path.isAbsolute(expanded) ? expanded : path.resolve(specDir, expanded);
  };
  if (!existsSync(specPath)) fail(`spec not found: ${specPath}`);
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) fail("spec.scenes must be a non-empty array");

  const jobId = safePathId(spec.id || "audio-dashboard-job", "spec.id");
  const jobDir = path.resolve(
    expandHome(args.jobDir || path.join(os.homedir(), ".narrationlayer", "jobs", jobId)),
  );
  mkdirSync(jobDir, { recursive: true });

  const resynthSceneSet = new Set(args.resynthScenes);
  if (resynthSceneSet.size) {
    const specIds = new Set(spec.scenes.map((scene) => safePathId(scene.id, "scene.id")));
    for (const requested of resynthSceneSet) {
      if (!specIds.has(requested)) fail(`--resynth-scene ${requested} is not present in spec.scenes`);
    }
    for (const scene of spec.scenes) {
      const sceneId = safePathId(scene.id, "scene.id");
      if (resynthSceneSet.has(sceneId)) continue;
      const segDir = path.join(jobDir, "segments", sceneId);
      const required = [
        path.join(segDir, `${sceneId}.wav`),
        path.join(segDir, `${sceneId}.mp3`),
        path.join(segDir, "words.raw.json"),
        path.join(segDir, "words.json"),
      ];
      for (const artifact of required) {
        if (!existsSync(artifact)) {
          fail(`--resynth-scene requires an existing prior run: scene ${sceneId} has no artifact at ${artifact}`);
        }
      }
    }
    console.error(
      `[synth-segments] resynth mode: ${[...resynthSceneSet].join(", ")}; TTS cache disabled so flagged segments get a real re-roll`,
    );
  }

  const results = [];
  const seenSceneIds = new Set();
  for (const scene of spec.scenes) {
    const sceneId = safePathId(scene.id, "scene.id");
    if (seenSceneIds.has(sceneId)) fail(`duplicate scene.id: ${sceneId}`);
    seenSceneIds.add(sceneId);
    if (resynthSceneSet.size && !resynthSceneSet.has(sceneId)) continue;
    const sceneForRun = { ...scene, id: sceneId };
    if (typeof sceneForRun.script !== "string" || !sceneForRun.script.trim()) fail(`scene ${sceneId}: script must be a non-empty string`);
    const segDir = path.join(jobDir, "segments", sceneId);
    mkdirSync(segDir, { recursive: true });
    const wav = path.join(segDir, `${sceneId}.wav`);
    const mp3 = path.join(segDir, `${sceneId}.mp3`);
    let speechAliases = [];

    // 1) audio: BYO existing WAV, else canonical fail-closed TTS synth.
    if (sceneForRun.audioWav) {
      const src = resolveSpecPath(sceneForRun.audioWav);
      if (!existsSync(src)) fail(`scene ${sceneId}: audioWav not found: ${src}`);
      if (src !== wav) {
        const buf = readFileSync(src);
        writeFileSync(wav, buf);
      }
      // A reused job directory may carry a cache receipt from an older TTS run
      // for this scene. BYO audio has no frozen take, so retaining that receipt
      // could make a later gate purge the unrelated historical cache entry.
      clearTakeCacheReceiptForByo(wav);
    } else {
      runTts(sceneForRun, wav, { noCache: args.noCache });
      const spokenPath = `${wav}.spoken.txt`;
      if (!existsSync(spokenPath)) {
        fail(`scene ${sceneId}: TTS runner did not persist its required synth-input sidecar`);
      }
      const synthInput = readFileSync(spokenPath, "utf8");
      if (!synthInput.trim()) fail(`scene ${sceneId}: synth-input sidecar is empty`);
      speechAliases = deriveSpeechAliases(sceneForRun.script, synthInput);
    }
    if (!existsSync(wav)) fail(`scene ${sceneId}: no WAV produced at ${wav}`);

    // 2) mp3 for embedding
    wavToMp3(wav, mp3);

    // 3) STT-after-TTS: real whisper-cli word timings
    let stt;
    try {
      stt = await runWhisperCliWordTimings(wav, { language: spec.language || "en" });
    } catch (err) {
      fail(`whisper-cli word timing failed for scene ${sceneId}: ${err?.message || err}. Run scripts/bootstrap.mjs.`);
    }
    if (!stt.words.length) fail(`scene ${sceneId}: whisper-cli returned ZERO words — refusing to ship (no estimated fallback)`);

    // 4) mandatory DP alignment of whisper words to the clean script tokens
    const duration = ffprobeDurationSeconds(wav);
    const aligned = normalizeWordTimingsForScript(sceneForRun.script, stt.words, duration, speechAliases);
    if (!aligned.words.length) {
      fail(`scene ${sceneId}: alignment produced ZERO words — refusing to ship`);
    }
    if (aligned.estimated) {
      fail(`scene ${sceneId}: alignment matched ZERO script words to the audio (degenerate even-split) — this is estimated timing, refusing to ship`);
    }

    // 4b) Enforce the read-along timing invariant the evidence gate checks:
    // strictly monotonic, non-overlapping, POSITIVE-duration words. The DP
    // alignment occasionally emits a zero-width token (start === end) when two
    // script tokens collapse onto one whisper word; that is real timing, not
    // estimated, but `end > start` is required. Left-to-right, floor each word
    // to MIN_WORD_DURATION and keep start >= previous end (no overlap). This
    // nudges only degenerate tokens by a few ms — imperceptible — so the skill
    // never ships output its own gate would reject.
    const MIN_WORD_DURATION = 0.02;
    let prevEnd = 0;
    const words = aligned.words.map((w) => {
      const start = Math.max(Number(w.start), prevEnd);
      const end = Math.max(Number(w.end), start + MIN_WORD_DURATION);
      prevEnd = end;
      return { ...w, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) };
    });

    // 5) Persist both timing channels. The raw Whisper series is immutable gate
    // input; the repaired series is script-first display timing.
    const { rawWordsPath, wordsPath } = writeWordTimingArtifacts(segDir, {
      rawWords: aligned.rawWords,
      repairedWords: words,
    });

    results.push({
      id: sceneId,
      wav,
      mp3,
      rawWordsPath,
      wordsPath,
      words: aligned.words.length,
      source: stt.source,
      durationSec: Number(duration.toFixed(3)),
      repaired: aligned.repaired,
      byo: Boolean(sceneForRun.audioWav),
    });
    console.error(
      `[synth-segments] OK ${sceneId} words=${aligned.words.length} src=${stt.source} dur=${duration.toFixed(2)}s${sceneForRun.audioWav ? " (BYO wav)" : ""}${aligned.repaired ? " aligned" : ""}`,
    );
  }

  // job.json index for build-dashboard.mjs
  const jobJson = {
    id: jobId,
    jobDir,
    scenes: spec.scenes.map((s) => ({ id: safePathId(s.id, "scene.id"), script: s.script })),
  };
  writeFileSync(path.join(jobDir, "job.json"), `${JSON.stringify(jobJson, null, 2)}\n`);

  const summary = {
    jobDir,
    segments: results.length,
    wordsTotal: results.reduce((n, r) => n + r.words, 0),
    resynthScenes: [...resynthSceneSet],
    noCache: args.noCache,
    results,
  };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.error(`[synth-segments] DONE ${results.length} segments -> ${jobDir}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
