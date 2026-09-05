import { detectOS, checkDependency } from "../lib/deps";
import type { DependencyResult } from "../lib/deps";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const REQUIRED_DEPS = ["bun", "git", "claude"] as const;

/**
 * Validate a golems config object.
 */
export function validateConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (config === null || config === undefined || typeof config !== "object") {
    return { valid: false, errors: ["Config must be a non-null object"] };
  }

  const cfg = config as Record<string, unknown>;

  if (!("reposPath" in cfg) || cfg.reposPath === undefined) {
    errors.push("reposPath is required");
  } else if (typeof cfg.reposPath !== "string") {
    errors.push("reposPath must be a string");
  }

  if (!("tools" in cfg) || cfg.tools === undefined) {
    errors.push("tools is required");
  } else if (
    typeof cfg.tools !== "object" ||
    cfg.tools === null ||
    Array.isArray(cfg.tools)
  ) {
    errors.push("tools must be an object");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Run the setup check — verify all required dependencies are installed.
 */
export async function runSetupCheck(): Promise<boolean> {
  const os = detectOS();
  console.log(`Checking dependencies on ${os}...`);

  const results = await Promise.all(
    REQUIRED_DEPS.map((dep) => checkDependency(dep)),
  );

  const missing = results.filter((r) => !r.found);
  const found = results.filter((r) => r.found);

  for (const dep of found) {
    const ver = dep.version ? ` (${dep.version})` : "";
    console.log(`  + ${dep.name}${ver} — ${dep.path}`);
  }

  for (const dep of missing) {
    console.log(`  - ${dep.name} — not found`);
  }

  console.log(`\n${found.length}/${results.length} dependencies found.`);

  if (missing.length > 0) {
    console.log(`\nMissing: ${missing.map((d) => d.name).join(", ")}`);
    return false;
  }

  return true;
}
