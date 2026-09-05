#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_DASHBOARD_BASE =
  process.env.STALKER_DASHBOARD_BASE ?? "https://dashboards.example.invalid/stalker";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

function prettyDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function gemCard(gem) {
  const scoreClass = gem.score >= 10 ? "s10" : gem.score >= 9 ? "s9" : "";
  const media = [
    gem.frame
      ? `<img class="thumb" loading="lazy" src="assets/${escapeHtml(gem.runName)}/${escapeHtml(gem.frame)}" alt="">`
      : '<div class="thumb noimg">no frame</div>',
    gem.clip
      ? `<video class="clip" preload="none" controls src="assets/${escapeHtml(gem.runName)}/${escapeHtml(gem.clip)}"></video>`
      : '<div class="noclip">clip unavailable</div>',
  ].join("");
  const spike = gem.volumeSpike || gem.chatSpike
    ? `<span class="spike">${gem.volumeSpike ? "volume" : "chat"} spike</span>`
    : "";
  return `<article class="gem ${scoreClass}" data-score="${gem.score}" data-type="${escapeHtml(gem.type)}"><div class="media">${media}</div><div class="body"><div class="meta"><span class="score">${gem.score >= 9 ? "🔥" : "💎"} ${gem.score}/10</span><span class="ts">${escapeHtml(gem.timestamp)}</span><span class="type">${escapeHtml(gem.type)}</span>${spike}</div><h3>${escapeHtml(gem.title)}</h3><p>${escapeHtml(gem.gist)}</p></div></article>`;
}

