#!/usr/bin/env node

import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stageFailure } from "./stalker-run-contract.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SCHEDULE_MINUTES = 7 * 60 + 30;

function timestampSeconds(timestamp) {
  const [minutes, seconds] = timestamp.split(":").map(Number);
  return minutes * 60 + seconds;
}

export function parseGems(markdown) {
  const headings = [...markdown.matchAll(/^### \[(\d+):(\d{2})\] Segment \d+(?: \([^)]*\))? (.+)$/gm)];
  return headings.map((heading, index) => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const score = Number(block.match(/\*\*Score:\*\*\s*(\d+)\/10/)?.[1] ?? 0);
    const type = block.match(/\*\*Type:\*\*\s*([^\n|]+)/)?.[1]?.trim() ?? "other";
    const gist = block.match(/\*\*Gist:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
    const timestamp = `${heading[1]}:${heading[2]}`;
    return {
      timestamp,
      seconds: timestampSeconds(timestamp),
      title: heading[3].trim(),
      score,
      type,
      gist,
      volumeSpike: /\*\*Volume spike:\*\*\s*yes/i.test(block),
      chatSpike: /\*\*Chat spike:\*\*\s*yes/i.test(block),
    };
  }).filter((gem) => gem.score > 0 && gem.title);
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.new-${process.pid}`);
  await writeFile(temporary, content);
  await rename(temporary, path);
}

function idtClock(now) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Jerusalem",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

async function eligibleRuns(stalkerRoot, date) {
  const entries = await readdir(stalkerRoot, { withFileTypes: true });
  const pattern = new RegExp(`^.+-${date}(?:-\\d{6})?$`);
  const candidates = entries
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => join(stalkerRoot, entry.name))
    .sort();
  const inspected = await Promise.all(candidates.map(async (runDir) => {
    const names = new Set(await readdir(runDir).catch(() => []));
    return names.has(".stage-process.done") && names.has(".stage-scoring.done") ? runDir : null;
  }));
  return inspected.filter(Boolean);
}

function validatedSummary(runDir, result) {
  const runName = basename(runDir);
  let url;
  try { url = new URL(result?.dashboardUrl); }
  catch { throw stageFailure(7, `${runName} completion returned no valid dashboard URL`); }
  if (result?.status !== "complete" || result.runName !== runName || !["http:", "https:"].includes(url.protocol)) {
    throw stageFailure(7, `${runName} completion did not return a verified receipt`);
  }
  return {
    run_name: runName,
    dashboard_url: url.href,
    contract_check: result.skipped === true ? "reverified" : "completed",
  };
}

function legacyBypass(options) {
  if (options.notify === false) return stageFailure(8, "notifications cannot be skipped");
  if (options.sync === false) return stageFailure(7, "hub sync cannot be skipped");
  if (options.verifyLive === false) return stageFailure(7, "live verification cannot be skipped");
  return null;
}

function failureReceipt(date, error, runName) {
  return {
    ts: new Date().toISOString(),
    status: "failed",
    date,
    stage: error?.stage ?? 6,
    reason: String(error?.message ?? error),
    ...(runName ? { run_name: runName } : {}),
  };
}

export async function runMorningDigest(options = {}) {
  const date = options.date;
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const stalkerRoot = join(repoRoot, "docs.local/stalker-golem");
  const receiptPath = join(stalkerRoot, "LAST-RUN.json");
  const notify = options.notifyImpl
    ?? (await import("./stalker-complete-run.mjs")).notifyDelivery;
  let runName;
  let runFailureAlreadyAlerted = false;

  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw stageFailure(6, "date must be YYYY-MM-DD");
    const bypass = legacyBypass(options);
    if (bypass) throw bypass;

    const runDirs = await eligibleRuns(stalkerRoot, date);
    if (runDirs.length === 0) {
      const clock = idtClock(options.now ?? new Date());
      if (clock.date === date && clock.minutes < SCHEDULE_MINUTES) {
        return { status: "not-ready", date, eligibleRunCount: 0 };
      }
      throw stageFailure(6, `no eligible Stalker runs found for ${date}`);
    }

    const complete = options.completeImpl
      ?? (await import("./stalker-complete-run.mjs")).completeRun;
    const runs = [];
    for (const runDir of runDirs) {
      runName = basename(runDir);
      let result;
      try {
        result = await complete(runDir, {
          repoRoot,
          orchestratorRoot: options.orchestratorRoot,
          hubOrigin: options.hubOrigin,
          fetchImpl: options.fetchImpl,
          generateImpl: options.generateImpl,
          syncImpl: options.syncImpl,
          notifyImpl: options.notifyImpl,
        });
      } catch (error) {
        runFailureAlreadyAlerted = true;
        throw error;
      }
      runs.push(validatedSummary(runDir, result));
    }
    const receipt = { ts: new Date().toISOString(), status: "complete", date, runs };
    await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { status: "complete", date, runCount: runs.length, runs };
  } catch (error) {
    const receipt = failureReceipt(date, error, runName);
    await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    if (!runFailureAlreadyAlerted) {
      await notify(
        `Stalker FAILED at stage ${receipt.stage}`,
        `${date ?? "invalid date"}: ${receipt.reason}`.slice(0, 900),
        "high",
      ).catch((notifyError) => {
        process.stderr.write(`failure notification also FAILED: ${notifyError.message}\n`);
      });
    }
    throw error;
  }
}

function currentIdtDate() {
  return idtClock(new Date()).date;
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function main(argv) {
  const result = await runMorningDigest({
    date: optionValue(argv, "--date", currentIdtDate()),
    notify: !argv.includes("--skip-notify"),
    sync: !argv.includes("--skip-sync"),
    verifyLive: !argv.includes("--skip-live-verify"),
    repoRoot: optionValue(argv, "--repo-root", DEFAULT_REPO_ROOT),
    orchestratorRoot: optionValue(argv, "--orchestrator-root", undefined),
    hubOrigin: optionValue(argv, "--hub-origin", undefined),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`STALKER_MORNING_DIGEST_FAILED ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
