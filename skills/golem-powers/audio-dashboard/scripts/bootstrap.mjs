#!/usr/bin/env bun
/**
 * bootstrap — verify the audio-dashboard skill's NON-SHIPPABLE binary / daemon
 * dependencies and FAIL LOUDLY with install instructions if any are missing.
 *
 * The skill vendors all of its ENGINE CODE (TTS runner, STT word-timing, DP
 * alignment/repair, render-v4, evidence validator, verify-cinema). But three
 * classes of dependency can't travel as files inside a skill and must exist on
 * the host:
 *
 *   HARD (STT + render pipeline — required for ANY real dashboard):
 *     - bun         (runs the vendored .ts engine)
 *     - ffmpeg      (wav transcode / mp3 embed / silence pads)
 *     - ffprobe     (segment duration for alignment)
 *     - whisper-cli (STT-after-TTS word timings)
 *     - a whisper model (ggml-*.bin)
 *
 *   TTS-ONLY (required only to SYNTHESIZE new audio; a bring-your-own-WAV run
 *   via scene.audioWav needs none of these):
 *     - a reachable qwen3 TTS daemon (default http://127.0.0.1:8880)
 *     - the daemon auth token file (default ~/.voicelayer/daemon.secret)
 *     - voice profiles (NARRATIONLAYER_PROFILES_FILE / NARRATIONLAYER_ROOT /
 *       a direct .wav reference passed to the runner)
 *
 * NEVER silently fall back to estimated timing or system TTS — that is the whole
 * point of the skill. This script makes the missing dependency LOUD instead.
 *
 * Exit: nonzero if any HARD dep is missing. With --require-tts, also nonzero if
 * the TTS daemon/token are not ready. --json prints a machine-readable report.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function expandHome(v) {
  if (v === "~") return os.homedir();
  if (v?.startsWith?.("~/")) return path.join(os.homedir(), v.slice(2));
  return v;
}

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const REQUIRE_TTS = args.includes("--require-tts");
const DAEMON_URL = (args[args.indexOf("--daemon-url") + 1] && args.includes("--daemon-url"))
  ? args[args.indexOf("--daemon-url") + 1]
  : "http://127.0.0.1:8880";

const checks = [];
function record(name, ok, detail, hint, tier = "hard") {
  checks.push({ name, ok, detail, hint, tier });
}

function which(bin) {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

// --- HARD deps ---
const bun = which("bun");
record("bun", Boolean(bun), bun || "not found", "curl -fsSL https://bun.sh/install | bash");

const ffmpeg = which("ffmpeg");
record("ffmpeg", Boolean(ffmpeg), ffmpeg || "not found", "brew install ffmpeg");

const ffprobe = which("ffprobe");
record("ffprobe", Boolean(ffprobe), ffprobe || "not found", "brew install ffmpeg (ships ffprobe)");

let whisper = which("whisper-cli");
if (!whisper) {
  for (const c of [
    path.join("/opt/homebrew", "bin", "whisper-cli"),
    path.join("/usr/local", "bin", "whisper-cli"),
  ]) {
    if (existsSync(c)) { whisper = c; break; }
  }
}
record("whisper-cli", Boolean(whisper), whisper || "not found", "brew install whisper-cpp");

const modelCandidates = [
  process.env.NARRATIONLAYER_WHISPER_MODEL,
  "~/.cache/whisper/ggml-large-v3-turbo.bin",
  "~/.cache/whisper/ggml-large-v3-turbo-q5_0.bin",
  "~/.cache/whisper/ggml-base.en.bin",
  "~/.cache/whisper/ggml-base.bin",
].filter(Boolean).map((p) => path.resolve(expandHome(p)));
const model = modelCandidates.find((p) => existsSync(p));
record(
  "whisper-model",
  Boolean(model),
  model || "not found",
  "download a ggml model to ~/.cache/whisper/ (e.g. ggml-large-v3-turbo.bin) or set NARRATIONLAYER_WHISPER_MODEL",
);

// --- TTS-only deps ---
let daemonOk = false;
let daemonDetail = "unreachable";
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  const res = await fetch(`${DAEMON_URL.replace(/\/+$/, "")}/`, { signal: controller.signal }).catch(() => null);
  clearTimeout(timer);
  // Any HTTP response (even 404) proves the daemon is listening.
  daemonOk = Boolean(res);
  daemonDetail = res ? `reachable (HTTP ${res.status})` : "no response / timed out";
} catch {
  daemonOk = false;
}
record("tts-daemon", daemonOk, `${DAEMON_URL} — ${daemonDetail}`, "start the qwen3 voice daemon on :8880 (narrationlayer/voicelayer)", "tts");

const tokenPath = path.resolve(expandHome("~/.voicelayer/daemon.secret"));
const tokenOk = existsSync(tokenPath) && readFileSync(tokenPath, "utf8").trim().length > 0;
record("tts-auth-token", tokenOk, tokenOk ? tokenPath : `${tokenPath} (missing/empty)`, "create ~/.voicelayer/daemon.secret with the daemon Bearer token", "tts");

const profilesEnv = process.env.NARRATIONLAYER_PROFILES_FILE;
const nlRoot = process.env.NARRATIONLAYER_ROOT;
const profilesHint = "set NARRATIONLAYER_PROFILES_FILE to a profiles.local.yaml, OR pass a direct .wav --reference (no profiles needed)";
const profilesDetail = profilesEnv
  ? `NARRATIONLAYER_PROFILES_FILE=${profilesEnv}`
  : nlRoot
    ? `NARRATIONLAYER_ROOT=${nlRoot}`
    : "unset (direct-.wav reference still works)";
record("tts-voice-profiles", Boolean(profilesEnv || nlRoot), profilesDetail, profilesHint, "tts");

// --- report ---
const hardFail = checks.filter((c) => c.tier === "hard" && !c.ok);
const ttsFail = checks.filter((c) => c.tier === "tts" && !c.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ checks, hardOk: hardFail.length === 0, ttsReady: ttsFail.length === 0 }, null, 2));
} else {
  console.log("audio-dashboard bootstrap — dependency check\n");
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    const tier = c.tier === "tts" ? " [TTS-only]" : "";
    console.log(`  ${mark} ${c.name}${tier}: ${c.detail}`);
    if (!c.ok) console.log(`      → ${c.hint}`);
  }
  console.log("");
  console.log(hardFail.length === 0
    ? "HARD deps: OK — STT-after-TTS + render pipeline can run (BYO-audio needs no daemon)."
    : `HARD deps: MISSING (${hardFail.map((c) => c.name).join(", ")}) — the skill CANNOT produce a real dashboard. Fix the above, do NOT fall back to estimated timing.`);
  console.log(ttsFail.length === 0
    ? "TTS deps: OK — new audio can be synthesized."
    : `TTS deps: NOT READY (${ttsFail.map((c) => c.name).join(", ")}) — synthesizing NEW audio will fail-closed. Bring-your-own-WAV (scene.audioWav) still works.`);
}

if (hardFail.length > 0) process.exit(1);
if (REQUIRE_TTS && ttsFail.length > 0) process.exit(2);
process.exit(0);
