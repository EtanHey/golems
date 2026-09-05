/**
 * Environment Variable Loader
 *
 * Ensures .env is loaded regardless of current working directory.
 * This fixes launchd jobs which run from / instead of the package root.
 *
 * USAGE: Import this at the TOP of any entry point that needs env vars:
 *   import "@/lib/load-env";
 *
 * Or call loadEnv() explicitly if you need to verify it loaded:
 *   import { loadEnv } from "@/lib/load-env";
 *   loadEnv();
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";

// Find .env by walking up from startPath, checking each directory
// In a Bun workspace, .env lives in individual packages or the workspace root
function findEnvFile(startPath: string): string | null {
  let dir = startPath;
  for (let i = 0; i < 10; i++) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) {
      return envPath;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let _loaded = false;

/** Load .env from package root, returns true if loaded successfully */
export function loadEnv(): boolean {
  if (_loaded) return true;

  // Try CWD first (launchd sets WorkingDirectory), then walk up from this file
  const envFile = findEnvFile(process.cwd()) ?? findEnvFile(dirname(import.meta.path));

  if (!envFile) {
    console.warn(`[load-env] No .env file found (searched from ${process.cwd()})`);
    return false;
  }

  const content = readFileSync(envFile, "utf-8");
  let count = 0;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);

    // Strip surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Don't override existing env vars (launchd or shell might set them)
    if (!process.env[key]) {
      process.env[key] = value;
      count++;
    }
  }

  _loaded = true;
  return true;
}

// Auto-load on import
loadEnv();
