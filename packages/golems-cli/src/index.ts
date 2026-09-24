#!/usr/bin/env bun
import { runSetupCheck } from "./commands/setup";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`golems v${VERSION} — Golems ecosystem CLI

Usage: golems <command> [options]

Commands:
  setup     Check dependencies and configure the environment

Options:
  --version, -v  Show version
  --help, -h     Show help

Examples:
  golems setup --check`);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("-"));
  const flags = new Set(args.filter((a) => a.startsWith("-")));

  return {
    command: positional[0],
    check: flags.has("--check"),
    help: flags.has("--help") || flags.has("-h"),
    version: flags.has("--version") || flags.has("-v"),
  };
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help && !opts.command) {
    printHelp();
    return;
  }

  if (opts.version && !opts.command) {
    console.log(VERSION);
    return;
  }

  if (!opts.command) {
    printHelp();
    return;
  }

  switch (opts.command) {
    case "setup":
      if (opts.check) {
        const allFound = await runSetupCheck();
        if (!allFound) process.exit(1);
      } else {
        printHelp();
      }
      break;
    default:
      console.error(`Unknown command: ${opts.command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
