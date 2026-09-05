#!/usr/bin/env bun
/**
 * CC Axiom Reporter — SessionEnd Hook Script
 *
 * Automatically reports Claude Code session usage to Axiom when a session ends.
 * Registered as a global SessionEnd hook in ~/.claude/settings.json.
 *
 * What it does:
 * 1. Reads SessionEnd payload from stdin (session_id, transcript_path, cwd)
 * 2. Parses .jsonl transcript for token usage
 * 3. Calculates cost using model pricing
 * 4. Enriches with Git metadata (project, branch)
 * 5. Sends to Axiom via @golems/shared
 *
 * Debug: CC_AXIOM_DEBUG=1 to dump stdin + log to ~/.golems/cc-axiom-debug.log
 */

import { readFileSync, appendFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";
import { hostname } from "os";
import { logCCUsage, flushAxiom } from "../packages/shared/src/lib/axiom";

// ─── Model Pricing (per MTok, synced from cc-usage.ts) ──────────

const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreate: number }> = {
  "claude-opus-4-6":              { input: 15.0,  output: 75.0,  cacheRead: 1.5,   cacheCreate: 18.75  },
  "claude-opus-4-5-20250620":     { input: 15.0,  output: 75.0,  cacheRead: 1.5,   cacheCreate: 18.75  },
  "claude-sonnet-4-5-20250929":   { input: 3.0,   output: 15.0,  cacheRead: 0.30,  cacheCreate: 3.75   },
  "claude-sonnet-4-5-20250514":   { input: 3.0,   output: 15.0,  cacheRead: 0.30,  cacheCreate: 3.75   },
  "claude-haiku-4-5-20251001":    { input: 0.80,  output: 4.0,   cacheRead: 0.08,  cacheCreate: 1.0    },
};

function getModelPricing(model: string) {
  if (PRICING[model]) return PRICING[model];
  if (model.includes("opus"))   return PRICING["claude-opus-4-6"];
  if (model.includes("sonnet")) return PRICING["claude-sonnet-4-5-20250929"];
  if (model.includes("haiku"))  return PRICING["claude-haiku-4-5-20251001"];
  return PRICING["claude-sonnet-4-5-20250929"];
}

// ─── Debug Logging ──────────────────────────────────────────────

const DEBUG = !!process.env.CC_AXIOM_DEBUG;
const GOLEMS_DIR = join(process.env.HOME || "/tmp", ".golems");

function debugLog(msg: string): void {
  if (!DEBUG) return;
  try {
    mkdirSync(GOLEMS_DIR, { recursive: true });
    appendFileSync(
      join(GOLEMS_DIR, "cc-axiom-debug.log"),
      `[${new Date().toISOString()}] ${msg}\n`
    );
  } catch { /* never fail on debug */ }
}

// ─── Transcript Parsing (matches cc-usage.ts format) ────────────

interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  messageCount: number;
  costUsd: number;
  model: string;
  modelCounts: Record<string, number>;
  firstTimestamp: string;
  lastTimestamp: string;
}

function parseTranscript(transcriptPath: string): SessionStats {
  const stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    messageCount: 0,
    costUsd: 0,
    model: "unknown",
    modelCounts: {},
    firstTimestamp: "",
    lastTimestamp: "",
  };

  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "assistant") continue;

      const msg = obj.message;
      if (!msg || typeof msg !== "object") continue;

      const usage = msg.usage;
      if (!usage) continue;

      const inTok = usage.input_tokens || 0;
      const outTok = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;

      stats.inputTokens += inTok;
      stats.outputTokens += outTok;
      stats.cacheReadTokens += cacheRead;
      stats.cacheCreateTokens += cacheCreate;
      stats.messageCount++;

      // Per-message cost using that message's model pricing
      const msgModel = msg.model || "unknown";
      const mp = getModelPricing(msgModel);
      stats.costUsd +=
        (inTok / 1_000_000) * mp.input +
        (outTok / 1_000_000) * mp.output +
        (cacheRead / 1_000_000) * mp.cacheRead +
        (cacheCreate / 1_000_000) * mp.cacheCreate;

      if (msgModel !== "unknown") {
        stats.modelCounts[msgModel] = (stats.modelCounts[msgModel] || 0) + 1;
      }

      if (!stats.firstTimestamp && obj.timestamp) stats.firstTimestamp = obj.timestamp;
      if (obj.timestamp) stats.lastTimestamp = obj.timestamp;
    } catch { /* skip malformed lines */ }
  }

  // Most-used model in the session
  const sorted = Object.entries(stats.modelCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) stats.model = sorted[0][0];

  return stats;
}

// ─── Git Metadata ───────────────────────────────────────────────

function getGitBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString().trim();
  } catch {
    return "unknown";
  }
}

function getProjectName(cwd: string): string {
  return basename(cwd);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  // Read SessionEnd payload from stdin
  const raw = await Bun.stdin.text();
  debugLog(`stdin: ${raw}`);

  // Dump stdin on first run for format verification
  if (DEBUG) {
    try {
      mkdirSync(GOLEMS_DIR, { recursive: true });
      await Bun.write(join(GOLEMS_DIR, "cc-session-end-stdin.json"), raw);
    } catch { /* ok */ }
  }

  if (!raw.trim()) {
    debugLog("empty stdin, exiting");
    process.exit(0);
  }

  const data = JSON.parse(raw);
  const sessionId = data.session_id || "";
  const transcriptPath = data.transcript_path || "";
  const cwd = data.cwd || process.cwd();

  debugLog(`session=${sessionId} transcript=${transcriptPath} cwd=${cwd}`);

  if (!transcriptPath) {
    debugLog("no transcript_path, exiting");
    process.exit(0);
  }

  // Parse transcript
  const stats = parseTranscript(transcriptPath);

  if (stats.messageCount === 0) {
    debugLog("no assistant messages found, exiting");
    process.exit(0);
  }

  // Cost is already calculated per-message in parseTranscript
  const cost = stats.costUsd;

  // Calculate duration
  let durationSeconds: number | undefined;
  if (data.duration_seconds) {
    durationSeconds = data.duration_seconds;
  } else if (stats.firstTimestamp && stats.lastTimestamp) {
    durationSeconds = Math.round(
      (new Date(stats.lastTimestamp).getTime() - new Date(stats.firstTimestamp).getTime()) / 1000
    );
  }

  // Git metadata
  const project = getProjectName(cwd);
  const branch = getGitBranch(cwd);

  debugLog(`model=${stats.model} cost=$${cost.toFixed(4)} msgs=${stats.messageCount} project=${project}`);

  // Send to Axiom
  logCCUsage({
    model: stats.model,
    project,
    input_tokens: stats.inputTokens,
    output_tokens: stats.outputTokens,
    cache_read_tokens: stats.cacheReadTokens,
    cache_write_tokens: stats.cacheCreateTokens,
    cost_estimate_usd: Math.round(cost * 10000) / 10000,
    session_id: sessionId,
    duration_seconds: durationSeconds,
    message_count: stats.messageCount,
    started_at: stats.firstTimestamp,
    ended_at: stats.lastTimestamp,
    source: "session-end-hook",
    hostname: hostname(),
    branch,
  });

  await flushAxiom();
  debugLog("sent to axiom, done");
}

// ─── Entry Point ────────────────────────────────────────────────

main()
  .then(() => process.exit(0))
  .catch((err) => {
    debugLog(`error: ${err.message}\n${err.stack}`);
    process.exit(0); // Always exit clean — never block CC shutdown
  });
