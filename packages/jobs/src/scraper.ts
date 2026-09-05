#!/usr/bin/env bun
/**
 * Job Golem - Scraper
 *
 * Scrapes job listings from:
 * - Indeed Israel (via ts-jobspy, no rate limits)
 * - SecretTLV (English, tech-focused)
 * - Drushim (Hebrew, general tech)
 * - Goozali Telegram channels
 * - Greenhouse ATS boards (free JSON API, Israeli companies)
 * - Lever ATS boards (free JSON API, Israeli companies)
 *
 * Fetches each job page to verify active and get real details.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { scrapeJobs as scrapeIndeed } from "ts-jobspy";

const HOME = process.env.HOME;
if (!HOME) throw new Error("HOME environment variable is required");
const DATA_DIR = join(HOME, ".golems-zikaron/job-golem");
const SEEN_FILE = join(DATA_DIR, "seen-jobs.json");
const SECRETLV_CACHE_FILE = join(DATA_DIR, "secretlv-cache.json");
const SCRAPED_JOBS_FILE = join(DATA_DIR, "scraped-jobs.json");
const CACHE_TTL_HOURS = 24;

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  experience: string;
  description: string;
  url: string;
  source: "secretTLV" | "drushim" | "indeed" | "goozali" | "greenhouse" | "lever";
  language: "en" | "he";
  scrapedAt: string;
}

// Goozali Telegram channels to monitor
const GOOZALI_CHANNELS = [
  { name: "hitechjobsjunior", label: "Junior" },
  { name: "hitechjobsisrael", label: "Software" },
  { name: "hitechjobsdatascience", label: "AI/ML" },
  // Private channels need user to forward messages - skip for now
  // { name: "+CwDWQuAZC_owODc0", label: "Frontend" },
  // { name: "+5nK1fQiqLO1iZDI0", label: "Mobile" },
];

// Ensure data directory exists
function ensureDataDir() {
  const fs = require("fs");
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Load seen job IDs (to avoid duplicates)
function loadSeenJobs(): Set<string> {
  try {
    if (existsSync(SEEN_FILE)) {
      const data = JSON.parse(readFileSync(SEEN_FILE, "utf-8"));
      return new Set(data);
    }
  } catch {}
  return new Set();
}

// Save seen job IDs
function saveSeenJobs(seen: Set<string>) {
  writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2));
}

// Load all scraped jobs (for sync to Supabase)
export function loadScrapedJobs(): JobListing[] {
  try {
    if (!existsSync(SCRAPED_JOBS_FILE)) {
      return [];
    }

    const content = readFileSync(SCRAPED_JOBS_FILE, "utf-8");
    const parsed = JSON.parse(content);

    // Validate that it's an array
    if (!Array.isArray(parsed)) {
      console.error(`[Scraper] ${SCRAPED_JOBS_FILE} is not an array, returning empty`);
      return [];
    }

    // Basic validation: check first few items have required fields
    for (const item of parsed.slice(0, 3)) {
      if (!item.id || !item.title || !item.url) {
        console.error(`[Scraper] ${SCRAPED_JOBS_FILE} contains invalid job entries`);
        return [];
      }
    }

    return parsed;
  } catch (err) {
    console.error(`[Scraper] Error loading ${SCRAPED_JOBS_FILE}:`, err);
    return [];
  }
}

// Save scraped jobs (append new, keep last 2000)
function saveScrapedJobs(newJobs: JobListing[]) {
  try {
    const existing = loadScrapedJobs();
    const combined = [...newJobs, ...existing].slice(0, 2000);
    writeFileSync(SCRAPED_JOBS_FILE, JSON.stringify(combined, null, 2));
  } catch (err) {
    console.error(`[Scraper] Error saving to ${SCRAPED_JOBS_FILE}:`, err);
    throw err; // Rethrow so caller knows save failed
  }
}

// SecretTLV cache: { slug: { job: JobListing | null, cachedAt: ISO string } }
interface SecretLVCache {
  [slug: string]: {
    job: JobListing | null;  // null = verified inactive
    cachedAt: string;
  };
}

function loadSecretLVCache(): SecretLVCache {
  try {
    if (existsSync(SECRETLV_CACHE_FILE)) {
      return JSON.parse(readFileSync(SECRETLV_CACHE_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function saveSecretLVCache(cache: SecretLVCache) {
  // Clean up entries older than 7 days to prevent unbounded growth
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const cleaned: SecretLVCache = {};
  for (const [slug, entry] of Object.entries(cache)) {
    if (new Date(entry.cachedAt).getTime() > weekAgo) {
      cleaned[slug] = entry;
    }
  }
  writeFileSync(SECRETLV_CACHE_FILE, JSON.stringify(cleaned, null, 2));
}

function isCacheValid(cachedAt: string): boolean {
  const cacheTime = new Date(cachedAt).getTime();
  const ttlMs = CACHE_TTL_HOURS * 60 * 60 * 1000;
  return Date.now() - cacheTime < ttlMs;
}

/**
 * Fetch with retry logic for rate limiting (429)
 * TODO: Increase delay between requests (slower but more reliable) - currently hits 429 after ~50 jobs
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response | null> {
  let delay = 5000; // Start with 5 second delay

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options);

      if (resp.status === 429) {
        if (attempt < maxRetries) {
          console.log(`    ⏳ Rate limited, waiting ${delay / 1000}s...`);
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
        return null;
      }

      return resp;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      return null;
    }
  }

  return null;
}

/**
 * Fetch a single SecretTLV job page and extract details
 * Returns null if job is inactive/expired
 */
