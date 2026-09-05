#!/usr/bin/env bun
/**
 * verify-tailnet-publish — fail-closed same-run publish probe.
 *
 * After sync-tailnet-dashboards.mjs runs, this checks that the rendered
 * docs.local dashboard is reachable from the tailnet hub with HTTP 200 and that
 * the served HTML bytes match the local artifact. No caller should print a
 * "published" or "live" success line unless this script exits 0.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value?.startsWith?.("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function fail(message) {
  console.error(`[verify-tailnet-publish] FATAL: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { timeoutMs: 15000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec") args.spec = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else if (arg === "-h" || arg === "--help") args.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  return args;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function outputPathFromArgs(args) {
  if (args.out) return path.resolve(expandHome(args.out));
  if (!args.spec) fail("--spec <job.json> or --out <html> is required");
  const specPath = path.resolve(expandHome(args.spec));
  if (!existsSync(specPath)) fail(`spec not found: ${specPath}`);
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  if (!spec.outputPath) fail(`spec has no outputPath: ${specPath}`);
  return path.resolve(expandHome(spec.outputPath));
}

function deriveUrl(outPath, args, env = process.env) {
  if (args.url || env.AUDIO_DASHBOARD_TAILNET_URL) return args.url || env.AUDIO_DASHBOARD_TAILNET_URL;
  const baseUrl = args.baseUrl || env.AUDIO_DASHBOARD_TAILNET_BASE_URL || env.TAILNET_DASHBOARD_BASE_URL;
  if (!baseUrl) {
    fail("missing tailnet base URL; pass --base-url or set AUDIO_DASHBOARD_TAILNET_BASE_URL");
  }
  const marker = `${path.sep}docs.local${path.sep}dashboards${path.sep}`;
  const index = outPath.indexOf(marker);
  if (index === -1) {
    fail(`cannot derive tailnet URL from non-docs.local dashboard path: ${outPath}`);
  }
  const rel = outPath.slice(index + marker.length).split(path.sep).map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${rel}`;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: bun scripts/verify-tailnet-publish.mjs --spec <job.json> [--out <html>] [--url <tailnet-url>|--base-url <hub/dashboards>] [--timeout-ms <ms>]");
    process.exit(0);
  }
  const outPath = outputPathFromArgs(args);
  if (!existsSync(outPath)) fail(`rendered dashboard not found: ${outPath}`);
  const localBytes = readFileSync(outPath);
  const tailnetUrl = deriveUrl(outPath, args);
  const probeUrl = `${tailnetUrl}${tailnetUrl.includes("?") ? "&" : "?"}audioDashboardProbe=${Date.now()}`;

  let response;
  try {
    response = await fetchWithTimeout(probeUrl, args.timeoutMs);
  } catch (err) {
    fail(`tailnet probe failed for ${tailnetUrl}: ${err?.message || err}`);
  }
  if (response.status !== 200) {
    fail(`tailnet probe returned HTTP ${response.status} for ${tailnetUrl}; expected HTTP 200`);
  }

  const remoteBytes = Buffer.from(await response.arrayBuffer());
  const localHash = sha256(localBytes);
  const remoteHash = sha256(remoteBytes);
  if (localHash !== remoteHash) {
    fail(`tailnet artifact hash mismatch for ${tailnetUrl}: local=${localHash} remote=${remoteHash}`);
  }

  console.log(`[verify-tailnet-publish] TAILNET_OK ${tailnetUrl} HTTP 200 sha256=${localHash}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
