# LLM Call Sites Audit

> Audit of all LLM invocations for classification, scoring, extraction, and summarization tasks across the golems monorepo.
>
> **Scope:** `packages/shared/`, `packages/jobs/`, `packages/services/`, `packages/claude/` (plus `packages/teller/` and scripts)
>
> **Date:** 2026-02-12
>
> **Second pass:** Verified completeness; added thread-compactor routing note, external CLI agents, and embedding sources.

---

## Summary Table

| File:Line | Task | Current Model | Fine-tunable? | Daily Volume (est.) |
|-----------|------|----------------|---------------|---------------------|
| `packages/shared/src/email/scorer.ts:243` | Email scoring (1-10), category, subscription extraction | Haiku / qwen2.5-coder:7b | ✅ Yes | ~50–100 |
| `packages/jobs/src/matcher.ts:60` | Job matching (1-10), reason, highlights | Haiku / qwen2.5-coder:7b | ✅ Yes | ~45–150 |
| `packages/jobs/src/mcp-server.ts:650-671` | Cover letter generation | claude-haiku-4-5-20251001 | ✅ Yes | Low (on-demand) |
| `packages/services/src/thread-compactor.ts:124` | Conversation summarization | qwen2.5-coder:7b (always Ollama) | ✅ Yes | Low (thread compaction) |
| `packages/services/src/validation-service.ts:86` | LLM output validation (approved/rejected, confidence) | claude-sonnet-4-20250514 | ✅ Yes | Low (sandbox mode only) |
| `packages/services/src/ollama-chat-bot.ts:136` | General chat (Telegram) | qwen3-coder-64k | ❌ No | User-driven |
| `packages/shared/src/lib/helpers.ts:256` | General helper fallback (research, summarization) | claude-haiku-4-5-20251001 | ❌ No | Varies |
| `packages/teller/src/categorizer.ts:45` | Expense categorization (IRS Schedule C) | Haiku / qwen2.5-coder:7b | ✅ Yes | ~5–20 |
| `packages/teller/src/alerts.ts:34` | Payment failure detection + extraction | Haiku / qwen2.5-coder:7b | ✅ Yes | Very low |
| `scripts/summarize-file.sh:97-105` | File summarization | claude-haiku-4-5-20251001 | ❌ No | On-demand |

---

## Backend Routing

| Backend | Condition | Model | Used By |
|---------|-----------|-------|---------|
| **cloud-llm.ts** | `LLM_BACKEND=haiku` | claude-haiku-4-5-20251001 | scorer, matcher, mcp-server, helpers, categorizer, alerts |
| **ollama-helper.ts** | `LLM_BACKEND=ollama` (default) | OLLAMA_MODEL \|\| qwen2.5-coder:7b | scorer, matcher, categorizer, alerts |
| **ollama-helper.ts** | Direct import (bypasses llm.ts) | OLLAMA_MODEL \|\| qwen2.5-coder:7b | **thread-compactor** (always local Ollama) |
| **ollama-sandboxed.ts** | `OLLAMA_SANDBOXED=1` | OLLAMA_MODEL \|\| qwen3-coder-64k | Same as ollama-helper when sandboxed |
| **validation-service.ts** | Direct Anthropic (separate) | claude-sonnet-4-20250514 | Validates sandboxed Ollama outputs |
| **ollama-chat-bot.ts** | Direct `ollama` npm SDK | qwen3-coder-64k | Telegram chat bot |

---

## Embeddings (Non-Generative)

| File:Line | Task | Model | Fine-tunable? | Daily Volume |
|-----------|------|-------|---------------|-------------|
| `packages/shared/src/lib/ollama-helper.ts:59` | Text embedding (Ollama HTTP API) | mxbai-embed-large | N/A | Used by thread-compactor, similarity search |
| `packages/shared/src/lib/ollama-sandboxed.ts:326` | Same embedding (when OLLAMA_SANDBOXED=1) | mxbai-embed-large | N/A | Same callers via llm.ts |
| `packages/services/src/thread-compactor.ts:143` | Summary embedding | mxbai-embed-large | N/A | Low |
| `packages/ralph/skills/golem-powers/learn-mistake/scripts/aggregate.ts:61` | Mistake clustering (Python) | bge-large-en-v1.5 (Zikaron) | N/A | On-demand (skill script) |

---

## External CLI Agents (Subprocess Spawn)

These spawn external CLI tools; **not** direct API calls via cloud-llm or ollama-helper:

| File:Line | Agent | Execution | Daily Volume |
|-----------|-------|-----------|--------------|
| `packages/shared/src/lib/agent-runner.ts:198` | runHelper() | gemini → kiro → codex → cursor → **haiku** (cloud-llm) | Research workflows |
| `packages/shared/src/lib/exploration.ts:67-72` | AGENT_COMMANDS | gemini, cursor, codex, kiro, haiku (via `claude --print`) | Exploration sessions |
| `packages/shared/src/lib/helpers.ts:199-235` | runCliHelper() | gemini, cursor, codex, kiro (haiku uses cloud-llm) | Helper fallback chain |

**Note:** agent-runner uses runHelper(); when backend is "ollama" or "claude" it passes `undefined` and uses fallback chain (haiku is last). So ollama is never actually invoked via agent-runner.

---

## Ideal Training Data Format by Task Type

### 1. Email Scoring (scorer.ts)

**Input:** `{ subject, from, snippet, receivedAt }`  
**Output:** `{ score: 1-10, category, reason, subscription: {...} | null }`

**Training format:**
```jsonl
{"messages": [{"role": "user", "content": "Score this email...\n\nEMAIL:\n- Subject: ...\n- From: ...\n- Preview: ..."}, {"role": "assistant", "content": "{\"score\": 8, \"category\": \"job\", \"reason\": \"...\", \"subscription\": null}"}]}
```

