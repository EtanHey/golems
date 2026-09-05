#!/usr/bin/env bun
/**
 * GLM-4.7-Flash vs Haiku Benchmark
 *
 * Tests both models on real golems workloads:
 * 1. Email scoring (JSON extraction + classification)
 * 2. Job matching (JSON extraction + nuanced reasoning)
 * 3. Text summarization (PR comment style)
 * 4. Tag generation (metadata extraction)
 *
 * Usage: bun scripts/benchmark-glm.ts
 */

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const GLM_MODEL = "glm-4.7-flash";

// ============================================================
// Test Cases — real prompts from production
// ============================================================

interface TestCase {
  name: string;
  prompt: string;
  expectedFormat: "json" | "text";
  validate: (response: string) => { pass: boolean; details: string };
}

const TEST_CASES: TestCase[] = [
  // --- EMAIL SCORING ---
  {
    name: "Email: Interview invite (should score 10)",
    prompt: `You are an email triage assistant for a developer who works heavily with Claude/Anthropic.
Score this email for urgency and categorize it.

EMAIL:
- Subject: Interview Scheduled: Senior SWE at Microsoft
- From: recruiting@microsoft.com
- Preview: Please use this link to schedule your technical interview for the Senior Software Engineer role...
- Received: 2026-02-12T10:00:00Z

SCORING CRITERIA:
- Score 10 (IMMEDIATE): Interview invites, payment failed, urgent deadlines
- Score 7-8 (BRIEFING): Job updates, recruiter messages, PR reviews
- Score 5-6 (TRACK): Subscription receipts
- Score 3-4 (LOG): Job alert digests, rejections
- Score 1-2 (IGNORE): Newsletters, promos, spam

CATEGORIES: interview, urgent, job, subscription, tech-update, newsletter, promo, social, other

Respond with ONLY a JSON object:
{"score": 1-10, "category": "string", "reason": "brief explanation", "subscription": null}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found in response" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score >= 9;
        const catOk = json.category === "interview";
        return {
          pass: scoreOk && catOk,
          details: `score=${json.score} (want >=9), category="${json.category}" (want "interview"), reason="${json.reason}"`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },
  {
    name: "Email: Newsletter spam (should score 1-3)",
    prompt: `You are an email triage assistant for a developer.
Score this email for urgency and categorize it.

EMAIL:
- Subject: Weekly Dev Digest: Top 10 React Patterns You're Missing
- From: digest@daily.dev
- Preview: This week's most popular articles on React, Node.js, and TypeScript...
- Received: 2026-02-12T08:00:00Z

SCORING CRITERIA:
- Score 10 (IMMEDIATE): Interview invites, payment failed
- Score 7-8 (BRIEFING): Job updates, recruiter messages
- Score 5-6 (TRACK): Subscription receipts
- Score 3-4 (LOG): Job alert digests, rejections
- Score 1-2 (IGNORE): Newsletters, promos, spam

IMPORTANT: Generic newsletters and "weekly digest" type emails are 2-3, NOT 7+.

CATEGORIES: interview, urgent, job, subscription, tech-update, newsletter, promo, social, other

Respond with ONLY a JSON object:
{"score": 1-10, "category": "string", "reason": "brief explanation", "subscription": null}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score <= 3;
        const catOk = json.category === "newsletter";
        return {
          pass: scoreOk && catOk,
          details: `score=${json.score} (want <=3), category="${json.category}" (want "newsletter"), reason="${json.reason}"`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },
  {
    name: "Email: Subscription receipt (should score 5-6)",
    prompt: `You are an email triage assistant for a developer.
Score this email for urgency and categorize it.

EMAIL:
- Subject: Your Netflix receipt for February 2026
- From: info@account.netflix.com
- Preview: Your monthly subscription of $15.49 has been charged to your Visa ending in 4242...
- Received: 2026-02-01T00:00:00Z

SCORING CRITERIA:
- Score 10 (IMMEDIATE): Interview invites, payment failed
- Score 7-8 (BRIEFING): Job updates, recruiter messages
- Score 5-6 (TRACK): Subscription receipts
- Score 1-2 (IGNORE): Newsletters, promos, spam

CATEGORIES: interview, urgent, job, subscription, tech-update, newsletter, promo, social, other

For subscription emails, extract:
- serviceName, amount, frequency (monthly/yearly/one-time/unknown)

Respond with ONLY a JSON object:
{"score": 1-10, "category": "string", "reason": "brief", "subscription": {"serviceName": "...", "amount": 15.99, "frequency": "monthly"}}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score >= 5 && json.score <= 6;
        const catOk = json.category === "subscription";
        const subOk = json.subscription?.serviceName?.toLowerCase().includes("netflix");
        const amountOk = json.subscription?.amount === 15.49;
        return {
          pass: scoreOk && catOk && subOk,
          details: `score=${json.score} (want 5-6), category="${json.category}", sub=${JSON.stringify(json.subscription)}`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },

  // --- JOB MATCHING ---
  {
    name: "Job: Perfect React match (should score 9-10)",
    prompt: `You are a job matching assistant. Analyze if this job is a good fit.

CANDIDATE: 3+ years, React/TypeScript/Next.js, Full Stack, Israel/remote
PRIMARY skills: TypeScript, React, Next.js, Node.js, TailwindCSS

JOB:
- Title: Full Stack Developer
- Company: Cool Startup
- Location: Tel Aviv, Israel
- Description: Looking for a React/Node.js developer with 2+ years experience. TypeScript required. TailwindCSS preferred. Hybrid in Tel Aviv.

SCORING: 9-10 = perfect match, 7-8 = good fit, 5-6 = partial, 3-4 = weak, 1-2 = wrong stack

Respond with ONLY a JSON object:
{"score": 1-10, "reason": "brief", "highlights": ["matching", "skills"]}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score >= 8;
        return {
          pass: scoreOk,
          details: `score=${json.score} (want >=8), reason="${json.reason}", highlights=${JSON.stringify(json.highlights)}`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },
  {
    name: "Job: Wrong stack Java (should score 1-3)",
    prompt: `You are a job matching assistant. Analyze if this job is a good fit.

CANDIDATE: 3+ years, React/TypeScript/Next.js, Full Stack, Israel/remote
PRIMARY skills: TypeScript, React, Next.js, Node.js

JOB:
- Title: Senior Java Backend Developer
- Company: Enterprise Corp
- Location: Tel Aviv
- Description: Requirements: 5+ years Java, Spring Boot, microservices. Must have: Java 17+, Spring Cloud, Kafka. Nice to have: React for internal tools.

SCORING: 9-10 = perfect match, 7-8 = good, 5-6 = partial, 3-4 = weak, 1-2 = wrong stack
CRITICAL: Wrong-stack tech in REQUIREMENTS = low score (1-3)

Respond with ONLY a JSON object:
{"score": 1-10, "reason": "brief", "highlights": ["matching", "skills"]}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score <= 3;
        return {
          pass: scoreOk,
          details: `score=${json.score} (want <=3), reason="${json.reason}"`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },

  // --- SUMMARIZATION ---
  {
    name: "Summarize: PR comment (context bloat test)",
    prompt: `Summarize this PR review comment in 2-3 sentences. Focus on: what's the issue, severity (HIGH/LOW), and suggested fix.

COMMENT:
File: packages/shared/src/lib/cloud-llm.ts
Line 67: The costUsd calculation uses hardcoded pricing (0.8 input, 4.0 output per MTok). If Anthropic changes Haiku pricing, this will silently produce wrong cost estimates. Consider: 1) Moving prices to a config/env var, 2) Adding a comment with the pricing source URL, 3) Logging a warning if the calculated cost seems unusually high. This is especially important since you're tracking costs for budget monitoring.

RESPOND WITH JUST THE SUMMARY, no JSON.`,
    expectedFormat: "text",
    validate: (r) => {
      const hasIssue = r.toLowerCase().includes("hardcod") || r.toLowerCase().includes("pricing") || r.toLowerCase().includes("cost");
      const hasSeverity = /high|low|medium|minor|major/i.test(r);
      const isShort = r.length < 500;
      return {
        pass: hasIssue && isShort,
        details: `length=${r.length} (want <500), mentions issue=${hasIssue}, has severity=${hasSeverity}. Response: "${r.slice(0, 200)}..."`,
      };
    },
  },

  // --- TAG GENERATION (Zikaron enrichment) ---
  {
    name: "Tag: Classify a debugging conversation chunk",
    prompt: `Classify this Claude Code conversation chunk. Return JSON with metadata.

CHUNK (from a Claude Code session):
"The telegram bot keeps crashing with EADDRINUSE on port 3847. Looking at the launchd plist, KeepAlive=true restarts the process immediately after crash, but the old process still holds the port. I need to add a SIGTERM handler that calls server.stop(true) before exit."

Respond with ONLY a JSON object:
{
  "summary": "1 sentence summary",
  "tags": ["list", "of", "tags"],
  "intent": "debugging|designing|configuring|deciding|researching|reviewing|documenting|testing",
  "entities": {"files": [], "functions": [], "packages": []},
  "importance": 1-10
}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const intentOk = json.intent === "debugging";
        const hasTags = Array.isArray(json.tags) && json.tags.length >= 2;
        const hasSummary = typeof json.summary === "string" && json.summary.length > 10;
        return {
          pass: intentOk && hasTags && hasSummary,
          details: `intent="${json.intent}" (want "debugging"), tags=${JSON.stringify(json.tags)}, summary="${json.summary}", importance=${json.importance}`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },

  // --- EXPANDED TESTS (from Gemini research) ---

  // --- HEBREW ---
  {
    name: "Job: Hebrew partial match (language test)",
    prompt: `You are a job matching assistant. Analyze if this job is a good fit.

CANDIDATE: 3+ years, React/TypeScript/Next.js/Node.js, Full Stack, Israel/remote
PRIMARY skills: TypeScript, React, Next.js, Node.js, MongoDB, TailwindCSS

JOB (Hebrew):
- Title: מפתח/ת Full-Stack
- Company: סטארטאפ בתל אביב
- Location: תל אביב, היברידי
- Description: דרישות: ניסיון של 2+ שנים ב-React ו-Node.js. TypeScript חובה. ניסיון ב-MongoDB יתרון משמעותי. ניסיון ב-PHP יתרון.

SCORING: 9-10 = perfect match, 7-8 = good fit, 5-6 = partial, 3-4 = weak, 1-2 = wrong stack
NOTE: The job is in Hebrew. Parse it correctly. "חובה" = required, "יתרון משמעותי" = significant advantage, "יתרון" = nice to have.

Respond with ONLY a JSON object:
{"score": 1-10, "reason": "brief in English", "highlights": ["matching", "skills"]}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score >= 7 && json.score <= 9;
        const hasReason = typeof json.reason === "string" && json.reason.length > 10;
        return {
          pass: scoreOk && hasReason,
          details: `score=${json.score} (want 7-9), reason="${json.reason}", highlights=${JSON.stringify(json.highlights)}`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },

  // --- AMBIGUOUS ---
  {
    name: "Email: Ambiguous recruiter (should score 5-7)",
    prompt: `You are an email triage assistant for a developer who works heavily with Claude/Anthropic.
Score this email for urgency and categorize it.

EMAIL:
- Subject: Quick question about your profile
- From: sarah@techrecruiter.io
- Preview: Hi! I came across your profile and I think you could be a great fit for something we're working on. Would you be open to a quick chat sometime this week?
- Received: 2026-02-12T14:00:00Z

SCORING CRITERIA:
- Score 10 (IMMEDIATE): Interview invites, payment failed
- Score 7-8 (BRIEFING): Job updates, recruiter messages with specific roles
- Score 5-6 (TRACK): Vague recruiter outreach, generic interest
- Score 3-4 (LOG): Job alert digests, rejections
- Score 1-2 (IGNORE): Newsletters, promos, spam

CATEGORIES: interview, urgent, job, subscription, tech-update, newsletter, promo, social, recruiter, other

Respond with ONLY a JSON object:
{"score": 1-10, "category": "string", "reason": "brief explanation", "subscription": null}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score >= 5 && json.score <= 7;
        const catOk = json.category === "recruiter" || json.category === "job";
        return {
          pass: scoreOk && catOk,
          details: `score=${json.score} (want 5-7), category="${json.category}" (want recruiter|job), reason="${json.reason}"`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },

  // --- MISLEADING TITLE ---
  {
    name: "Job: Misleading title (COBOL, should score 1-2)",
    prompt: `You are a job matching assistant. Analyze if this job is a good fit.

CANDIDATE: 3+ years, React/TypeScript/Next.js, Full Stack, Israel/remote
PRIMARY skills: TypeScript, React, Next.js, Node.js

JOB:
- Title: Rockstar Developer - Shape the Future!
- Company: Legacy Systems Inc
- Location: Remote
- Description: We need a developer with 5+ years of COBOL experience to maintain and modernize our mainframe banking systems. Knowledge of JCL, CICS, and DB2 required. Must understand batch processing and VSAM file structures. "Modernization" means writing REST API wrappers around existing COBOL programs.

SCORING: 9-10 = perfect match, 7-8 = good, 5-6 = partial, 3-4 = weak, 1-2 = wrong stack
CRITICAL: Ignore flashy titles. Score based on ACTUAL REQUIREMENTS only.

Respond with ONLY a JSON object:
{"score": 1-10, "reason": "brief", "highlights": ["matching", "skills"]}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const scoreOk = json.score <= 2;
        return {
          pass: scoreOk,
          details: `score=${json.score} (want <=2), reason="${json.reason}"`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },

  // --- MULTI-LABEL ---
  {
    name: "Tag: Multi-intent conversation chunk",
    prompt: `Classify this Claude Code conversation chunk. Return JSON with metadata.

CHUNK (from a Claude Code session):
"The payment webhook is failing silently — Stripe sends events but our handler returns 200 without processing. I think the issue is in the event type filter. Also, we should add Sentry monitoring to catch these earlier. Let me check if there's already a Sentry integration in the codebase, and I'll set up a quick test to verify the webhook handler."

Respond with ONLY a JSON object:
{
  "summary": "1 sentence summary",
  "tags": ["list", "of", "tags"],
  "intents": ["primary_intent", "secondary_intent"],
  "entities": {"files": [], "services": [], "packages": []},
  "importance": 1-10
}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const hasMultipleIntents = Array.isArray(json.intents) && json.intents.length >= 2;
        const hasTags = Array.isArray(json.tags) && json.tags.length >= 3;
        const mentionsStripe = JSON.stringify(json).toLowerCase().includes("stripe") ||
                               JSON.stringify(json).toLowerCase().includes("webhook") ||
                               JSON.stringify(json).toLowerCase().includes("payment");
        const mentionsSentry = JSON.stringify(json).toLowerCase().includes("sentry") ||
                               JSON.stringify(json).toLowerCase().includes("monitoring");
        return {
          pass: hasMultipleIntents && hasTags && mentionsStripe,
          details: `intents=${JSON.stringify(json.intents)} (want >=2), tags=${JSON.stringify(json.tags)}, stripe=${mentionsStripe}, sentry=${mentionsSentry}`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },

  // --- ACTION ITEM EXTRACTION ---
  {
    name: "Summarize: Extract action items from thread",
    prompt: `Extract action items from this email thread. Return structured JSON.

EMAIL THREAD:
---
From: alice@company.com
Subject: Re: Q1 Planning
Date: Feb 10

> From: bob@company.com
> We need to finalize the Q1 roadmap by Friday. The main items are:
> 1. Migrate the auth system to OAuth2
> 2. Set up monitoring dashboards
> 3. Fix the performance regression in the search API

From: alice@company.com
OK, I'll handle the OAuth2 migration since I'm already deep in the auth code.

From: charlie@company.com
I can set up the Grafana dashboards. Bob, can you look into the search API perf issue? I think it's the new Elasticsearch query.

From: bob@company.com
Sure, I'll investigate the search regression. Let's sync on Friday to review progress. Alice — can you also update the API docs when the OAuth2 migration is done?
---

Extract ALL action items with owners. Respond with ONLY a JSON object:
{"action_items": [{"owner": "name", "task": "description", "deadline": "if mentioned"}]}`,
    expectedFormat: "json",
    validate: (r) => {
      try {
        const match = r.match(/\{[\s\S]*\}/);
        if (!match) return { pass: false, details: "No JSON found" };
        const json = JSON.parse(match[0]);
        const items = json.action_items;
        if (!Array.isArray(items)) return { pass: false, details: "action_items not an array" };
        const hasAlice = items.some((i: any) => i.owner?.toLowerCase().includes("alice"));
        const hasBob = items.some((i: any) => i.owner?.toLowerCase().includes("bob"));
        const hasCharlie = items.some((i: any) => i.owner?.toLowerCase().includes("charlie"));
        const hasEnough = items.length >= 3;
        return {
          pass: hasAlice && hasBob && hasCharlie && hasEnough,
          details: `${items.length} items (want >=3), alice=${hasAlice}, bob=${hasBob}, charlie=${hasCharlie}. Items: ${items.map((i: any) => `${i.owner}: ${i.task}`).join(" | ")}`,
        };
      } catch (e) {
        return { pass: false, details: `JSON parse error: ${e}` };
      }
    },
  },
];

// ============================================================
// Runners
// ============================================================

async function runOllamaGLM(prompt: string): Promise<{ text: string; durationMs: number }> {
  const start = Date.now();
  try {
    const resp = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: GLM_MODEL, prompt, stream: false }),
    });
    const data = await resp.json() as any;
    return { text: data.response || "", durationMs: Date.now() - start };
  } catch (e) {
    return { text: `ERROR: ${e}`, durationMs: Date.now() - start };
  }
}

