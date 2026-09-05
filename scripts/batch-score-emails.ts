#!/usr/bin/env bun
/**
 * Batch Email Scoring for Fine-Tuning Data Collection
 *
 * Pulls historical emails from Gmail and scores them with GLM-4.7-Flash
 * via the existing email scorer (runLLMJSON → Ollama).
 *
 * Outputs:
 * - /tmp/email-training-data.jsonl — ShareGPT format for fine-tuning
 * - /tmp/email-scoring-progress.json — progress tracker (resume-safe)
 * - Console progress updates every 10 emails
 *
 * Usage:
 *   OLLAMA_MODEL=glm-4.7-flash bun scripts/batch-score-emails.ts
 *   OLLAMA_MODEL=glm-4.7-flash bun scripts/batch-score-emails.ts --max=500
 *   OLLAMA_MODEL=glm-4.7-flash bun scripts/batch-score-emails.ts --query="after:2025/06/01"
 *   bun scripts/batch-score-emails.ts --download-only --max=5000
 *   OLLAMA_MODEL=glm-4.7-flash bun scripts/batch-score-emails.ts --from-file=/tmp/email-raw-data.jsonl
 *
 * Note: Searches ALL mail by default (inbox, archived, trash, spam)
 *       via Gmail API includeSpamTrash option.
 */

import "../packages/shared/src/lib/load-env";
import { listEmailIds, getEmailById, type GmailEmail } from "../packages/shared/src/email/gmail-client";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = process.env.OLLAMA_MODEL || "glm-4.7-flash";
const OUTPUT_FILE = "/tmp/email-training-data.jsonl";
const PROGRESS_FILE = "/tmp/email-scoring-progress.json";

// Parse CLI args
const args = process.argv.slice(2);
const maxEmails = parseInt(args.find(a => a.startsWith("--max="))?.split("=")[1] || "500");
const query = args.find(a => a.startsWith("--query="))?.split("=").slice(1).join("=") || "after:2025/01/01";
const dryRun = args.includes("--dry-run");
const downloadOnly = args.includes("--download-only");
const fromFile = args.find(a => a.startsWith("--from-file="))?.split("=").slice(1).join("=");
const RAW_EMAIL_FILE = "/tmp/email-raw-data.jsonl";

// ============================================================
// Scoring prompt (same as scorer.ts)
// ============================================================

function buildScoringPrompt(email: { subject: string; from: string; snippet: string; receivedAt: string }): string {
  return `You are an email triage assistant for a developer who works heavily with Claude/Anthropic.
Score this email for urgency and categorize it.

EMAIL:
- Subject: ${email.subject}
- From: ${email.from}
- Preview: ${email.snippet}
- Received: ${email.receivedAt}

SCORING CRITERIA:
- Score 10 (IMMEDIATE ALERT):
  * Interview invites/scheduled
  * "Payment due", "action required", "expires today"
  * Payment FAILED / card declined
  * Direct message needing urgent reply
  * Offer letters, contracts to sign

- Score 9 (HIGH PRIORITY - tech learning):
  * Anthropic/Claude announcements, changelogs, new features
  * Claude API updates, model releases
  * Major tech news DIRECTLY about tools I use (Claude, Convex, Bun, React)
  * Security alerts for my tools

- Score 7-8 (Include in daily briefing):
  * Job application status updates
  * Recruiter messages (not bulk alerts)
  * GitHub PR reviews, issue mentions
  * Specific tech content I should learn (not generic newsletters)

- Score 5-6 (Track for monthly report):
  * Subscription payment receipts
  * Successful recurring payments
  * New subscription confirmations

- Score 3-4 (Log only):
  * Job alert digests ("15 jobs match", "new jobs in your area")
  * Generic rejection emails
  * Automated confirmations
  * Daily.dev, Hashnode, dev.to generic digests

- Score 1-2 (Ignore):
  * Generic newsletters (even if tech-related but not actionable)
  * Promos/marketing (events, festivals, sales)
  * Social notifications (LinkedIn views, follows)
  * Spam

IMPORTANT: Generic newsletters and "weekly digest" type emails are 2-3, NOT 7+.
Only score 7+ if the content is DIRECTLY actionable or about Claude/Anthropic specifically.

CATEGORIES: interview, urgent, job, subscription, tech-update, newsletter, promo, social, other

For subscription emails, also extract:
- serviceName: Name of the service (Netflix, Spotify, etc.)
- amount: Dollar amount if mentioned
- frequency: monthly, yearly, one-time, or unknown

Respond with ONLY a JSON object:
{"score": 1-10, "category": "string", "reason": "brief explanation", "tags": ["keyword1", "keyword2"], "subscription": {"serviceName": "...", "amount": 15.99, "frequency": "monthly"} or null}

TAGS: 2-5 lowercase keywords for searchability (company names, topics, technologies, action types). Examples: ["netflix", "billing", "receipt"], ["anthropic", "claude", "api-update"], ["interview", "google", "senior-swe"]`;
}