async function fetchSecretTLVJobDetails(url: string, slug: string): Promise<JobListing | null> {
  try {
    const resp = await fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!resp || !resp.ok) {
      return null;
    }

    const html = await resp.text();

    // Check if job is inactive/expired
    if (
      html.includes("Selected job is inactive") ||
      html.includes("do not exist") ||
      html.includes("has expired") ||
      html.includes("no longer available")
    ) {
      return null;
    }

    // Strategy 1: Parse JSON-LD structured data (most reliable)
    const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        if (ld.title || ld["@type"] === "JobPosting") {
          const title = (ld.title || "").trim();
          const company = ld.hiringOrganization?.name || "Unknown";
          const location = ld.jobLocation?.address?.addressLocality || "Israel";
          const description = (ld.description || "")
            .replace(/\\n/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 2000);

          if (title) {
            return {
              id: `stlv-${slug}`,
              title,
              company,
              location: location.replace(/,?\s*Israel$/i, "").trim() || "Israel",
              experience: "",
              description,
              url,
              source: "secretTLV",
              language: "en",
              scrapedAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        // JSON parse failed, fall through to regex
      }
    }

    // Strategy 2: Regex fallback for pages without JSON-LD
    let title = "";
    const titlePatterns = [
      /<h1[^>]*>\s*([^<]+)\s*<\/h1>/i,
      /<title>([^<|]+)/i,
    ];
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && !match[1].includes("Secret Tel Aviv")) {
        title = match[1].trim();
        break;
      }
    }
    if (!title) {
      title = slug.replace(/-\d+$/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }

    let company = "Unknown";
    const companyMatch = html.match(/company\/([^/]+)\//i);
    if (companyMatch && companyMatch[1]) {
      company = companyMatch[1].replace(/-external-job-board$/, "").replace(/-/g, " ")
        .split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }

    let location = "Israel";
    const locationMatch = html.match(/(Tel Aviv|Ramat Gan|Herzliya|Jerusalem|Haifa|Remote|Hybrid)/i);
    if (locationMatch) location = locationMatch[1];

    let description = "";
    // Strategy A: wpjb-text class (most reliable for SecretTLV)
    const wpjbMatch = html.match(/<div class="wpjb-text">\s*([\s\S]*?)\s*<\/div>/i);
    if (wpjbMatch && wpjbMatch[1]) {
      description = wpjbMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);
    }
    // Strategy B: h3 Description header with div wrapper
    if (!description) {
      const descMatch = html.match(/<h3>Description<\/h3>\s*<div[^>]*>([\s\S]*?)<\/div>/i);
      if (descMatch && descMatch[1]) {
        description = descMatch[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000);
      }
    }

    return {
      id: `stlv-${slug}`,
      title,
      company,
      location,
      experience: "",
      description,
      url,
      source: "secretTLV",
      language: "en",
      scrapedAt: new Date().toISOString(),
    };
  } catch (err) {
    return null;
  }
}

/**
 * Scrape SecretTLV jobs
 * Fetches each job page to verify active and get real details
 * TODO: Cache results so we don't re-verify recently checked URLs (e.g., 24h cache by slug)
 */
