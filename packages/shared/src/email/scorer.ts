#!/usr/bin/env bun
/**
 * Email Golem - Scorer
 *
 * Uses Ollama to score emails for urgency and categorize them.
 * Handles subscription/payment tracking.
 *
 * Score ranges:
 * - 10: IMMEDIATE (interview, payment failed, urgent deadline)
 * - 7-9: BRIEFING (job updates, important but not urgent)
 * - 5-6: TRACK (subscription receipts, for monthly digest)
 * - 1-4: IGNORE (newsletters, promos, spam)
 */

import { runLLMJSON } from "../lib/llm";

/** Raw email input for scoring */
export interface EmailInput {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  body?: string;
  receivedAt: string;
}

/** Extracted subscription details from a payment email */
export interface SubscriptionInfo {
  serviceName: string;
  amount: number | null;
  frequency: "monthly" | "yearly" | "one-time" | "unknown";
}

/** Email after scoring with urgency, category, and optional subscription info */
export interface ScoredEmail {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  receivedAt: string;
  score: number;
  category: string;
  reason: string;
  subscription: SubscriptionInfo | null;
  scoredAt: string;
}

interface OllamaScoreResult {
  score: number;
  category: string;
  reason: string;
  subscription: SubscriptionInfo | null;
}

/** Score thresholds for email triage actions */
export const SCORE_THRESHOLDS = {
  IMMEDIATE: 10,
  BRIEFING_MIN: 7,
  TRACK_MIN: 5,
  IGNORE_MAX: 4,
} as const;

/** Valid email categories from the scoring prompt */
type EmailCategory = "interview" | "urgent" | "job" | "subscription" | "tech-update" | "newsletter" | "promo" | "social" | "other";

/**
 * Known senders that get auto-categorized without LLM scoring.
 * Prevents inconsistent scoring of infrastructure emails (Railway, GitHub Actions, etc.)
 */
const AUTO_CATEGORIZE: Record<string, { category: EmailCategory; score: number }> = {
  "notify.railway.app": { category: "tech-update", score: 3 },
  "noreply@github.com": { category: "tech-update", score: 4 },
  "builds@travis-ci.com": { category: "tech-update", score: 3 },
  "noreply@vercel.com": { category: "tech-update", score: 3 },
  "notify.bugsnag.com": { category: "tech-update", score: 5 },
  "noreply@deepsource.io": { category: "tech-update", score: 4 },
};

// Known subscription services for quick extraction
const KNOWN_SERVICES: Record<string, string> = {
  "netflix.com": "Netflix",
  "spotify.com": "Spotify",
  "apple.com": "Apple",
  "email.apple.com": "Apple",
  "google.com": "Google",
  "microsoft.com": "Microsoft",
  "adobe.com": "Adobe",
  "github.com": "GitHub",
  "dropbox.com": "Dropbox",
  "icloud.com": "iCloud",
  "anthropic.com": "Claude Pro",
  "openai.com": "ChatGPT Plus",
};

/**
 * Extract subscription info from email using regex patterns
 * (Quick heuristic before/instead of Ollama)
 */
export function extractSubscriptionInfo(
  subject: string,
  snippet: string,
  from: string
): SubscriptionInfo | null {
  const text = `${subject} ${snippet}`.toLowerCase();

  // Check if this looks like a subscription/payment email
  const subscriptionKeywords = [
    "receipt",
    "invoice",
    "payment",
    "charged",
    "subscription",
    "renewed",
    "billing",
    "your plan",
  ];

  const isSubscriptionEmail = subscriptionKeywords.some((kw) => text.includes(kw));
  if (!isSubscriptionEmail) return null;

  // Extract service name
  let serviceName = "Unknown";
  const fromDomain = from.split("@")[1]?.toLowerCase() || "";

  for (const [domain, name] of Object.entries(KNOWN_SERVICES)) {
    if (fromDomain.includes(domain)) {
      serviceName = name;
      break;
    }
  }

  // If not in known services, try to extract from subject
  if (serviceName === "Unknown") {
    const subjectMatch = subject.match(/^(your\s+)?(\w+)\s+(receipt|invoice|subscription|payment)/i);
    if (subjectMatch) {
      serviceName = subjectMatch[2];
    }
  }

  // Extract amount
  let amount: number | null = null;
  const amountMatch = text.match(/\$(\d+(?:\.\d{2})?)/);
  if (amountMatch) {
    amount = parseFloat(amountMatch[1]);
  }

  // Determine frequency
  let frequency: SubscriptionInfo["frequency"] = "unknown";
  if (text.includes("monthly") || text.includes("month")) {
    frequency = "monthly";
  } else if (text.includes("yearly") || text.includes("annual") || text.includes("year")) {
    frequency = "yearly";
  } else if (text.includes("one-time") || text.includes("one time")) {
    frequency = "one-time";
  }

  return { serviceName, amount, frequency };
}

/**
 * Build the scoring prompt for Ollama
 */