// ============================================================
// GLM scoring via Ollama HTTP
// ============================================================

async function scoreWithGLM(prompt: string): Promise<{ text: string; durationMs: number }> {
  const start = Date.now();
  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  if (!resp.ok) {
    throw new Error(`Ollama returned ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json() as any;
  return { text: data.response || "", durationMs: Date.now() - start };
}

function parseJSON(text: string): any | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ============================================================
// Progress tracking (resume-safe)
// ============================================================

interface Progress {
  processedIds: string[];
  totalScored: number;
  totalFailed: number;
  startedAt: string;
  lastUpdate: string;
  scoreDistribution: Record<number, number>;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return {
    processedIds: [],
    totalScored: 0,
    totalFailed: 0,
    startedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    scoreDistribution: {},
  };
}

function saveProgress(progress: Progress) {
  progress.lastUpdate = new Date().toISOString();
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ============================================================
// Training data format (ShareGPT/messages format for MLX)
// ============================================================

function toTrainingExample(email: { subject: string; from: string; snippet: string; receivedAt: string }, response: string): string {
  const prompt = buildScoringPrompt(email);
  const example = {
    messages: [
      { role: "user", content: prompt },
      { role: "assistant", content: response },
    ],
  };
  return JSON.stringify(example);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("  Batch Email Scoring — Training Data Collection");
  console.log(`  Model: ${MODEL}`);
  console.log(`  Query: ${query}`);
  console.log(`  Max emails: ${maxEmails}`);
  console.log(`  Output: ${OUTPUT_FILE}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log("=".repeat(60));
  console.log();

  // Check Ollama (skip for download-only mode)
  if (!downloadOnly) {
    try {
      await fetch("http://127.0.0.1:11434/api/tags");
    } catch {
      console.error("ERROR: Ollama not running. Start with: ollama serve");
      process.exit(1);
    }

    // Check model
    const tagsResp = await fetch("http://127.0.0.1:11434/api/tags");
    const tagsData = await tagsResp.json() as any;
    const hasModel = tagsData.models?.some((m: any) => m.name.includes(MODEL));
    if (!hasModel) {
      console.error(`ERROR: Model ${MODEL} not found. Pull with: ollama pull ${MODEL}`);
      process.exit(1);
    }
  }

  // Load progress (for resume)
  const progress = loadProgress();
  const alreadyProcessed = new Set(progress.processedIds);
  console.log(`Resume: ${alreadyProcessed.size} already processed`);

  // Step 1: List email IDs (fast — no full message fetch)
  console.log(`\nListing email IDs (query: "${query}", max: ${maxEmails}, includeSpamTrash: true)...`);
  let emailIds: string[];
  try {
    emailIds = await listEmailIds(query, maxEmails, { includeSpamTrash: true });
  } catch (e: any) {
    console.error(`Gmail error: ${e.message}`);
    console.error("Make sure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN are set in .env");
    process.exit(1);
  }

  console.log(`Found ${emailIds.length} email IDs`);

  // Filter out already processed
  const toProcessIds = emailIds.filter(id => !alreadyProcessed.has(id));
  console.log(`New (unprocessed): ${toProcessIds.length}`);
  console.log();

  if (dryRun) {
    // Fetch just 10 for preview
    console.log("DRY RUN — fetching first 10 for preview:");
    for (const id of toProcessIds.slice(0, 10)) {
      try {
        const e = await getEmailById(id);
        console.log(`  [${e.receivedAt.toISOString().slice(0, 10)}] ${e.from}: ${e.subject.slice(0, 60)}`);
      } catch {
        console.log(`  [?] Could not fetch ${id}`);
      }
    }
    console.log(`\nWould score ${toProcessIds.length} emails. Remove --dry-run to execute.`);
    process.exit(0);
  }

  if (downloadOnly) {
    // Download all emails to JSONL (no scoring)
    console.log(`Downloading ${toProcessIds.length} emails to ${RAW_EMAIL_FILE}...`);
    let downloaded = 0;
    let fetchFailed = 0;
    const dlStart = Date.now();

    for (const id of toProcessIds) {
      try {
        const e = await getEmailById(id);
        const raw = { id: e.id, subject: e.subject, from: e.from, snippet: e.snippet, receivedAt: e.receivedAt.toISOString() };
        appendFileSync(RAW_EMAIL_FILE, JSON.stringify(raw) + "\n");
        downloaded++;
        if (downloaded % 100 === 0) {
          const elapsed = ((Date.now() - dlStart) / 1000).toFixed(0);
          console.log(`  [${downloaded}/${toProcessIds.length}] ${elapsed}s elapsed`);
        }
      } catch {
        fetchFailed++;
      }
    }

    const totalSec = ((Date.now() - dlStart) / 1000).toFixed(0);
    console.log(`\nDone: ${downloaded} downloaded, ${fetchFailed} failed, ${totalSec}s total`);
    console.log(`Saved to: ${RAW_EMAIL_FILE}`);
    console.log(`\nTo score: bun scripts/batch-score-emails.ts --from-file=${RAW_EMAIL_FILE}`);
    process.exit(0);
  }

  // Step 2: Score emails (from file or lazy Gmail fetch)
  interface EmailInput { id: string; subject: string; from: string; snippet: string; receivedAt: string }
  let emailSource: EmailInput[];

  if (fromFile) {
    // Load from pre-downloaded JSONL
    console.log(`Loading emails from ${fromFile}...`);
    const lines = readFileSync(fromFile, "utf-8").trim().split("\n");
    emailSource = lines.map(l => JSON.parse(l));
    // Filter already processed
    emailSource = emailSource.filter(e => !alreadyProcessed.has(e.id));
    console.log(`Loaded ${emailSource.length} unprocessed emails from file`);
  } else {
    // Will lazy-fetch from Gmail below
    emailSource = toProcessIds.map(id => ({ id, subject: "", from: "", snippet: "", receivedAt: "" }));
  }

  let scored = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const entry of emailSource) {
    let emailInput: { subject: string; from: string; snippet: string; receivedAt: string };
    const emailId = entry.id;

    if (fromFile) {
      emailInput = { subject: entry.subject, from: entry.from, snippet: entry.snippet, receivedAt: entry.receivedAt };
    } else {
      // Lazy fetch from Gmail
      try {
        const email = await getEmailById(emailId);
        emailInput = { subject: email.subject, from: email.from, snippet: email.snippet, receivedAt: email.receivedAt.toISOString() };
      } catch (e: any) {
        failed++;
        progress.totalFailed++;
        console.log(`  FETCH ERROR: ${e.message} for id=${emailId}`);
        continue;
      }
    }

    try {
      const prompt = buildScoringPrompt(emailInput);
      const { text, durationMs } = await scoreWithGLM(prompt);
      const parsed = parseJSON(text);

      if (parsed && parsed.score) {
        // Save training example
        const jsonResponse = JSON.stringify(parsed);
        const trainingLine = toTrainingExample(emailInput, jsonResponse);
        appendFileSync(OUTPUT_FILE, trainingLine + "\n");

        // Update progress
        progress.processedIds.push(emailId);
        progress.totalScored++;
        progress.scoreDistribution[parsed.score] = (progress.scoreDistribution[parsed.score] || 0) + 1;
        scored++;

        // Progress log every 10
        if (scored % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const avgMs = Math.round(elapsed / scored * 1000);
          const remaining = emailSource.length - scored - failed;
          const eta = Math.round(remaining * avgMs / 1000 / 60);
          console.log(`  [${scored}/${emailSource.length}] ${avgMs}ms avg, ~${eta}min remaining | score=${parsed.score} cat=${parsed.category}`);
          saveProgress(progress);
        }
      } else {
        failed++;
        progress.totalFailed++;
        console.log(`  FAIL: No valid JSON for "${emailInput.subject.slice(0, 40)}..." (${durationMs}ms)`);
      }
    } catch (e: any) {
      failed++;
      progress.totalFailed++;
      console.log(`  ERROR: ${e.message} for "${emailInput.subject.slice(0, 40)}..."`);
    }
  }

  // Final save
  saveProgress(progress);

  // Summary
  const totalElapsed = (Date.now() - startTime) / 1000;
  console.log();
  console.log("=".repeat(60));
  console.log("  DONE");
  console.log("=".repeat(60));
  console.log(`  Scored: ${scored}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total time: ${Math.round(totalElapsed)}s (${Math.round(totalElapsed / 60)}min)`);
  console.log(`  Avg per email: ${scored > 0 ? Math.round(totalElapsed / scored * 1000) : 0}ms`);
  console.log(`  Output: ${OUTPUT_FILE} (${progress.totalScored} total examples)`);
  console.log();
  console.log("  Score distribution:");
  for (let s = 1; s <= 10; s++) {
    const count = progress.scoreDistribution[s] || 0;
    const bar = "█".repeat(Math.min(count, 50));
    console.log(`    ${s.toString().padStart(2)}: ${bar} ${count}`);
  }
  console.log();
}

main().catch(console.error);