export async function scrapeSecretTLV(): Promise<JobListing[]> {
  console.log("[SecretTLV] Searching for developer jobs...");

  const jobUrls: { slug: string; url: string }[] = [];
  const seenSlugs = new Set<string>();

  // Search for developer jobs
  const searchTerms = ["developer", "engineer", "react", "frontend", "fullstack", "backend", "software"];

  for (const term of searchTerms) {
    try {
      // Use retry logic for search requests too
      const resp = await fetchWithRetry(
        `https://jobs.secrettelaviv.com/?s=${term}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        },
        2 // max 2 retries for search
      );

      if (!resp || !resp.ok) continue;

      const html = await resp.text();
      const jobLinks = html.matchAll(/href="https:\/\/jobs\.secrettelaviv\.com\/job\/([^"]+)"/g);

      for (const match of jobLinks) {
        const slug = match[1].replace(/\/$/, "");
        if (seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);
        jobUrls.push({ slug, url: `https://jobs.secrettelaviv.com/job/${slug}/` });
      }

      // Longer delay between search requests
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      // Continue on error
    }
  }

  // Load cache for faster verification
  const cache = loadSecretLVCache();
  let cacheHits = 0;
  let cacheMisses = 0;

  console.log(`[SecretTLV] Found ${jobUrls.length} URLs, verifying with cache...`);

  // Fetch each job page to verify active and get details
  const jobs: JobListing[] = [];
  let inactive = 0;

  // Process in batches of 10, with longer pauses between batches
  const BATCH_SIZE = 10;
  const DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds between each request
  const DELAY_BETWEEN_BATCHES = 15000; // 15 seconds between batches

  for (let i = 0; i < jobUrls.length; i++) {
    const { slug, url } = jobUrls[i];

    // Progress indicator every 10 jobs
    if (i % BATCH_SIZE === 0 && i > 0) {
      console.log(`  📊 Progress: ${i}/${jobUrls.length} (${jobs.length} active, ${inactive} inactive, ${cacheHits} cached)`);
      // Longer pause between batches
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }

    // Check cache first (24h TTL)
    const cached = cache[slug];
    if (cached && isCacheValid(cached.cachedAt)) {
      cacheHits++;
      if (cached.job) {
        jobs.push(cached.job);
        console.log(`  ⚡ ${cached.job.title.slice(0, 40)}... (cached)`);
      } else {
        inactive++;  // Cached as inactive
      }
      continue;  // Skip fetch, no delay needed
    }

    // Cache miss - fetch and verify
    cacheMisses++;
    const job = await fetchSecretTLVJobDetails(url, slug);

    // Cache the result (job or null for inactive)
    cache[slug] = {
      job,
      cachedAt: new Date().toISOString(),
    };

    if (job) {
      jobs.push(job);
      console.log(`  ✓ ${job.title.slice(0, 40)}... (${job.location})`);
    } else {
      inactive++;
    }

    // Delay between requests (only for cache misses)
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS));
  }

  // Save cache for next run
  saveSecretLVCache(cache);

  console.log(`[SecretTLV] ${jobs.length} active jobs (${inactive} inactive, ${cacheHits} cache hits, ${cacheMisses} fetched)`);
  return jobs;
}

/**
 * Fetch a single Drushim job page
 */