**Ideal dataset:** 500–2000 examples; balanced across scores 1–10; mix of categories (interview, urgent, job, subscription, tech-update, newsletter, promo, social, other).

---

### 2. Job Matching (matcher.ts)

**Input:** Profile + job listing (title, company, location, description, source)  
**Output:** `{ score: 1-10, reason, highlights: string[] }`

**Training format:**
```jsonl
{"messages": [{"role": "user", "content": "You are a job matching assistant...\n\nCANDIDATE PROFILE: ...\nJOB LISTING: ...\n\nRespond with ONLY a JSON object: {...}"}, {"role": "assistant", "content": "{\"score\": 8, \"reason\": \"...\", \"highlights\": [\"React\", \"TypeScript\"]}"}]}
```

**Ideal dataset:** 500–2000 examples; balanced scores; Hebrew + English jobs; clear distinction between requirements vs nice-to-have in model output.

---

### 3. Cover Letter Generation (mcp-server.ts)

**Input:** Job details + candidate profile + style  
**Output:** Free-form cover letter (200–300 words)

**Training format:**
```jsonl
{"messages": [{"role": "user", "content": "Write a [style] cover letter for this job...\n\nJOB: ...\nCANDIDATE: ..."}, {"role": "assistant", "content": "Dear Hiring Manager,\n\n..."}]}
```

**Ideal dataset:** 100–500 examples; multiple styles (professional, casual, concise); real cover letters with known outcomes.

---

### 4. Conversation Summarization (thread-compactor.ts)

**Input:** `role: content` lines from messages  
**Output:** 3–4 sentence summary

**Training format:**
```jsonl
{"messages": [{"role": "user", "content": "Summarize the following conversation concisely (3-4 sentences max):\n\nuser: ...\nassistant: ...\n\nSummary:"}, {"role": "assistant", "content": "..."}]}
```

**Ideal dataset:** 1000–5000 examples; diverse conversation types (support, coding, planning); consistent length/style.

---

### 5. Validation (validation-service.ts)

**Input:** Original prompt + Ollama response  
**Output:** `{ approved: boolean, reason, confidence: 0-1, flags?: string[] }`

**Training format:**
```jsonl
{"messages": [{"role": "user", "content": "You are a security validator...\n\nSOURCE: ...\nORIGINAL PROMPT: ...\nRESPONSE TO VALIDATE: ..."}, {"role": "assistant", "content": "{\"approved\": false, \"reason\": \"...\", \"confidence\": 0.9, \"flags\": [\"...\"]}"}]}
```

**Ideal dataset:** 500–1000 examples; mix of safe vs malicious/injection/outputs; human-labeled decisions.

---

### 6. Expense Categorization (categorizer.ts)

**Input:** Email from/subject/snippet  
**Output:** `{ category, confidence, reasoning, amount?, vendor? }`

**Training format:**
```jsonl
{"messages": [{"role": "user", "content": "Categorize this business expense into IRS Schedule C...\n\nEmail from: ...\nSubject: ...\nSnippet: ...\n\nValid categories: ..."}, {"role": "assistant", "content": "{\"category\": \"software\", \"confidence\": 0.95, \"reasoning\": \"...\", \"amount\": 9.99, \"vendor\": \"Spotify\"}"}]}
```

**Ideal dataset:** 300–1000 examples; IRS Schedule C categories; receipts, invoices, subscription confirmations.

---

### 7. Payment Failure Detection (alerts.ts)

**Input:** Email subject + snippet (pre-filtered by regex)  
**Output:** `{ isFailure: boolean, vendor, amount?, reason, actionNeeded }`

**Training format:**
```jsonl
{"messages": [{"role": "user", "content": "Analyze this email for payment failure details...\n\nFrom: ...\nSubject: ...\nContent: ...\n\nIs this a genuine payment failure? Respond JSON: {...}"}, {"role": "assistant", "content": "{\"isFailure\": true, \"vendor\": \"Netflix\", \"amount\": 15.99, \"reason\": \"Card declined\", \"actionNeeded\": \"Update payment method\"}"}]}
```

**Ideal dataset:** 200–500 examples; mix of true failures vs marketing ("upgrade now", "payment due soon"); consistent JSON schema.

---

## Data Sources for Training

| Task | Best Source |
|------|-------------|
| Email scoring | Zikaron: `query="email score 1-10 importance"` |
| Job matching | Zikaron: `query="job match score reason"`; `golem_jobs` table with scores |
| Cover letter | Manual collection; `job_cover_letters` table |
| Summarization | Zikaron: `query="summarize extract key points"`; thread-compactor outputs |
| Validation | Validation queue `approved/` and `rejected/` with human review |
| Expense categorization | `subscriptions` + `payments` + email receipts |
| Payment failure | `payments` + failure emails |

---

## Notes

- **cloud-llm.ts** and **ollama-helper.ts** are the main LLM facades; **llm.ts** routes between them via `LLM_BACKEND`.
- **thread-compactor** imports ollama-helper directly—bypasses `LLM_BACKEND`; always uses local Ollama with no hosted Haiku fallback.
- **scripts/benchmark-glm.ts** tests GLM-4.7-Flash locally but is not a production call site.
- **draft-reply.ts** is template-based; no LLM calls.
- **packages/claude/** has no direct LLM calls in the audited paths; it orchestrates via MCP and other golems.
- **packages/recruiter**, **packages/content**, **packages/coach**—no LLM imports found.
- **ollama-wrapper** referenced in docs/contexts; actual code uses `@golems/shared/lib/llm`; wrapper was deprecated.
