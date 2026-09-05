#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLiveAdapter } from "../lib/live-evidence.mjs";
import { McpStdioClient } from "../lib/mcp-stdio-client.mjs";
import { formatMarkdown, runPaneLivenessSweep } from "../src/pane-liveness-check.mjs";

const HELP = `pane-liveness-check — read-only cmux claim-or-close sweep

Usage:
  pane-liveness-check-cli.mjs [--json]
  pane-liveness-check-cli.mjs --help

The sweep is detection-only: it never closes, kills, sends to, retitles, checks out,
or mutates panes or worktrees. Numeric surface refs are display-only; rows are keyed
by stable UUID and stale refs receive no disposition.

Options:
  --json   Emit structured JSON instead of the Markdown claim-or-close table.
  --help   Show this help.
`;

async function connectClient() {
  const command = process.env.PANE_LIVENESS_CMUXLAYER_BIN || "cmuxlayer";
  const primary = new McpStdioClient({ command, timeoutMs: 15_000 });
  try {
    await primary.connect();
    return primary;
  } catch (firstError) {
    await primary.close();
    const fallback = new McpStdioClient({
      command,
      timeoutMs: 20_000,
      env: { CMUXLAYER_FORCE_INPROCESS: "1" },
    });
    try {
      await fallback.connect();
      return fallback;
    } catch (fallbackError) {
      await fallback.close();
      throw new Error(`cmuxlayer connection failed: ${firstError.message}; fallback: ${fallbackError.message}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const unknown = argv.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(`unknown option: ${unknown[0]}\n${HELP}`);
    return 2;
  }

  let client;
  try {
    client = await connectClient();
    const rows = await runPaneLivenessSweep(createLiveAdapter({ mcp: client }));
    process.stdout.write(argv.includes("--json") ? `${JSON.stringify({ rows }, null, 2)}\n` : `${formatMarkdown(rows)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`pane-liveness-check: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  } finally {
    await client?.close();
  }
}

function sameEntrypoint(candidate, modulePath) {
  try {
    return realpathSync(candidate) === realpathSync(modulePath);
  } catch {
    return path.resolve(candidate) === path.resolve(modulePath);
  }
}

const isMain = process.argv[1] && sameEntrypoint(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  process.exitCode = await main();
}
