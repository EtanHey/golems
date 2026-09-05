#!/usr/bin/env bun
/**
 * Brand Config Validator
 *
 * Usage: bun run validate-brand [project-name]
 *   If no project specified, validates all projects.
 *
 * Examples:
 *   bun run validate-brand golems-showcase
 *   bun run validate-brand                  # validates all
 */

import { loadBrandConfig, type ValidationError } from "../src/brand/schema";
import { resolve, basename } from "path";
import { readdir } from "fs/promises";

const PROJECTS_DIR = resolve(import.meta.dir, "../projects");

async function validateProject(projectName: string): Promise<boolean> {
  const projectPath = resolve(PROJECTS_DIR, projectName);
  const { config, errors } = await loadBrandConfig(projectPath);

  if (errors.length === 0) {
    console.log(`  ${projectName}: PASS`);
    return true;
  }

  console.log(`  ${projectName}: FAIL (${errors.length} error${errors.length > 1 ? "s" : ""})`);
  for (const err of errors) {
    console.log(`    - ${err.path}: ${err.message}`);
  }
  return false;
}

async function main() {
  const targetProject = process.argv[2];

  if (targetProject) {
    console.log("Validating brand config:");
    const ok = await validateProject(targetProject);
    process.exit(ok ? 0 : 1);
  }

  // Validate all projects
  console.log("Validating all brand configs:");
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  let allOk = true;
  for (const project of projects) {
    const ok = await validateProject(project);
    if (!ok) allOk = false;
  }

  console.log(
    allOk
      ? `\nAll ${projects.length} projects valid.`
      : `\nSome projects have errors. Fix them and re-run.`,
  );
  process.exit(allOk ? 0 : 1);
}

main();