// Cache the API key after first lookup
let _haikuApiKey: string | null | undefined;
async function getHaikuApiKey(): Promise<string | null> {
  if (_haikuApiKey !== undefined) return _haikuApiKey;
  // Try 1Password first (the real golems API key)
  try {
    const result = Bun.spawnSync(["op", "read", "op://development/ANTHROPIC_GOLEMS_API_KEY/credential"]);
    const key = result.stdout.toString().trim();
    if (key && key.startsWith("sk-ant-")) {
      _haikuApiKey = key;
      return key;
    }
  } catch {}
  // Fall back to env var (may be subscription key — won't work)
  const envKey = process.env.ANTHROPIC_API_KEY;
  _haikuApiKey = envKey || null;
  return _haikuApiKey;
}

async function runHaiku(prompt: string): Promise<{ text: string; durationMs: number }> {
  const apiKey = await getHaikuApiKey();
  if (!apiKey) {
    return { text: "SKIP: No API key found (tried 1Password + env)", durationMs: 0 };
  }

  const start = Date.now();
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json() as any;
    if (data.error) {
      return { text: `API_ERROR: ${data.error.message || JSON.stringify(data.error)}`, durationMs: Date.now() - start };
    }
    const text = data.content?.[0]?.text || "";
    return { text, durationMs: Date.now() - start };
  } catch (e) {
    return { text: `ERROR: ${e}`, durationMs: Date.now() - start };
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("=".repeat(70));
  console.log("  GLM-4.7-Flash vs Haiku 4.5 Benchmark");
  console.log("  Real golems workloads: email scoring, job matching, summarization, tagging");
  console.log("=".repeat(70));
  console.log();

  // Check if Ollama is running
  try {
    await fetch("http://127.0.0.1:11434/api/tags");
  } catch {
    console.error("ERROR: Ollama not running. Start it with: ollama serve");
    process.exit(1);
  }

  // Check if GLM model exists
  const tagsResp = await fetch("http://127.0.0.1:11434/api/tags");
  const tagsData = await tagsResp.json() as any;
  const hasGLM = tagsData.models?.some((m: any) => m.name.includes("glm-4.7-flash"));
  if (!hasGLM) {
    console.error(`ERROR: ${GLM_MODEL} not found. Pull it with: ollama pull ${GLM_MODEL}`);
    process.exit(1);
  }

  const haikuKey = await getHaikuApiKey();
  const hasHaikuKey = !!haikuKey;
  console.log(`GLM-4.7-Flash: Ready (local Ollama)`);
  console.log(`Haiku 4.5:     ${hasHaikuKey ? "Ready (API key found)" : "SKIP (no key found)"}`);
  console.log();

  interface Result {
    name: string;
    glm: { text: string; durationMs: number; pass: boolean; details: string };
    haiku: { text: string; durationMs: number; pass: boolean; details: string } | null;
  }

  const results: Result[] = [];

  for (const tc of TEST_CASES) {
    console.log(`--- ${tc.name} ---`);

    // Run GLM
    console.log("  GLM:   running...");
    const glmResult = await runOllamaGLM(tc.prompt);
    const glmVal = tc.validate(glmResult.text);
    console.log(`  GLM:   ${glmVal.pass ? "PASS" : "FAIL"} (${glmResult.durationMs}ms)`);
    console.log(`         ${glmVal.details}`);

    // Run Haiku
    let haikuEntry: Result["haiku"] = null;
    if (hasHaikuKey) {
      console.log("  Haiku: running...");
      const haikuResult = await runHaiku(tc.prompt);
      const haikuVal = tc.validate(haikuResult.text);
      console.log(`  Haiku: ${haikuVal.pass ? "PASS" : "FAIL"} (${haikuResult.durationMs}ms)`);
      console.log(`         ${haikuVal.details}`);
      haikuEntry = { ...haikuResult, ...haikuVal };
    }

    results.push({
      name: tc.name,
      glm: { ...glmResult, ...glmVal },
      haiku: haikuEntry,
    });

    console.log();
  }

  // Summary table
  console.log("=".repeat(70));
  console.log("  SUMMARY");
  console.log("=".repeat(70));
  console.log();

  const glmPassed = results.filter((r) => r.glm.pass).length;
  const haikuPassed = results.filter((r) => r.haiku?.pass).length;
  const glmAvgMs = Math.round(results.reduce((s, r) => s + r.glm.durationMs, 0) / results.length);
  const haikuAvgMs = hasHaikuKey
    ? Math.round(results.reduce((s, r) => s + (r.haiku?.durationMs || 0), 0) / results.length)
    : 0;

  console.log(`| Test | GLM | Haiku | GLM ms | Haiku ms |`);
  console.log(`|------|-----|-------|--------|----------|`);
  for (const r of results) {
    const glmStatus = r.glm.pass ? "PASS" : "FAIL";
    const haikuStatus = r.haiku ? (r.haiku.pass ? "PASS" : "FAIL") : "SKIP";
    console.log(
      `| ${r.name.padEnd(45)} | ${glmStatus.padEnd(4)} | ${haikuStatus.padEnd(5)} | ${String(r.glm.durationMs).padStart(6)}ms | ${String(r.haiku?.durationMs || 0).padStart(8)}ms |`
    );
  }
  console.log();
  console.log(`GLM:   ${glmPassed}/${results.length} passed, avg ${glmAvgMs}ms, cost: $0`);
  if (hasHaikuKey) {
    console.log(`Haiku: ${haikuPassed}/${results.length} passed, avg ${haikuAvgMs}ms, cost: ~$0.002 per run`);
  }
  console.log();

  // RAM check
  try {
    const psOutput = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(process.pid)]);
    const rssKb = parseInt(psOutput.stdout.toString().trim());
    console.log(`Benchmark process RSS: ${Math.round(rssKb / 1024)}MB`);
  } catch {}

  // Ollama model memory
  try {
    const resp = await fetch("http://127.0.0.1:11434/api/ps");
    const data = await resp.json() as any;
    if (data.models?.length) {
      for (const m of data.models) {
        console.log(`Ollama ${m.name}: ${Math.round((m.size || 0) / 1024 / 1024 / 1024)}GB VRAM`);
      }
    }
  } catch {}
}

main().catch(console.error);
