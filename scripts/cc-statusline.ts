#!/usr/bin/env bun
/**
 * Lightweight Claude Code status line — replaces ccstatusline (60K lines, 85% CPU)
 *
 * Reads JSON from stdin (piped by Claude Code), formats two status lines.
 * No React, no Ink, no deps. ~200 lines.
 *
 * Output (with ANSI colors):
 *   ⎇ master | (+1786,-179) | 🔧 3 services
 *   🤖 Opus 4.6 | 💰 $3.49 | ⏱️  17m | 📦 4hr 3m | 🧠 64.8%
 *
 * Install: Update ~/.claude/settings.json statusLine.command
 */

import {
  computeContextPctForStatus,
  resolveContextWindowForStatus,
} from "./lib/model-context-window.ts";

// ANSI color codes
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

// Read stdin (Claude Code pipes JSON)
const chunks: string[] = [];
for await (const chunk of Bun.stdin.stream()) {
  chunks.push(new TextDecoder().decode(chunk));
}
const raw = chunks.join("");

let status: any;
try {
  status = JSON.parse(raw);
} catch {
  process.stdout.write(`${c.dim}⎇ ? | no data${c.reset}\n`);
  process.exit(0);
}

// --- Extract fields from JSON ---

// Model
const model =
  typeof status.model === "object"
    ? status.model.display_name || status.model.id || "?"
    : status.model || "?";

// Canonical model id (e.g. "claude-opus-4-8[1m]") for the context-window lookup — prefer the
// id over the display name since it always carries the version; fall back to display/model.
const modelIdForWindow =
  typeof status.model === "object"
    ? status.model.id || status.model.display_name || null
    : status.model || null;

// Cost
const cost = status.cost?.total_cost_usd ?? 0;
const costStr = cost < 0.01 ? "$0.00" : `$${cost.toFixed(2)}`;
const costColor = cost > 10 ? c.red : cost > 5 ? c.yellow : c.green;

// Session duration from total_duration_ms
const durationMs = status.cost?.total_duration_ms ?? 0;
const sessionStr = formatDuration(durationMs);

// Lines changed
const added = status.cost?.total_lines_added ?? 0;
const removed = status.cost?.total_lines_removed ?? 0;

// CWD for git
const cwd = status.cwd || status.workspace?.current_dir || process.cwd();

// --- Git info (fast, sync) ---
let gitBranch = "?";
try {
  gitBranch =
    Bun.spawnSync(["git", "branch", "--show-current"], { cwd })
      .stdout.toString()
      .trim() || "detached";
} catch {}

// --- Active launchd services count ---
let activeServices = 0;
try {
  const result = Bun.spawnSync(["launchctl", "list"], { cwd: "/" });
  const output = result.stdout.toString();
  activeServices = (output.match(/com\.golems\.|com\.golemszikaron\./g) || [])
    .length;
} catch {}

// --- Night Shift result (from state file) ---
let nightShiftResult = "";
try {
  const stateFile = Bun.file(`${process.env.HOME}/.golems-zikaron/state.json`);
  if (await stateFile.exists()) {
    const state = JSON.parse(await stateFile.text());
    if (state.nightShift?.lastResult) {
      const ns = state.nightShift;
      const ageMs = Date.now() - new Date(ns.lastRun || 0).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) {
        // Only show if from today
        nightShiftResult = ns.lastResult === "success" ? "✅" : "❌";
      }
    }
  }
} catch {}

// --- Context % from transcript ---
let contextPct = "";
let contextColor = c.green;
let blockStr = "";

if (status.context_window) {
  const resolution = resolveContextWindowForStatus({
    model: modelIdForWindow,
    contextWindow: status.context_window,
  });

  const liveContextTokens = contextTokensFromStatus(status.context_window);
  const liveUsedPct = finiteNumber(status.context_window.used_percentage);

  // Precedence lives in computeContextPctForStatus, not here — a second copy of the rule
  // in the caller is exactly what drifted in #730. This branch only decides whether we
  // have anything at all to render.
  if (liveContextTokens !== null || liveUsedPct !== null) {
    // The `*` marker means "this number came from a guessed window". It is only honest
    // when we actually divided by the inferred window: if we rendered the harness's own
    // used_percentage, our guess was never used and the marker would be misleading.
    const usedInferredWindow =
      resolution.inferredUnknownClaude &&
      resolution.source !== "live" &&
      liveUsedPct === null;

    setContextPct(
      computeContextPctForStatus({
        contextTokens: liveContextTokens ?? 0,
        model: modelIdForWindow,
        contextWindow: status.context_window,
      }),
      usedInferredWindow,
    );
  }
}