export function buildDashboard({ date, runs, gems }) {
  const sorted = [...gems].sort((a, b) => b.score - a.score || a.seconds - b.seconds);
  const types = [...new Set(sorted.map((gem) => gem.type))].sort();
  const chatLines = runs.reduce((total, run) => total + run.chatLines, 0);
  const countAt = (score) => sorted.filter((gem) => gem.score >= score).length;
  const buttons = [
    `<button class="on" data-f="all">all ${sorted.length}</button>`,
    `<button data-f="score" data-v="9">9+ (${countAt(9)})</button>`,
    `<button data-f="score" data-v="8">8+ (${countAt(8)})</button>`,
    '<button data-f="spike" data-v="1">spikes</button>',
    ...types.map((type) => `<button data-f="type" data-v="${escapeHtml(type)}">${escapeHtml(type)}</button>`),
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Theo · ${prettyDate(date)} — ${sorted.length} gems</title><style>
:root{--bg:#0d0f13;--card:#171b22;--line:#2a303b;--tx:#edf1f7;--dim:#a2acba;--acc:#ffb020}*{box-sizing:border-box}body{margin:0;background:#0d0f13;color:var(--tx);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{padding:22px 20px 14px;border-bottom:1px solid var(--line);background:#11151b}h1{margin:0 0 4px;font-size:22px}.sub{color:var(--dim);font-size:13px}.filters{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}button{background:var(--card);color:var(--tx);border:1px solid var(--line);border-radius:999px;padding:7px 13px;font-size:12px;cursor:pointer}button.on{background:var(--acc);color:#151515;border-color:var(--acc);font-weight:700}main{display:grid;gap:14px;padding:18px;max-width:1200px;margin:0 auto;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}.gem{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}.gem.s10{border-color:var(--acc)}.gem.s9{border-color:#8b5cf6}.media{position:relative;background:#050608;aspect-ratio:16/9}.thumb,.clip{width:100%;height:100%;object-fit:cover;display:block}.clip{position:absolute;inset:0;opacity:0}.clip:focus,.clip:hover,.media:hover .clip{opacity:1;z-index:2}.noimg,.noclip{display:flex;align-items:center;justify-content:center;color:#707b8b;font-size:12px;height:100%}.body{padding:12px 14px 14px}.meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:11px;color:var(--dim);margin-bottom:6px}.score{color:var(--acc);font-weight:700;font-size:13px}.type{background:#232933;padding:2px 7px;border-radius:5px}.spike{background:#3b2410;color:#f5ad42;padding:2px 7px;border-radius:5px}h3{margin:0 0 6px;font-size:15px;line-height:1.35}p{margin:0;color:#c9d1dc;font-size:13px}footer{padding:24px 20px 40px;color:var(--dim);font-size:12px;text-align:center;border-top:1px solid var(--line);margin-top:20px}@media(max-width:520px){main{grid-template-columns:1fr;padding:10px}header{padding:16px 12px 12px}}
</style><style>.gem[hidden]{display:none}</style></head><body><header><h1>Theo — ${prettyDate(date)}</h1><div class="sub">${sorted.length} gems · ${chatLines.toLocaleString("en-US")} chat lines · ${runs.length} recording${runs.length === 1 ? "" : "s"} · hover a card to play its clip</div><div class="filters">${buttons}</div></header><main id="grid">${sorted.map(gemCard).join("\n")}</main><footer>Tailnet-only Stalker digest · generated ${escapeHtml(new Date().toISOString())}</footer><script>
for(const button of document.querySelectorAll("button")){button.addEventListener("click",()=>{for(const b of document.querySelectorAll("button"))b.classList.remove("on");button.classList.add("on");const filter=button.dataset.f;const value=button.dataset.v;for(const card of document.querySelectorAll(".gem")){const show=filter==="all"||(filter==="score"&&Number(card.dataset.score)>=Number(value))||(filter==="type"&&card.dataset.type===value)||(filter==="spike"&&Boolean(card.querySelector(".spike")));card.hidden=!show;}})}
</script></body></html>`;
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.new-${process.pid}`);
  await writeFile(temporary, content);
  await rename(temporary, path);
}

async function lineCount(path) {
  const content = await readFile(path, "utf8").catch(() => "");
  return content ? content.split("\n").length - (content.endsWith("\n") ? 1 : 0) : 0;
}

function mediaSeconds(name) {
  const match = name.match(/(?:clip|frame)-(\d+)m(\d+)s\.(?:mp4|jpg)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

async function collectRun(runDir) {
  const entries = await readdir(runDir).catch(() => null);
  if (
    !entries
    || !entries.includes(".stage-process.done")
    || !entries.includes(".stage-scoring.done")
  ) return null;
  const markdown = await readFile(join(runDir, "gems.md"), "utf8").catch(() => null);
  if (!markdown || !(/\*Scored \d+\/\d+ segments/.test(markdown)
    || /(?:^|\n)Gems found: \d+\n[\s\S]*\nScored: .+$/m.test(markdown))) return null;
  const frames = await readdir(join(runDir, "frames")).catch(() => []);
  const nestedClips = await readdir(join(runDir, "clips")).catch(() => []);
  const clips = [
    ...entries.filter((entry) => /^clip-\d+m\d+s\.mp4$/.test(entry)),
    ...nestedClips
      .filter((entry) => /^clip-\d+m\d+s\.mp4$/.test(entry))
      .map((entry) => `clips/${entry}`),
  ];
  const frameFiles = frames.filter((entry) => /^frame-\d+m\d+s\.jpg$/.test(entry));
  const nearest = (files, seconds, maxDistance) => files
    .map((file) => ({ file, distance: Math.abs(mediaSeconds(file) - seconds) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.file ?? null;
  const name = basename(runDir);
  return {
    name,
    chatLines: await lineCount(join(runDir, "chat.log")),
    archiveComplete: entries.includes(".stage-archive.done"),
    gems: parseGems(markdown).map((gem) => ({
      ...gem,
      runName: name,
      clip: nearest(clips, gem.seconds, 3),
      frame: (() => {
        const match = nearest(frameFiles, gem.seconds, 100);
        return match ? `frames/${match}` : null;
      })(),
    })),
  };
}

export async function execute(program, args, cwd, timeoutMs = 120000) {
  const child = spawn(program, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  let timedOut = false;
  let forceKill;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 5000);
  }, timeoutMs);
  let exitCode;
  try {
    exitCode = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceKill);
  }
  if (timedOut) {
    throw new Error(`${program} timed out after ${timeoutMs}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(`${program} failed (${exitCode}): ${Buffer.concat(stderr).toString("utf8").trim()}`);
  }
  return Buffer.concat(stdout).toString("utf8");
}

async function notifyDigest(title, body, priority = "default") {
  const response = await fetch(process.env.STALKER_TELEGRAM_NOTIFY_URL ?? "http://127.0.0.1:3847/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, body, source: "stalker-golem", priority }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`notification server returned HTTP ${response.status}`);
}

async function writeReceipt(path, receipt) {
  await atomicWrite(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

function digestMarkdown(date, runs, gems, dashboardUrl) {
  const highlights = [...gems].sort((a, b) => b.score - a.score || a.seconds - b.seconds).slice(0, 10);
  const archiveWarning = runs.some((run) => !run.archiveComplete)
    ? "\n> Archive warning: at least one run is processed but not archived. Dashboard delivery is intentionally independent of Brain Drive.\n"
    : "";
  return `# Stalker Digest — Theo — ${prettyDate(date)}\n\n${gems.length} gems across ${runs.length} recording${runs.length === 1 ? "" : "s"}.\n\nDashboard: ${dashboardUrl}\n${archiveWarning}\n## Top highlights\n\n${highlights.map((gem) => `- **${gem.score}/10 · ${gem.timestamp} · ${gem.type}:** ${gem.title} — ${gem.gist}`).join("\n")}\n`;
}

export async function runMorningDigest(options = {}) {
  const date = options.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("date must be YYYY-MM-DD");
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const orchestratorRoot = resolve(options.orchestratorRoot ?? join(dirname(repoRoot), "orchestrator"));
  const stalkerRoot = join(repoRoot, "docs.local/stalker-golem");
  const receiptPath = join(stalkerRoot, "LAST-RUN.json");
  const dashboardUrl = `${options.dashboardBase ?? DEFAULT_DASHBOARD_BASE}/${date}.html`;
  const dashboardPath = join(orchestratorRoot, `docs.local/dashboards-serve/stalker/${date}.html`);
  const digestPath = join(stalkerRoot, `digests/${date}.md`);

  if (!options.force) {
    const previous = await readFile(receiptPath, "utf8").then(JSON.parse).catch(() => null);
    const outputsExist = await Promise.all([
      access(dashboardPath).then(() => true).catch(() => false),
      access(digestPath).then(() => true).catch(() => false),
    ]).then((values) => values.every(Boolean));
    if (previous?.status === "success" && previous.dashboard_url === dashboardUrl && outputsExist) {
      return { status: "skipped", dashboardUrl, dashboardPath, digestPath };
    }
  }

  let receipt = { ts: new Date().toISOString(), status: "failed", digest_path: "", dashboard_url: "" };
  try {
    const entries = await readdir(stalkerRoot, { withFileTypes: true });
    const runDirs = entries
      .filter((entry) => entry.isDirectory() && entry.name.includes(`-${date}-`))
      .map((entry) => join(stalkerRoot, entry.name))
      .sort();
    const runs = (await Promise.all(runDirs.map(collectRun))).filter(Boolean);
    const gems = runs.flatMap((run) => run.gems);
    if (gems.length === 0) {
      const error = new Error(`no completed Stalker gems found for ${date}`);
      error.code = "NO_COMPLETED_GEMS";
      throw error;
    }

    if (options.sync !== false) {
      await execute(process.execPath, [join(orchestratorRoot, "scripts/sync-tailnet-dashboards.mjs")], orchestratorRoot);
    }
    const assetsRoot = join(orchestratorRoot, "docs.local/dashboards-serve/stalker/assets");
    await mkdir(assetsRoot, { recursive: true });
    for (const run of runs) {
      const link = join(assetsRoot, run.name);
      await rm(link, { force: true, recursive: true });
      await symlink(join(stalkerRoot, run.name), link, "dir");
    }

    await atomicWrite(dashboardPath, buildDashboard({ date, runs, gems }));
    const digest = digestMarkdown(date, runs, gems, dashboardUrl);
    await atomicWrite(digestPath, digest);
    if (options.verifyLive !== false) {
      const response = await (options.fetchImpl ?? fetch)(dashboardUrl, { signal: AbortSignal.timeout(10000) });
      const liveHtml = await response.text();
      if (!response.ok || !liveHtml.includes(`<title>Theo · ${prettyDate(date)}`)) {
        throw new Error(`live dashboard verification failed: HTTP ${response.status}`);
      }
    }
    const successReceipt = {
      ts: new Date().toISOString(),
      status: "success",
      digest_path: digestPath,
      dashboard_url: dashboardUrl,
    };
    if (options.notify !== false) {
      const warning = runs.some((run) => !run.archiveComplete) ? "\n⚠️ Brain Drive archive incomplete; dashboard still delivered." : "";
      const top = [...gems].sort((a, b) => b.score - a.score || a.seconds - b.seconds).slice(0, 5);
      const body = [`${gems.length} gems · ${runs.length} recording${runs.length === 1 ? "" : "s"}`, ...top.map((gem) => `• ${gem.score}/10 [${gem.timestamp}] ${gem.title}`), `Dashboard: ${dashboardUrl}${warning}`].join("\n");
      await (options.notifyImpl ?? notifyDigest)(`Stalker Digest — Theo, ${prettyDate(date)}`, body);
    }
    receipt = successReceipt;
    await writeReceipt(receiptPath, successReceipt);
    return { status: "success", gemCount: gems.length, dashboardUrl, dashboardPath, digestPath };
  } catch (error) {
    receipt.ts = new Date().toISOString();
    await writeReceipt(receiptPath, receipt);
    const now = options.now ?? new Date();
    const idtParts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Jerusalem",
    }).formatToParts(now);
    const idtMinutes = Number(idtParts.find((part) => part.type === "hour").value) * 60
      + Number(idtParts.find((part) => part.type === "minute").value);
    const preScheduleEmpty = error?.code === "NO_COMPLETED_GEMS" && idtMinutes < 7 * 60 + 30;
    if (options.notify !== false && !preScheduleEmpty) {
      await (options.notifyImpl ?? notifyDigest)(`Stalker Digest FAILED — ${date}`, String(error?.message ?? error), "high").catch((notifyError) => {
        process.stderr.write(`failure notification also failed: ${notifyError.message}\n`);
      });
    }
    throw error;
  }
}

function currentIdtDate() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Jerusalem",
  }).format(new Date());
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function main(argv) {
  const result = await runMorningDigest({
    date: optionValue(argv, "--date", currentIdtDate()),
    force: argv.includes("--force"),
    notify: !argv.includes("--skip-notify"),
    sync: !argv.includes("--skip-sync"),
    verifyLive: !argv.includes("--skip-live-verify"),
    repoRoot: optionValue(argv, "--repo-root", DEFAULT_REPO_ROOT),
    orchestratorRoot: optionValue(argv, "--orchestrator-root", undefined),
    dashboardBase: optionValue(argv, "--dashboard-base", process.env.STALKER_DASHBOARD_BASE),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`STALKER_MORNING_DIGEST_FAILED ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
