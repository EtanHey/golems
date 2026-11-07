#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// SKILL-LOCAL ROOT. Every engine step below runs against the vendored code in
// this skill (scripts/ + vendor/), NOT against ~/Gits/{narrationlayer,agent-html,
// skill-creator}. The skill is self-contained and transferable; the only external
// touch points are (a) machine-local binaries/daemon verified by bootstrap.mjs,
// and (b) the tailnet publish + same-run HTTP 200 probe, which is the one
// genuinely environment-specific action (resolved from ORCHESTRATOR_ROOT and
// AUDIO_DASHBOARD_TAILNET_BASE_URL if present).
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expandHome(value, env = process.env) {
  if (value === "~") return env.HOME ?? os.homedir();
  if (value?.startsWith?.("~/")) return path.join(env.HOME ?? os.homedir(), value.slice(2));
  return value;
}

function orchestratorRoot(env = process.env) {
  if (env.ORCHESTRATOR_ROOT) return expandHome(env.ORCHESTRATOR_ROOT, env);
  const gitsRoot = env.GITS_ROOT ?? path.join(env.HOME ?? os.homedir(), "Gits");
  return path.join(gitsRoot, "orchestrator");
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
  const publishScript = path.join(orchestratorRoot(env), "scripts", "sync-tailnet-dashboards.mjs");
  const tailnetUrl = options.tailnetUrl ?? env.AUDIO_DASHBOARD_TAILNET_URL;
  const tailnetBaseUrl = options.tailnetBaseUrl ?? env.AUDIO_DASHBOARD_TAILNET_BASE_URL ?? env.TAILNET_DASHBOARD_BASE_URL;
  const verifyTailnetArgs = [
    "scripts/verify-tailnet-publish.mjs",
    "--spec", specPath,
    ...(tailnetUrl ? ["--url", tailnetUrl] : []),
    ...(!tailnetUrl && tailnetBaseUrl ? ["--base-url", tailnetBaseUrl] : []),
  ];

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
      args: ["scripts/build-dashboard.mjs", "--spec", specPath, ...jobDirArgs],
    },
    {
      name: "qa-cinema",
      cwd: skillRoot,
      bin: "bun",
      // Pass the spec so verify-cinema resolves the rendered dashboard's
      // outputPath and QAs the actual HTML (not a missing default).
      args: [path.join("vendor", "qa", "verify-cinema.mjs"), "--spec", specPath],
    },
    {
      name: "publish-tailnet",
      cwd: skillRoot,
      bin: "node",
      args: [publishScript],
    },
    {
      name: "verify-tailnet-http-200",
      cwd: skillRoot,
      bin: "bun",
      args: verifyTailnetArgs,
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
      "build-dashboard.mjs renders the vendored render-v4 cinema (Q/A, Play-All, read-along teleprompter, .note-area response boxes) to a repo docs.local/dashboards/*.html source.",
      "Publishing writes stay in repo docs.local/dashboards; the tailnet sync (ORCHESTRATOR_ROOT/scripts/sync-tailnet-dashboards.mjs) rebuilds dashboards-serve, then verify-tailnet-publish.mjs requires a same-run HTTP 200 + matching bytes before the run can report live.",
    ],
    steps,
  };
}

function usage() {
  return `usage: audio-dashboard-generator.mjs [--workflow aftercode] [--dry-run|--run] [--json] [--spec <job.json>] [--job-dir <dir>] [--tailnet-url <url>|--tailnet-base-url <url>]

Default: --dry-run. The wrapper emits the canonical SKILL-LOCAL AfterCode read-along
pipeline (bootstrap -> synth+time -> render -> qa -> tailnet sync -> HTTP 200 probe) and
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
    else if (arg === "--tailnet-url") args.tailnetUrl = argv[++i];
    else if (arg === "--tailnet-base-url") args.tailnetBaseUrl = argv[++i];
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
    tailnetUrl: args.tailnetUrl,
    tailnetBaseUrl: args.tailnetBaseUrl,
  });
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else printPlan(plan);
  if (!args.dryRun) runPlan(plan);
}