if (status.transcript_path) {
  try {
    const transcriptStat = Bun.file(status.transcript_path);
    if (await transcriptStat.exists()) {
      const size = transcriptStat.size;
      const readFrom = Math.max(0, size - 50000);
      const tail = await transcriptStat.slice(readFrom, size).text();

      const lines = tail.split("\n").filter((l) => l.includes('"usage"'));
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        try {
          const entry = JSON.parse(lastLine);
          const usage = entry.usage || entry.message?.usage;
          if (usage && !contextPct) {
            const inputTokens = usage.input_tokens || 0;
            const cacheRead = usage.cache_read_input_tokens || 0;
            const cacheCreate = usage.cache_creation_input_tokens || 0;
            const contextTokens = inputTokens + cacheRead + cacheCreate;

            const resolution = resolveContextWindowForStatus({
              model: modelIdForWindow,
              contextWindow: status.context_window,
            });
            setContextPct(
              computeContextPctForStatus({
                contextTokens,
                model: modelIdForWindow,
                contextWindow: status.context_window,
              }),
              resolution.inferredUnknownClaude,
            );
          }
        } catch {}
      }

      // Block timer from first timestamp
      const firstLines = tail.substring(0, 5000);
      const tsMatch = firstLines.match(/"timestamp":\s*"([^"]+)"/);
      if (tsMatch) {
        const blockStart = new Date(tsMatch[1]).getTime();
        if (blockStart > 0) {
          const blockEnd = blockStart + 5 * 60 * 60 * 1000;
          const remaining = blockEnd - Date.now();
          blockStr = remaining > 0 ? formatDuration(remaining) : "expired";
        }
      }
    }
  } catch {}
}

// --- Format output ---
const linesStr =
  added || removed
    ? ` ${c.gray}|${c.reset} ${c.green}+${added}${c.reset}${c.gray},${c.reset}${c.red}-${removed}${c.reset}`
    : "";

const servicesStr =
  activeServices > 0
    ? ` ${c.gray}|${c.reset} ${c.green}🔧 ${activeServices}${c.reset}`
    : "";

const nightStr = nightShiftResult
  ? ` ${c.gray}|${c.reset} 🌙${nightShiftResult}`
  : "";

const line1 = `${c.cyan}⎇${c.reset} ${c.bold}${gitBranch}${c.reset}${linesStr}${servicesStr}${nightStr}`;

const sep = ` ${c.gray}|${c.reset} `;
const parts = [
  `${c.magenta}🤖 ${model}${c.reset}`,
  `${costColor}💰 ${costStr}${c.reset}`,
  `${c.blue}⏱️  ${sessionStr}${c.reset}`,
];
if (blockStr) parts.push(`${c.yellow}📦 ${blockStr}${c.reset}`);
if (contextPct) parts.push(`${contextColor}🧠 ${contextPct}${c.reset}`);

const line2 = parts.join(sep);

process.stdout.write(`${line1}\n${line2}\n`);

// --- Helpers ---
function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${hrs}hr ${mins}m`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function contextTokensFromStatus(contextWindow: unknown): number | null {
  if (!contextWindow || typeof contextWindow !== "object") return null;
  const cw = contextWindow as {
    total_input_tokens?: unknown;
    current_usage?: unknown;
  };

  if (typeof cw.current_usage === "number") {
    return finiteNumber(cw.current_usage);
  }

  if (cw.current_usage && typeof cw.current_usage === "object") {
    const usage = cw.current_usage as {
      input_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
    };
    const tokenCounts = [
      finiteNumber(usage.input_tokens),
      finiteNumber(usage.cache_read_input_tokens),
      finiteNumber(usage.cache_creation_input_tokens),
    ];
    if (tokenCounts.some((value) => value !== null)) {
      return tokenCounts.reduce((sum, value) => sum + (value ?? 0), 0);
    }
  }

  const totalInput = finiteNumber(cw.total_input_tokens);
  if (totalInput !== null) return totalInput;

  return null;
}

function setContextPct(pct: number, inferredUnknownClaude: boolean): void {
  const marker = inferredUnknownClaude ? "*" : "";
  contextPct = `${pct.toFixed(1)}%${marker}`;
  contextColor = pct > 80 ? c.red : pct > 60 ? c.yellow : c.green;
}
