#!/usr/bin/env bun
/**
 * Job Golem - Watchlist
 *
 * Track target companies (React-stack Israeli startups) for:
 * - Job posting alerts (via Indeed/ts-jobspy)
 * - Direct outreach when no jobs posted
 *
 * Data from: Startup Nation Finder (FREE)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME;
if (!HOME) throw new Error("HOME environment variable is required");
const DATA_DIR = join(HOME, ".golems-zikaron/job-golem");
const WATCHLIST_FILE = join(DATA_DIR, "watchlist.json");

export interface WatchlistCompany {
  id: string;              // Slug from name
  name: string;
  website?: string;
  careersUrl?: string;     // Direct link to careers page
  techStack: string[];     // ["React", "TypeScript", "Node.js"]
  location?: string;       // "Tel Aviv", "Remote", etc.
  size?: string;           // "1-10", "11-50", "51-200", etc.
  contacts?: Contact[];    // Decision makers for outreach
  notes?: string;
  addedAt: string;
  lastChecked?: string;    // Last time we checked for jobs
  lastJobFound?: string;   // Last time we found a job posting
  status: "active" | "applied" | "rejected" | "paused";
}

export interface Contact {
  name: string;
  title: string;           // "Engineering Manager", "CTO", etc.
  email?: string;          // From Lusha/Hunter.io
  linkedin?: string;
  source?: string;         // "github", "linkedin", "lusha"
}

export interface Watchlist {
  companies: WatchlistCompany[];
  lastUpdated: string;
}

function ensureDataDir() {
  const fs = require("fs");
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadWatchlist(): Watchlist {
  try {
    if (existsSync(WATCHLIST_FILE)) {
      return JSON.parse(readFileSync(WATCHLIST_FILE, "utf-8"));
    }
  } catch {}
  return { companies: [], lastUpdated: new Date().toISOString() };
}

export function saveWatchlist(watchlist: Watchlist) {
  ensureDataDir();
  watchlist.lastUpdated = new Date().toISOString();
  writeFileSync(WATCHLIST_FILE, JSON.stringify(watchlist, null, 2));
}

/**
 * Add a company to the watchlist
 */
export function addCompany(
  name: string,
  options: Partial<Omit<WatchlistCompany, "id" | "name" | "addedAt" | "status">> = {}
): WatchlistCompany {
  const watchlist = loadWatchlist();

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");

  // Check if already exists
  const existing = watchlist.companies.find(c => c.id === id);
  if (existing) {
    console.log(`[Watchlist] "${name}" already exists`);
    return existing;
  }

  const company: WatchlistCompany = {
    id,
    name,
    techStack: options.techStack || [],
    status: "active",
    addedAt: new Date().toISOString(),
    ...options,
  };

  watchlist.companies.push(company);
  saveWatchlist(watchlist);

  console.log(`[Watchlist] Added "${name}"`);
  return company;
}

/**
 * Update a company's info
 */
export function updateCompany(
  id: string,
  updates: Partial<Omit<WatchlistCompany, "id" | "addedAt">>
): WatchlistCompany | null {
  const watchlist = loadWatchlist();
  const idx = watchlist.companies.findIndex(c => c.id === id);

  if (idx === -1) {
    console.log(`[Watchlist] Company "${id}" not found`);
    return null;
  }

  watchlist.companies[idx] = { ...watchlist.companies[idx], ...updates };
  saveWatchlist(watchlist);

  return watchlist.companies[idx];
}

/**
 * Get active companies (for job checking)
 */
export function getActiveCompanies(): WatchlistCompany[] {
  const watchlist = loadWatchlist();
  return watchlist.companies.filter(c => c.status === "active");
}

/**
 * Get companies that haven't been checked recently
 */
export function getStaleCompanies(hoursOld = 24): WatchlistCompany[] {
  const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
  const watchlist = loadWatchlist();

  return watchlist.companies.filter(c => {
    if (c.status !== "active") return false;
    if (!c.lastChecked) return true;
    return new Date(c.lastChecked).getTime() < cutoff;
  });
}

/**
 * Mark company as checked
 */
export function markChecked(id: string, foundJob = false) {
  const updates: Partial<WatchlistCompany> = {
    lastChecked: new Date().toISOString(),
  };
  if (foundJob) {
    updates.lastJobFound = new Date().toISOString();
  }
  updateCompany(id, updates);
}

/**
 * Get companies for direct outreach (no recent job postings)
 */
export function getOutreachCandidates(): WatchlistCompany[] {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const watchlist = loadWatchlist();

  return watchlist.companies.filter(c => {
    if (c.status !== "active") return false;
    // No job found in 30+ days = good outreach candidate
    if (!c.lastJobFound) return true;
    return new Date(c.lastJobFound).getTime() < thirtyDaysAgo;
  });
}

/**
 * Seed watchlist with initial companies
 * Run this once to populate from manual research
 */
export function seedWatchlist() {
  // React-stack Israeli startups (from Startup Nation Finder research)
  const seedCompanies: Array<{ name: string; website?: string; techStack?: string[] }> = [
    { name: "Monday.com", website: "monday.com", techStack: ["React", "TypeScript", "Node.js"] },
    { name: "Wix", website: "wix.com", techStack: ["React", "TypeScript", "Node.js"] },
    { name: "Fiverr", website: "fiverr.com", techStack: ["React", "TypeScript"] },
    { name: "JFrog", website: "jfrog.com", techStack: ["React", "TypeScript"] },
    { name: "Gong.io", website: "gong.io", techStack: ["React", "TypeScript"] },
    { name: "Papaya Global", website: "papayaglobal.com", techStack: ["React", "TypeScript"] },
    { name: "Hibob", website: "hibob.com", techStack: ["React", "TypeScript", "Node.js"] },
    { name: "Lightricks", website: "lightricks.com", techStack: ["React Native", "TypeScript"] },
    { name: "Taboola", website: "taboola.com", techStack: ["React", "TypeScript"] },
    { name: "ironSource", website: "ironsource.com", techStack: ["React", "TypeScript"] },
    // Add more as you research...
  ];

  console.log("[Watchlist] Seeding initial companies...");

  for (const company of seedCompanies) {
    addCompany(company.name, {
      website: company.website,
      techStack: company.techStack || ["React", "TypeScript"],
    });
  }

  console.log(`[Watchlist] Seeded ${seedCompanies.length} companies`);
}

// CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "seed":
      seedWatchlist();
      break;

    case "add":
      if (!args[1]) {
        console.log("Usage: bun watchlist.ts add <company-name> [website]");
        break;
      }
      addCompany(args[1], { website: args[2] });
      break;

    case "list":
      const watchlist = loadWatchlist();
      console.log(`\n📋 Watchlist (${watchlist.companies.length} companies)\n`);
      for (const c of watchlist.companies) {
        const status = c.status === "active" ? "✓" : c.status === "applied" ? "📝" : "⏸";
        console.log(`  ${status} ${c.name} - ${c.techStack.join(", ") || "?"}`);
      }
      break;

    case "outreach":
      const candidates = getOutreachCandidates();
      console.log(`\n🎯 Outreach Candidates (${candidates.length})\n`);
      for (const c of candidates) {
        console.log(`  • ${c.name} - ${c.website || "no website"}`);
      }
      break;

    default:
      console.log(`
Job Golem Watchlist

Commands:
  seed      - Populate with initial companies
  add NAME  - Add a company
  list      - Show all companies
  outreach  - Show companies for direct outreach
`);
  }
}