async function fetchDrushimJobDetails(url: string, jobId: string, listingTitle?: string): Promise<JobListing | null> {
  try {
    const resp = await fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
      },
    });

    if (!resp || !resp.ok) return null;

    const html = await resp.text();

    // Check if job is inactive
    if (html.includes("המשרה לא פעילה") || html.includes("not found") || html.includes("404")) {
      return null;
    }

    // Strategy 1: Parse JSON-LD structured data (most reliable)
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>\s*(\{"@context[\s\S]*?\})\s*<\/script>/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        if (ld["@type"] === "JobPosting" && ld.title) {
          const title = ld.title.trim();
          const company = ld.hiringOrganization?.name || "דרושים";
          const location = ld.jobLocation?.address?.addressLocality || "ישראל";
          const description = (ld.description || "")
            .replace(/<br\s*\/?>/g, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 2000);

          return {
            id: `drushim-${jobId}`,
            title,
            company,
            location,
            experience: "",
            description,
            url,
            source: "drushim",
            language: "he",
            scrapedAt: new Date().toISOString(),
          };
        }
      } catch {
        // JSON parse failed, fall through to og:tags
      }
    }

    // Strategy 2: og:tags + <title> fallback
    let title = `Job #${jobId}`;

    // Try content= anywhere in meta tag containing og:title
    const ogTitleMatch = html.match(/<meta[^>]*og:title[^>]*content="([^"]+)"[^>]*>/i) ||
                         html.match(/content="([^"]+)"[^>]*og:title/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      title = ogTitleMatch[1].replace(/^דרושים IL\s*-\s*/, "").trim();
    }
    // Fallback to <title> tag
    if (title === `Job #${jobId}`) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].replace(/^דרושים IL\s*-\s*/, "").trim();
      }
    }
    // Fallback to <h1> tag
    if (title === `Job #${jobId}`) {
      const h1Match = html.match(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i);
      if (h1Match && h1Match[1] && !h1Match[1].includes("דרושים IL")) {
        title = h1Match[1].trim();
      }
    }
    // Final fallback: use title from listing page
    if (title === `Job #${jobId}` && listingTitle) {
      title = listingTitle;
    }

    let company = "דרושים";
    const companyPatterns = [/חברת\s+([^\s,]+)/, /בחברת\s+([^\s,]+)/];
    for (const pattern of companyPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        company = match[1].trim();
        break;
      }
    }

    let location = "ישראל";
    const locationPatterns = [
      /מקום העבודה:\s*([^<\n]+)/i,
      /(תל אביב|רמת גן|הרצליה|ירושלים|חיפה|באר שבע|נתניה|ראשון לציון|פתח תקווה|אשדוד|חולון|בני ברק)/i,
    ];
    for (const pattern of locationPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        location = match[1].trim();
        break;
      }
    }

    let description = "";
    const ogDescMatch = html.match(/<meta[^>]*og:description[^>]*content="([^"]+)"[^>]*>/i) ||
                        html.match(/content="([^"]+)"[^>]*og:description/i);
    if (ogDescMatch && ogDescMatch[1]) {
      description = ogDescMatch[1]
        .replace(/^דרושים IL\s*-\s*תאור משרה\s*/, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .trim()
        .slice(0, 2000);
    }

    return {
      id: `drushim-${jobId}`,
      title,
      company,
      location,
      experience: "",
      description,
      url,
      source: "drushim",
      language: "he",
      scrapedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Scrape Drushim (Hebrew job board)
 * Categories: cat6 = software, cat5 = general hi-tech, cat24 = QA
 */
export async function scrapeDrushim(): Promise<JobListing[]> {
  console.log("[Drushim] Fetching Hebrew hi-tech jobs...");

  const jobUrls: { jobId: string; url: string }[] = [];
  const seenIds = new Set<string>();
  const titleMap = new Map<string, string>(); // jobId → title from listing page

  // Scrape multiple hi-tech categories
  const categories = ["cat6", "cat5", "cat24"]; // Software, General Hi-Tech, QA

  for (const cat of categories) {
    const resp = await fetch(`https://www.drushim.co.il/jobs/${cat}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "he-IL,he;q=0.9",
      },
    });

    if (!resp.ok) {
      console.error(`[Drushim] HTTP ${resp.status} for ${cat}`);
      continue;
    }

    const html = await resp.text();

    // Extract title+URL pairs from listing page (titles are in <p class="display-16"> before the job link)
    const titlePairs = html.matchAll(
      /class="[^"]*display-16[^"]*"[^>]*>\s*([^<]+)\s*<\/p>[\s\S]*?href="\/job\/(\d+)\/([a-fA-F0-9]+)\/?"/g
    );
    for (const match of titlePairs) {
      const [, listingTitle, jobId, hash] = match;
      if (seenIds.has(jobId)) continue;
      seenIds.add(jobId);
      titleMap.set(jobId, listingTitle.trim());
      jobUrls.push({ jobId, url: `https://www.drushim.co.il/job/${jobId}/${hash}/` });
    }

    // Also catch any job links not preceded by a title <p>
    const jobLinks = html.matchAll(/href="\/job\/(\d+)\/([a-fA-F0-9]+)\/?"/g);
    for (const match of jobLinks) {
      const [, jobId, hash] = match;
      if (seenIds.has(jobId)) continue;
      seenIds.add(jobId);
      jobUrls.push({ jobId, url: `https://www.drushim.co.il/job/${jobId}/${hash}/` });
    }

    // Small delay between category requests
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`[Drushim] Found ${jobUrls.length} URLs, verifying...`);

  const jobs: JobListing[] = [];
  let inactive = 0;

  for (const { jobId, url } of jobUrls.slice(0, 40)) {
    // Limit to 40 to be respectful
    const listingTitle = titleMap.get(jobId);
    const job = await fetchDrushimJobDetails(url, jobId, listingTitle);
    if (job) {
      jobs.push(job);
    } else {
      inactive++;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[Drushim] ${jobs.length} active jobs (${inactive} inactive)`);
  return jobs;
}

/**
 * Parse a Goozali Telegram message into a JobListing
 */
function parseGoozaliMessage(text: string, channelLabel: string): JobListing | null {
  // Format: 🆕 TITLE\n💼 Company: X\n🔍 Location: X\n🧑‍💻️ Experience required: X yrs\n...
  const lines = text.split("\n").map(l => l.trim());

  let title = "";
  let company = "";
  let location = "Israel";
  let experience = "0 yrs";
  let description = "";

  for (const line of lines) {
    if (line.startsWith("🆕")) {
      title = line.replace("🆕", "").trim();
    } else if (line.includes("Company:")) {
      company = line.split("Company:")[1]?.trim() || "";
    } else if (line.includes("Location:")) {
      location = line.split("Location:")[1]?.trim() || "Israel";
    } else if (line.includes("Experience required:")) {
      experience = line.split("Experience required:")[1]?.trim() || "0 yrs";
    } else if (line.includes("Description:")) {
      description = line.split("Description:")[1]?.trim() || "";
    } else if (line.includes("Requirements:")) {
      // Append requirements to description
      const req = line.split("Requirements:")[1]?.trim() || "";
      if (req) description += " Requirements: " + req;
    }
  }

  if (!title || !company) return null;

  // Generate ID from title+company
  const id = `goozali-${title.slice(0, 30).replace(/\s+/g, "-").toLowerCase()}-${company.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`;

  return {
    id,
    title,
    company,
    location,
    experience,
    description: description.slice(0, 500),
    url: `https://goozali.com/#jobopenings`, // Link to Goozali table
    source: "goozali",
    language: "en",
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Scrape Goozali Telegram channels (public ones only)
 * Extracts actual job URLs from the posts
 */
export async function scrapeGoozali(): Promise<JobListing[]> {
  console.log("[Goozali] Scraping Telegram channels...");

  const jobs: JobListing[] = [];
  const seenIds = new Set<string>();

  for (const channel of GOOZALI_CHANNELS) {
    try {
      console.log(`  • Fetching @${channel.name}...`);

      const resp = await fetch(`https://t.me/s/${channel.name}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (!resp.ok) {
        console.log(`    ⚠️ HTTP ${resp.status}`);
        continue;
      }

      const html = await resp.text();

      // Extract messages with their surrounding HTML (to get links)
      const messageBlocks = html.matchAll(/<div class="tgme_widget_message_bubble"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g);

      for (const block of messageBlocks) {
        const blockHtml = block[1];

        // Skip if not a job post
        if (!blockHtml.includes("🆕")) continue;

        // Extract text content
        const textMatch = blockHtml.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
        if (!textMatch) continue;

        let text = textMatch[1]
          .replace(/<br\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, " ")
          .trim();

        // Extract job URL from the block (careers page links)
        let jobUrl = "https://goozali.com/#jobopenings";
        const urlMatches = blockHtml.matchAll(/href="(https?:\/\/[^"]+(?:careers|jobs|job|apply|linkedin\.com\/jobs)[^"]*)"/gi);
        for (const urlMatch of urlMatches) {
          const url = urlMatch[1];
          // Skip telegram links, prefer actual job/careers URLs
          if (!url.includes("t.me/") && !url.includes("goozali.com")) {
            jobUrl = url.replace(/&amp;/g, "&");
            break;
          }
        }

        const job = parseGoozaliMessage(text, channel.label);
        if (job && !seenIds.has(job.id)) {
          job.url = jobUrl; // Override with actual URL
          seenIds.add(job.id);
          jobs.push(job);
        }
      }

      console.log(`    ✓ Found ${jobs.length} jobs so far`);

      // Small delay between channels
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`    ⚠️ Error: ${err}`);
    }
  }

  console.log(`[Goozali] Total: ${jobs.length} jobs from ${GOOZALI_CHANNELS.length} channels`);
  return jobs;
}

/**
 * Scrape Indeed Israel using ts-jobspy
 * No rate limits - uses official-ish API under the hood
 */
export async function scrapeIndeedIsrael(): Promise<JobListing[]> {
  console.log("[Indeed] Searching Israel jobs via ts-jobspy...");

  const searchTerms = ["react developer", "frontend developer", "typescript developer", "full stack developer"];
  const allJobs: JobListing[] = [];
  const seenIds = new Set<string>();

  for (const searchTerm of searchTerms) {
    try {
      console.log(`  • Searching: "${searchTerm}"...`);

      const results = await scrapeIndeed({
        siteName: "indeed",
        searchTerm,
        location: "Israel",
        countryIndeed: "israel",
        resultsWanted: 25,  // Per search term
        hoursOld: 72,       // Last 3 days
        descriptionFormat: "plain",
      });

      for (const job of results) {
        // ts-jobspy uses companyName, not company
        const companyName = job.companyName || "Unknown";

        // ts-jobspy returns location as {city, state, country} object — extract readable string
        const loc = job.location;
        let locationStr = "Israel";
        if (loc) {
          // Map IL state codes to readable names
          const stateNames: Record<string, string> = {
            TA: "Tel Aviv", M: "Central", JM: "Jerusalem",
            HA: "Haifa", H: "South", Z: "North",
          };
          const parts = [loc.city, loc.state ? stateNames[loc.state] || loc.state : null].filter(Boolean);
          locationStr = parts.length > 0 ? parts.join(", ") + ", Israel" : "Israel";
        }

        // Create stable ID - avoid double prefix
        const baseId = job.id
          ? (job.id.startsWith("indeed-") ? job.id : `indeed-${job.id}`)
          : `indeed-${(job.title + companyName).replace(/\s+/g, "-").toLowerCase().slice(0, 50)}`;

        if (seenIds.has(baseId)) continue;
        seenIds.add(baseId);

        // Convert ts-jobspy format to our JobListing format
        const listing: JobListing = {
          id: baseId,
          title: job.title,
          company: companyName,
          location: locationStr,
          experience: "", // Indeed doesn't provide structured experience data
          description: job.description?.slice(0, 800) || "",
          url: job.jobUrl,
          source: "indeed",
          language: "en",
          scrapedAt: new Date().toISOString(),
        };

        allJobs.push(listing);
      }

      console.log(`    ✓ Found ${results.length} jobs`);

      // Small delay between searches
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log(`    ⚠️ Error searching "${searchTerm}": ${err}`);
    }
  }

  console.log(`[Indeed] Total: ${allJobs.length} unique jobs`);
  return allJobs;
}

// ==========================================
// Greenhouse + Lever ATS Board Scrapers
// ==========================================

/**
 * Israeli tech companies on Greenhouse ATS
 * Slug is the company identifier in the Greenhouse API URL.
 * To find more: curl -s https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 */
const GREENHOUSE_COMPANIES = [
  { slug: "appsflyer", name: "AppsFlyer" },
  { slug: "taboola", name: "Taboola" },
  { slug: "jfrog", name: "JFrog" },
  { slug: "armissecurity", name: "Armis" },
  { slug: "similarweb", name: "SimilarWeb" },
  { slug: "riskified", name: "Riskified" },
  { slug: "forter", name: "Forter" },
  { slug: "pendo", name: "Pendo" },
  { slug: "lightricks", name: "Lightricks" },
  { slug: "optimove", name: "Optimove" },
  { slug: "orcasecurity", name: "Orca Security" },
  { slug: "bringg", name: "Bringg" },
];

/**
 * Israeli tech companies on Lever ATS
 * Slug is the company identifier in the Lever API URL.
 */
const LEVER_COMPANIES = [
  { slug: "walkme", name: "WalkMe" },
];

/** Greenhouse API response types */
interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  updated_at: string;
  company_name?: string;
}

/** Lever API response types */
interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
  };
  descriptionPlain?: string;
}

/**
 * Filter jobs to Israel-relevant locations.
 * Greenhouse/Lever boards include worldwide jobs, so we filter to:
 * - Israel / Tel Aviv / Jerusalem / Haifa / etc.
 * - Remote (could be Israel-based remote)
 * - Hybrid (many Israeli companies use this)
 */
const ISRAEL_LOCATION_PATTERNS = /\bisrael\b|\btel[\s-]?aviv\b|\bjerusalem\b|\bhaifa\b|\bbe['']?er[\s-]?sheva\b|\bherzliya\b|\bramat[\s-]?gan\b|\bnetanya\b|\bpetah[\s-]?tikva\b|\bremote\b|\bhybrid\b|\bbnei[\s-]?brak\b|\brehovot\b|\bashdod\b|\bkfar[\s-]?saba\b|\bra['']?anana\b|\brishon\b|\bmodiin\b/i;

function isIsraelLocation(location: string): boolean {
  return ISRAEL_LOCATION_PATTERNS.test(location);
}

/**
 * Scrape Greenhouse ATS boards for Israeli tech jobs
 * Uses free JSON API: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 * No auth needed, no rate limits.
 */
export async function scrapeGreenhouse(): Promise<JobListing[]> {
  console.log(`[Greenhouse] Scraping ${GREENHOUSE_COMPANIES.length} company boards...`);
  const jobs: JobListing[] = [];

  for (const company of GREENHOUSE_COMPANIES) {
    try {
      const resp = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs`,
        { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
      );

      if (!resp.ok) {
        console.log(`  ⚠️ ${company.name}: HTTP ${resp.status}`);
        continue;
      }

      const data = (await resp.json()) as { jobs: GreenhouseJob[] };
      const allBoardJobs = data.jobs || [];

      // Filter to Israel-relevant locations
      const israelJobs = allBoardJobs.filter(j => isIsraelLocation(j.location?.name || ""));

      for (const j of israelJobs) {
        jobs.push({
          id: `greenhouse-${company.slug}-${j.id}`,
          title: j.title,
          company: j.company_name || company.name,
          location: j.location?.name || "Israel",
          experience: "",
          description: "", // Greenhouse list endpoint doesn't include description
          url: j.absolute_url,
          source: "greenhouse",
          language: "en",
          scrapedAt: new Date().toISOString(),
        });
      }

      console.log(`  ✓ ${company.name}: ${israelJobs.length}/${allBoardJobs.length} Israel jobs`);

      // Small delay between companies to be polite
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`  ⚠️ ${company.name}: ${err}`);
    }
  }

  console.log(`[Greenhouse] Total: ${jobs.length} Israel-relevant jobs`);
  return jobs;
}

/**
 * Scrape Lever ATS boards for Israeli tech jobs
 * Uses free JSON API: https://api.lever.co/v0/postings/{slug}
 * No auth needed.
 */
export async function scrapeLever(): Promise<JobListing[]> {
  console.log(`[Lever] Scraping ${LEVER_COMPANIES.length} company boards...`);
  const jobs: JobListing[] = [];

  for (const company of LEVER_COMPANIES) {
    try {
      const resp = await fetch(
        `https://api.lever.co/v0/postings/${company.slug}`,
        { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
      );

      if (!resp.ok) {
        console.log(`  ⚠️ ${company.name}: HTTP ${resp.status}`);
        continue;
      }

      const postings = (await resp.json()) as LeverPosting[];

      // Filter to Israel-relevant locations
      const israelPostings = postings.filter(p =>
        isIsraelLocation(p.categories?.location || "")
      );

      for (const p of israelPostings) {
        jobs.push({
          id: `lever-${company.slug}-${p.id}`,
          title: p.text,
          company: company.name,
          location: p.categories?.location || "Israel",
          experience: "",
          description: (p.descriptionPlain || "").slice(0, 2000),
          url: p.hostedUrl,
          source: "lever",
          language: "en",
          scrapedAt: new Date().toISOString(),
        });
      }

      console.log(`  ✓ ${company.name}: ${israelPostings.length}/${postings.length} Israel postings`);

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`  ⚠️ ${company.name}: ${err}`);
    }
  }

  console.log(`[Lever] Total: ${jobs.length} Israel-relevant jobs`);
  return jobs;
}

/**
 * Wrapper to safely scrape a source with error handling
 * Returns empty array on failure, logs the error
 */
export interface SourceScrapeResult {
  source: string;
  jobs: JobListing[];
  error?: string;
  durationMs: number;
}

async function safeSourceScrape(
  name: string,
  scrapeFn: () => Promise<JobListing[]>
): Promise<SourceScrapeResult> {
  const start = Date.now();
  try {
    const jobs = await scrapeFn();
    return { source: name, jobs, durationMs: Date.now() - start };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${name}] ❌ Failed: ${errorMsg}`);
    return { source: name, jobs: [], error: errorMsg, durationMs: Date.now() - start };
  }
}

/** Compute quality metrics for a batch of jobs */
export function computeQualityMetrics(jobs: JobListing[]) {
  const noDesc = jobs.filter(j => !j.description || j.description.length === 0).length;
  const idLikeTitles = jobs.filter(j => /^(Job #\d+|\d+)$/.test(j.title)).length;
  const noCompany = jobs.filter(j => !j.company || j.company === "Unknown" || j.company === "דרושים").length;
  const avgDescLen = jobs.length > 0
    ? Math.round(jobs.reduce((sum, j) => sum + (j.description?.length || 0), 0) / jobs.length)
    : 0;
  return { noDesc, idLikeTitles, noCompany, avgDescLen };
}

/**
 * Scrape all sources in PARALLEL with resilience
 * - Uses Promise.allSettled so one failure doesn't stop others
 * - Each source wrapped in try/catch
 * - Set SKIP_SECRETLV=1 or SKIP_DRUSHIM=1 to skip specific sources
 */
export async function scrapeAllJobs(): Promise<JobListing[]> {
  ensureDataDir();

  const seen = loadSeenJobs();

  // Build list of sources to scrape
  const sources: Array<{ name: string; fn: () => Promise<JobListing[]> }> = [];

  // Goozali (Telegram, fast)
  sources.push({ name: "Goozali", fn: scrapeGoozali });

  // Indeed Israel (ts-jobspy, no rate limits)
  if (process.env.SKIP_INDEED !== "1") {
    sources.push({ name: "Indeed", fn: scrapeIndeedIsrael });
  } else {
    console.log("[Indeed] Skipped (SKIP_INDEED=1)");
  }

  // SecretTLV (rate limited, slow)
  if (process.env.SKIP_SECRETLV !== "1") {
    sources.push({ name: "SecretTLV", fn: scrapeSecretTLV });
  } else {
    console.log("[SecretTLV] Skipped (SKIP_SECRETLV=1)");
  }

  // Drushim (Hebrew)
  if (process.env.SKIP_DRUSHIM !== "1") {
    sources.push({ name: "Drushim", fn: scrapeDrushim });
  } else {
    console.log("[Drushim] Skipped (SKIP_DRUSHIM=1)");
  }

  // Greenhouse ATS boards (free JSON API, Israeli companies)
  if (process.env.SKIP_GREENHOUSE !== "1") {
    sources.push({ name: "Greenhouse", fn: scrapeGreenhouse });
  } else {
    console.log("[Greenhouse] Skipped (SKIP_GREENHOUSE=1)");
  }

  // Lever ATS boards (free JSON API, Israeli companies)
  if (process.env.SKIP_LEVER !== "1") {
    sources.push({ name: "Lever", fn: scrapeLever });
  } else {
    console.log("[Lever] Skipped (SKIP_LEVER=1)");
  }

  console.log(`[Scraper] Fetching ${sources.length} sources in parallel...`);
  const startTime = Date.now();

  // Fetch ALL sources in parallel with resilience
  const results = await Promise.allSettled(
    sources.map(s => safeSourceScrape(s.name, s.fn))
  );

  // Combine successful results + build activity entries
  const allJobs: JobListing[] = [];
  const errors: string[] = [];
  const sourceResults: SourceScrapeResult[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { source, jobs, error, durationMs } = result.value;
      if (error) {
        errors.push(`${source}: ${error}`);
      }
      allJobs.push(...jobs);
      sourceResults.push(result.value);
    } else {
      errors.push(`Unknown source: ${result.reason}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Log summary
  if (errors.length > 0) {
    console.log(`[Scraper] ⚠️ ${errors.length} source(s) failed but continuing:`);
    errors.forEach(e => console.log(`  • ${e}`));
  }

  // Log scrape activity to Supabase (non-blocking)
  try {
    const { logScrapeActivity } = await import("./sync-to-supabase");
    const activityEntries = sourceResults.map(r => {
      const metrics = computeQualityMetrics(r.jobs);
      return {
        source: r.source.toLowerCase(),
        total_found: r.jobs.length,
        new_saved: 0, // Will be updated after dedup below
        duplicates_skipped: 0,
        errors: r.error ? 1 : 0,
        avg_description_length: metrics.avgDescLen,
        no_description_count: metrics.noDesc,
        id_like_title_count: metrics.idLikeTitles,
        no_company_count: metrics.noCompany,
        duration_ms: r.durationMs,
        notes: r.error || undefined,
      };
    });
    // Fire and forget — don't block the scraper
    logScrapeActivity(activityEntries).catch(err =>
      console.error("[ScrapeActivity] Background log failed:", err)
    );
  } catch {
    // sync-to-supabase import may fail if no Supabase env
  }

  // Filter out seen jobs
  const newJobs = allJobs.filter(job => !seen.has(job.id));

  // Mark new jobs as seen
  for (const job of newJobs) {
    seen.add(job.id);
  }
  saveSeenJobs(seen);

  // Quality validation: warn on degraded data
  const qualityMetrics = computeQualityMetrics(newJobs);
  if (qualityMetrics.idLikeTitles > 0 || qualityMetrics.noDesc > 0) {
    console.warn(`[Quality] Degraded data: ${qualityMetrics.idLikeTitles} generic titles, ${qualityMetrics.noDesc} missing descriptions, ${qualityMetrics.noCompany} unknown companies`);
  }

  // Save new jobs to file (for Supabase sync)
  if (newJobs.length > 0) {
    saveScrapedJobs(newJobs);
    console.log(`[Scraper] Saved ${newJobs.length} jobs to ${SCRAPED_JOBS_FILE}`);
  }

  console.log(`[Scraper] Total: ${allJobs.length} active jobs, ${newJobs.length} new (${elapsed}s)`);
  return newJobs;
}

// CLI
if (import.meta.main) {
  console.log("🔍 Job Golem Scraper\n");
  const jobs = await scrapeAllJobs();
  console.log(`\nFound ${jobs.length} new jobs`);

  if (jobs.length > 0) {
    console.log("\nSample jobs:");
    jobs.slice(0, 5).forEach(job => {
      console.log(`  • [${job.source}] ${job.title} @ ${job.company} (${job.location})`);
    });
  }
}
