#!/usr/bin/env bun

try {
  await import("../packages/shared/src/lib/load-env");
} catch {
  /* ok if not in repo root */
}

import { runShellbookExportCli } from "./cc-usage/shellbook-export-cli";

runShellbookExportCli(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
