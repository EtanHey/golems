#!/usr/bin/env bun

/**
 * CLI for `golems skills list` command.
 * Shows available integrations and their status.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";

const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[0;33m";
const BLUE = "\x1b[0;34m";
const GRAY = "\x1b[90m";
const NC = "\x1b[0m";

interface Skill {
  name: string;
  description: string;
  category: string;
  free_tier: string;
  setup_complexity: string;
  relevant_project_types: string[];
  url: string;
  status: "active" | "planned" | "evaluation";
}

interface SkillsCatalog {
  version: number;
  updated: string;
  community_resource: string;
  skills: Skill[];
}

/**
 * Get colored status icon for a skill
 * @param status - Skill status (active/planned/evaluation)
 * @returns Colored icon string (● for active, ○ for planned, ◌ for evaluation)
 */
function statusIcon(status: string): string {
  switch (status) {
    case "active": return `${GREEN}●${NC}`;
    case "planned": return `${YELLOW}○${NC}`;
    case "evaluation": return `${GRAY}◌${NC}`;
    default: return "?";
  }
}

/**
 * Load skills catalog from available-skills.json
 * @returns Parsed skills catalog with version, updated date, and skills list
 * @throws If catalog file is missing or contains invalid JSON
 */
function loadCatalog(): SkillsCatalog {
  const catalogPath = join(import.meta.dir, "available-skills.json");
  return JSON.parse(readFileSync(catalogPath, "utf-8"));
}

/**
 * Print skills in compact single-line format
 * @param catalog - Skills catalog to display
 */
function compactMode(catalog: SkillsCatalog): void {
  const active = catalog.skills.filter(s => s.status === "active").map(s => s.name);
  const planned = catalog.skills.filter(s => s.status === "planned").map(s => s.name);
  console.log(`skills: ${active.join(", ")} | planned: ${planned.join(", ")}`);
}

/**
 * Print skills in formatted table with categories and details
 * @param catalog - Skills catalog to display
 */
function tableMode(catalog: SkillsCatalog): void {
  console.log(`\n${BLUE}=== GOLEMS SKILLS ===${NC}\n`);

  const categories = [...new Set(catalog.skills.map(s => s.category))];

  for (const cat of categories) {
    const skills = catalog.skills.filter(s => s.category === cat);
    console.log(`  ${BLUE}${cat}${NC}`);

    for (const skill of skills) {
      const icon = statusIcon(skill.status);
      const complexity = skill.setup_complexity;
      console.log(`    ${icon} ${skill.name.padEnd(16)} ${GRAY}[${complexity}]${NC} ${skill.description}`);
      console.log(`      ${GRAY}Free: ${skill.free_tier}${NC}`);
    }
    console.log();
  }

  console.log(`${GRAY}Legend: ${GREEN}● active${NC}  ${YELLOW}○ planned${NC}  ${GRAY}◌ evaluation${NC}`);
  console.log(`${GRAY}Community tools: ${catalog.community_resource}${NC}`);
  if ((catalog as any)._community_resource_todo) {
    console.log(`${YELLOW}⚠ ${(catalog as any)._community_resource_todo}${NC}`);
  }
  console.log(`${GRAY}Updated: ${catalog.updated}${NC}\n`);
}

/**
 * Print skills filtered by category, project type, or status
 * @param catalog - Skills catalog to filter
 * @param filter - Filter string (category/project type/status)
 */
function filterMode(catalog: SkillsCatalog, filter: string): void {
  const filtered = catalog.skills.filter(s =>
    s.category === filter ||
    s.relevant_project_types.includes(filter) ||
    s.status === filter
  );

  if (filtered.length === 0) {
    console.log(`No skills match filter "${filter}"`);
    return;
  }

  for (const skill of filtered) {
    const icon = statusIcon(skill.status);
    console.log(`${icon} ${skill.name} — ${skill.description} (${skill.url})`);
  }
}

// Main
const catalog = loadCatalog();
const args = process.argv.slice(2);

if (args.includes("--compact")) {
  compactMode(catalog);
} else if (args.includes("--filter") && args[args.indexOf("--filter") + 1]) {
  filterMode(catalog, args[args.indexOf("--filter") + 1]);
} else {
  tableMode(catalog);
}
