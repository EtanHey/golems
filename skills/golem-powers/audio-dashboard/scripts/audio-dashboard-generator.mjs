#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Local BUILD and QA only. NarrationLayer owns hosted publication.
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expandHome(value, env = process.env) {
  if (value === "~") return env.HOME ?? os.homedir();
  if (value?.startsWith?.("~/")) return path.join(env.HOME ?? os.homedir(), value.slice(2));
  return value;
}

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:-]+$/.test(stringValue)) return stringValue;
  return `'${stringValue.replace(/'/g, `'\\''`)}'`;
}

function displayCommand(cwd, command, args) {
  const rendered = [command, ...args].map(shellQuote).join(" ");
  return cwd ? `cd ${shellQuote(cwd)} && ${rendered}` : rendered;
}

export function buildAfterCodeDashboardPlan(options = {}) {
  const env = options.env ?? process.env;
  const skillRoot = options.skillRoot ?? SKILL_ROOT;
  const specPath = options.specPath
    ? path.resolve(expandHome(options.specPath, env))
    : path.join(skillRoot, "examples", "job.json");
  const jobDirArgs = options.jobDir ? ["--job-dir", path.resolve(expandHome(options.jobDir, env))] : [];
  const spec = existsSync(specPath) ? JSON.parse(readFileSync(specPath, "utf8")) : {};
  const type = spec.type || "decision-flow";
  const firstBuildArgs = options.firstBuild ? ["--first-build", options.firstBuild] : [];
  const steps = [
    {
      name: "bootstrap-verify-deps",
      cwd: skillRoot,
      bin: "bun",
      args: ["scripts/bootstrap.mjs"],
    },
    {
      name: "synth-and-time-segments",
      cwd: skillRoot,
      bin: "bun",
      args: ["scripts/synth-segments.mjs", "--spec", specPath, ...jobDirArgs],
    },
    {
      name: "build-readalong-dashboard",
      cwd: skillRoot,
      bin: "bun",
      args: ["scripts/build-dashboard.mjs", "--spec", specPath, ...jobDirArgs, ...firstBuildArgs],
    },
    {
      name: `qa-${type}`,
      cwd: skillRoot,
      bin: "bun",
      args: [path.join("vendor", "qa", type === "decision-flow" ? "verify-decision-flow.mjs" : "verify-cinema.mjs"), expandHome(spec.outputPath || "<built.html>", env)],
    },
    {
      name: "prepare-hosted-publish",
      cwd: skillRoot,
      bin: "bun",
      args: ["scripts/validate-evidence.mjs", "--spec", specPath, ...jobDirArgs, ...firstBuildArgs, "--prepare-publish"],
    },
  ].map((step) => ({
    ...step,
    command: displayCommand(step.cwd, step.bin, step.args),
  }));

  return {
    workflow: "aftercode",
    notes: [
      "Fully SKILL-LOCAL: synth-segments.mjs + build-dashboard.mjs + vendor/ replace the old ~/Gits/{narrationlayer,agent-html} scripts.",
      "synth-segments.mjs runs the vendored local-tts-runner.ts (splitForBreathing cadence, fail-closed voice-profile gate) then the vendored whisper-cli word-timing + DP alignment — the exact STT-after-TTS step. It refuses to ship estimated/even-split timing.",
      "TTS needs a live qwen3 daemon; bootstrap.mjs verifies bun/whisper/ffmpeg/daemon and FAILS LOUD. A bring-your-own-WAV run (scene.audioWav) needs no daemon.",
      "build-dashboard.mjs renders the selected decision-flow or explicit cinema type to a repo docs.local/dashboards/*.html source.",
      "BUILD + QA + pre-publish evidence write a publish-handoff for NarrationLayer. READY_FOR_HOSTED_PUBLISH is not delivery PASS; validate-evidence --delivery is required after publication.",
    ],
    steps,
  };
}

function usage() {
  return `usage: audio-dashboard-generator.mjs [--workflow aftercode] [--dry-run|--run] [--json] [--spec <job.json>] [--job-dir <dir>] [--first-build <reason>]

Default: --dry-run. The wrapper emits the canonical SKILL-LOCAL AfterCode read-along
pipeline (bootstrap -> synth+time -> render -> qa -> publish handoff) and
only executes it when --run is explicitly present.`;
}

function parseArgs(argv) {
  const args = { workflow: "aftercode", dryRun: true, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workflow") args.workflow = argv[++i] ?? "";
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--run") args.dryRun = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--spec") args.specPath = argv[++i];
    else if (arg === "--job-dir") args.jobDir = argv[++i];
    else if (arg === "--first-build") args.firstBuild = argv[++i];
    else if (arg === "-h" || arg === "--help") args.help = true;
    else args.error = `unknown argument: ${arg}`;
  }
  return args;
}

function printPlan(plan) {
  console.log(`workflow: ${plan.workflow}`);
  for (const note of plan.notes) console.log(`note: ${note}`);
  for (const [index, step] of plan.steps.entries()) {
    console.log(`${index + 1}. ${step.name}: ${step.command}`);
  }
}

function runPlan(plan) {
  for (const step of plan.steps) {
    console.error(`[audio-dashboard] ${step.name}`);
    const result = spawnSync(step.bin, step.args, { cwd: step.cwd, stdio: "inherit" });
    if (result.error) {
      console.error(`[audio-dashboard] failed to start ${step.name}: ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (args.error) {
    console.error(args.error);
    console.error(usage());
    process.exit(2);
  }
  if (args.workflow !== "aftercode") {
    console.error("only --workflow aftercode is currently supported");
    process.exit(2);
  }

  const plan = buildAfterCodeDashboardPlan({
    specPath: args.specPath,
    jobDir: args.jobDir,
    firstBuild: args.firstBuild,
  });
  if (!args.dryRun && !["decision-flow", "cinema"].includes(JSON.parse(readFileSync(expandHome(args.specPath || path.join(SKILL_ROOT, "examples/job.json")), "utf8")).type)) {
    console.error("Set spec.type explicitly: decision-flow for decision briefings; cinema only on explicit request."); process.exit(2);
  }
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else printPlan(plan);
  if (!args.dryRun) runPlan(plan);
}