function buildScoringPrompt(email: EmailInput): string {
  const bodySection = email.body
    ? `\n- Body (first ~1000 chars):\n"""\n${email.body.replace(/"""/g, "'''")}\n"""`
    : "";

  return `You are an email triage assistant for a developer who works heavily with Claude/Anthropic.
Score this email for urgency and categorize it.

EMAIL:
- Subject: ${email.subject}
- From: ${email.from}
- Preview: ${email.snippet}${bodySection}
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

IMPORTANT RULES:
- Generic newsletters and "weekly digest" type emails are 2-3, NOT 7+.
- Only score 7+ if the content is DIRECTLY actionable or about Claude/Anthropic specifically.
- READ THE BODY CAREFULLY: Many job platform emails have misleading subjects like "Interview Update" but the body reveals it's a rejection. Score rejections 3-4, NOT 10.
- If subject says "interview" but body says "not moving forward", "decided not to proceed", "other candidates" → it's a REJECTION (score 3-4), not an interview invite.

CATEGORIES: interview, urgent, job, subscription, tech-update, newsletter, promo, social, other

For subscription emails, also extract:
- serviceName: Name of the service (Netflix, Spotify, etc.)
- amount: Dollar amount if mentioned
- frequency: monthly, yearly, one-time, or unknown

Respond with ONLY a JSON object:
{"score": 1-10, "category": "string", "reason": "brief explanation", "subscription": {"serviceName": "...", "amount": 15.99, "frequency": "monthly"} or null}`;
}

/**
 * Score a single email using Ollama (or auto-categorize known senders)
 */
export async function scoreEmail(email: EmailInput): Promise<ScoredEmail> {
  // Auto-categorize known infrastructure senders (bypass LLM for consistency)
  const fromDomain = email.from.split("@")[1]?.toLowerCase() || "";
  const autoRule = AUTO_CATEGORIZE[fromDomain];
  if (autoRule) {
    return {
      ...email,
      score: autoRule.score,
      category: autoRule.category,
      reason: `Auto-categorized: known sender (${fromDomain})`,
      subscription: null,
      scoredAt: new Date().toISOString(),
    };
  }

  const prompt = buildScoringPrompt(email);

  const result = await runLLMJSON<OllamaScoreResult>(prompt, "email-golem");

  if (result) {
    // Try to extract subscription info locally if Ollama didn't
    let subscription = result.subscription;
    if (!subscription && result.category === "subscription") {
      subscription = extractSubscriptionInfo(email.subject, email.snippet, email.from);
    }

    return {
      ...email,
      score: result.score ?? 5,
      category: result.category ?? "unknown",
      reason: result.reason ?? "No reason provided",
      subscription,
      scoredAt: new Date().toISOString(),
    };
  }

  // Fallback when Ollama fails
  const localSubscription = extractSubscriptionInfo(email.subject, email.snippet, email.from);

  return {
    ...email,
    score: 5,
    category: localSubscription ? "subscription" : "unknown",
    reason: "Scoring unavailable - Ollama failed",
    subscription: localSubscription,
    scoredAt: new Date().toISOString(),
  };
}

/**
 * Score multiple emails with optional filtering
 */
export async function scoreEmails(
  emails: EmailInput[],
  options: { minScore?: number; delayMs?: number } = {}
): Promise<ScoredEmail[]> {
  const { minScore = 0, delayMs = 500 } = options;

  console.log(`[Scorer] Scoring ${emails.length} emails with Ollama...`);

  const results: ScoredEmail[] = [];

  for (const email of emails) {
    console.log(`  • Scoring: ${email.subject.slice(0, 50)}...`);
    const result = await scoreEmail(email);
    results.push(result);

    // Rate limit Ollama calls
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Filter by minimum score if specified
  const filtered = minScore > 0 ? results.filter((r) => r.score >= minScore) : results;

  // Sort by score descending
  filtered.sort((a, b) => b.score - a.score);

  console.log(
    `[Scorer] ${filtered.length}/${emails.length} emails scored ${minScore > 0 ? `${minScore}+` : ""}`
  );

  return filtered;
}

/**
 * Check if an email should trigger immediate notification
 */
export function shouldNotifyImmediately(scoredEmail: ScoredEmail): boolean {
  return scoredEmail.score >= SCORE_THRESHOLDS.IMMEDIATE;
}

/**
 * Check if an email should be included in daily briefing
 */
export function shouldIncludeInBriefing(scoredEmail: ScoredEmail): boolean {
  return scoredEmail.score >= SCORE_THRESHOLDS.BRIEFING_MIN;
}

/**
 * Check if an email should be tracked for monthly subscription report
 */
export function shouldTrackSubscription(scoredEmail: ScoredEmail): boolean {
  return (
    scoredEmail.category === "subscription" &&
    scoredEmail.score >= SCORE_THRESHOLDS.TRACK_MIN &&
    scoredEmail.subscription !== null
  );
}

// CLI for testing
if (import.meta.main) {
  console.log("📧 Email Golem Scorer Test\n");

  const testEmail: EmailInput = {
    id: "test-1",
    subject: "Interview Scheduled: Senior SWE at Microsoft",
    from: "recruiting@microsoft.com",
    snippet: "Please use this link to schedule your technical interview...",
    receivedAt: new Date().toISOString(),
  };

  const result = await scoreEmail(testEmail);
  console.log(`\nScore: ${result.score}/10`);
  console.log(`Category: ${result.category}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Subscription: ${JSON.stringify(result.subscription)}`);
  console.log(`Should notify: ${shouldNotifyImmediately(result)}`);
}
