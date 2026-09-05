#!/usr/bin/env bun
// CLI for crash-resume-index — capture-on-boot, lookup, and emit the resume cmd.
//
// Usage:
//   crash-resume-index-cli.mjs record  <surfaceId> <sessionId> <repo> [role]
//   crash-resume-index-cli.mjs lookup  <surfaceId>
//   crash-resume-index-cli.mjs resume-cmd <surfaceId> [maxAgeMs]
//
// Persists to the DURABLE default ~/.golems/crash-resume-index.json (override with
// --path <file> or CRASH_RESUME_INDEX_PATH). `record` is a LOCKED read-modify-
// write (recordToFile) so two panes booting at once don't drop each other's
// capture. `resume-cmd` prints the registered launcher line
// `<repo>Claude --resume <session-id>` (empty + exit 4 when there is no resumable
// session for that surface), so /orc's GREEN path can run it.
//
// Exit codes: 0 ok · 2 usage · 4 no-resumable.

import {
  DEFAULT_INDEX_PATH,
  loadIndex,
  recordToFile,
  lookup,
  resumeCommand,
} from "../src/crash-resume-index.mjs";

function parseArgs(argv) {
  const args = [];
  let indexPath = process.env.CRASH_RESUME_INDEX_PATH || DEFAULT_INDEX_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--path") {
      indexPath = argv[++i];
    } else {
      args.push(argv[i]);
    }
  }
  return { args, indexPath };
}

function usage(msg) {
  if (msg) console.error(`crash-resume-index: ${msg}`);
  console.error(
    "usage:\n" +
      "  record <surfaceId> <sessionId> <repo> [role]\n" +
      "  lookup <surfaceId>\n" +
      "  resume-cmd <surfaceId> [maxAgeMs]\n" +
      "  [--path <file>]",
  );
  process.exit(2);
}

function main() {
  const { args, indexPath } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args;

  if (cmd === "record") {
    const [surfaceId, sessionId, repo, role] = rest;
    if (!surfaceId || !sessionId || !repo) usage("record needs surfaceId sessionId repo");
    // LOCKED RMW — reloads under the lock so a concurrent pane's entry survives.
    recordToFile(indexPath, { surfaceId, sessionId, repo, role });
    console.log(`recorded ${surfaceId} → ${sessionId} (${repo})`);
    return;
  }

  if (cmd === "lookup") {
    const [surfaceId] = rest;
    if (!surfaceId) usage("lookup needs surfaceId");
    const entry = lookup(loadIndex(indexPath), surfaceId);
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  if (cmd === "resume-cmd") {
    const [surfaceId, maxAgeRaw] = rest;
    if (!surfaceId) usage("resume-cmd needs surfaceId");
    const opts = {};
    if (maxAgeRaw !== undefined) {
      const maxAgeMs = Number(maxAgeRaw);
      if (!Number.isFinite(maxAgeMs)) usage("maxAgeMs must be a number");
      opts.maxAgeMs = maxAgeMs;
    }
    const cmdLine = resumeCommand(loadIndex(indexPath), surfaceId, opts);
    if (!cmdLine) {
      // No resumable session — caller should spawn fresh (legit dispatch).
      process.exit(4);
    }
    console.log(cmdLine);
    return;
  }

  usage(cmd ? `unknown command "${cmd}"` : null);
}

main();
