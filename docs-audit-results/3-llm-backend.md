# LLM Backend Documentation Audit

Verification of `packages/dashboard/content/docs/` for correct representation of cloud LLM backend. **Current reality:** Cloud worker uses **Gemini Flash-Lite** (`LLM_BACKEND=gemini`). Haiku is only a paid fallback. `GOOGLE_GENERATIVE_AI_API_KEY` is the primary cloud key.

---

## Summary

| Category | Count |
|----------|-------|
| **INCORRECT** (Haiku as primary/default) | 18 |
| **OK** (correct or acceptable) | — |

---

## 1. INCORRECT — Docs Stating Haiku as Primary/Default Cloud Backend

### 1.1 Health Check Example (llm.md)

**File:** `packages/dashboard/content/docs/llm.md`  
**Lines:** ~901

Health check JSON example shows `"backend": "haiku"`. Cloud worker uses Gemini.

```json
"backend": "haiku",   // INCORRECT — should be "gemini"
```

---

### 1.2 Retired Railway Rollback Example (llm.md)

**File:** `packages/dashboard/content/docs/llm.md`  
**Lines:** ~969-971

"Switch back" example sets `LLM_BACKEND=haiku`. This is now historical because the Railway service was deleted on 2026-07-05; any successor-host example should use `gemini` as the hosted default, not haiku.

```bash
railway variables set LLM_BACKEND=haiku   # INCORRECT — should be gemini
railway up
```

---

### 1.3 Mode Table — Hybrid & Full Cloud (llm.md)

**File:** `packages/dashboard/content/docs/llm.md`  
**Lines:** ~1115-1119

Table says both Hybrid and Full Cloud use "Haiku (cloud)". Should say Gemini (cloud).

| Mode | Doc Says | Should Say |
|------|----------|------------|
| Hybrid | Haiku (cloud) | Gemini (cloud) |
| Full Cloud | Haiku (cloud) | Gemini (cloud) |

---

### 1.4 Cost Table (llm.md)

**File:** `packages/dashboard/content/docs/llm.md`  
**Lines:** ~1127-1132

- **Anthropic (Haiku 4.5)** listed as ~$5-15/mo primary cost. Should be "Optional (Haiku fallback)" — Gemini is free.
- **Total** ~$10-25/mo — overstated; with Gemini free, successor-host-only costs should exclude retired Railway assumptions.

---

### 1.5 Tech Stack Table (llm.md)

**File:** `packages/dashboard/content/docs/llm.md`  
**Lines:** ~1156-1158

```
| **LLM** | Anthropic Haiku 4.5 (cloud) or Ollama (local) |
```

**INCORRECT.** Should list: Gemini 2.5 Flash-Lite (cloud, free), Haiku 4.5 (fallback), Ollama (local).

---

### 1.6 Email Pipeline Diagram (llm.md, golems/email.md)

**Files:**
- `packages/dashboard/content/docs/llm.md` ~line 1636
- `packages/dashboard/content/docs/golems/email.md` ~line 16

Mermaid diagram shows `C[Scoring<br/>Haiku LLM]`. Cloud worker uses Gemini. Should say "Gemini LLM" or "Cloud LLM".

---

### 1.7 Email Scoring Description (llm.md, golems/email.md)

**Files:**
- `packages/dashboard/content/docs/llm.md` ~line 1648
- `packages/dashboard/content/docs/golems/email.md` ~line 28

> Scoring is done via Ollama by default (or Haiku when `LLM_BACKEND=haiku`)

**INCORRECT.** Omits Gemini. Should mention: cloud worker uses Gemini by default; Haiku when `LLM_BACKEND=haiku`; Ollama when `LLM_BACKEND=ollama`.

---

### 1.8 Scorer.ts Description (llm.md, golems/email.md)

**Files:**
- `packages/dashboard/content/docs/llm.md` ~line 1666
- `packages/dashboard/content/docs/golems/email.md` ~line 46

> `scorer.ts` — Ollama/Haiku scoring pipeline

**INCORRECT.** Omits Gemini. Should say "Gemini/Ollama/Haiku" or "multi-backend".

---

### 1.9 @golems/shared LLM Module (llm.md)

**File:** `packages/dashboard/content/docs/llm.md`  
**Lines:** ~3598, ~3634-3635

- Table: `Multi-backend LLM runner (Haiku, Ollama)` — omits Gemini.
- Code block lists `LLM_BACKEND=haiku` first for cloud, `LLM_BACKEND=ollama` for local — omits `gemini` as cloud default.

---

### 1.10 packages/shared.md — LLM Order

**File:** `packages/dashboard/content/docs/packages/shared.md`  
**Lines:** ~74-76

Code block lists `haiku` first, `ollama` second. Gemini should be listed first for cloud (free default). Current order implies Haiku is primary cloud option.

---

### 1.11 Golem-Specific Env Examples

**Files:**
- `packages/dashboard/content/docs/golems/email.md` ~line 110
- `packages/dashboard/content/docs/golems/recruiter.md` ~line 194
- `packages/dashboard/content/docs/golems/teller.md` ~line 138
- `packages/dashboard/content/docs/golems/job-golem.md` ~line 92

Examples show `LLM_BACKEND=haiku` for cloud. Should show `gemini` as primary cloud option, with `haiku` as optional fallback, e.g.:

```bash
export LLM_BACKEND=gemini  # or 'haiku' (paid fallback), 'ollama' (local)
```

---

### 1.12 architecture.md — Hybrid Mode Example

**File:** `packages/dashboard/content/docs/architecture.md`  
**Lines:** ~141

Hybrid mode example uses `LLM_BACKEND=haiku`. For cloud LLM in hybrid, `gemini` is the default; `haiku` is optional.

---

## 2. OK — Correct or Acceptable

### 2.1 Env Var Tables

- **`configuration/env-vars.md`** — Correct. `GOOGLE_GENERATIVE_AI_API_KEY` under "Cloud Backend (Gemini — Free)" first; `ANTHROPIC_API_KEY` under "Cloud Backend (Haiku — Paid Fallback)". `LLM_BACKEND` description says "cloud-worker uses `gemini`".
- **`llm.md`** core config table (~335) — Correct. Description includes "cloud-worker sets `gemini`".

### 2.2 Retired Railway Deployment

- **`deployment/railway.md`** — Retired after the Railway service was deleted on 2026-07-05. Keep only historical notes and do not use it for current operations.

### 2.3 FAQ

- **`faq.md`** — Correct. "Production switched from Haiku ($5-15/mo) to Gemini Flash-Lite (free) in Feb 2026." LLM list includes "Gemini 2.5 Flash-Lite (cloud, free), Haiku 4.5 (fallback)".

### 2.4 Historical / Example References (FINE)

- JSON examples with `"model": "claude-haiku-4-5-20251001"` — example data only.
- Haiku 4.5 pricing ($0.80/$4.00 per MTok) — accurate for fallback.
- "Built with help from 5 CLI agents... Haiku" (journey.md, llm.md) — historical.
- Phase 2 cost tracking "Haiku 4.5 at $0.80/MTok" — historical context.

---

## 3. Recommendations

| Priority | Action |
|----------|--------|
| High | Update mode table (Hybrid/Full Cloud) to Gemini |
| High | Fix health check example `"backend": "gemini"` |
| High | Remove or clearly retire Railway rollback examples |
| High | Update tech stack LLM row to list Gemini first |
| High | Update email diagram to "Gemini LLM" or "Cloud LLM" |
| Medium | Update cost table (Gemini free, Haiku optional) |
| Medium | Update scorer/email descriptions to include Gemini |
| Medium | Update @golems/shared section in llm.md (Gemini, Ollama, Haiku) |
| Medium | Update packages/shared.md to list gemini first |
| Low | Update golem-specific env examples to gemini as default cloud |

---

## 4. Files to Edit

| File | Changes |
|------|---------|
| `packages/dashboard/content/docs/llm.md` | Health example, rollback, mode table, cost table, tech stack, diagram, scorer, @golems/shared section |
| `packages/dashboard/content/docs/architecture.md` | Hybrid mode example |
| `packages/dashboard/content/docs/golems/email.md` | Diagram, scoring text, scorer, env example |
| `packages/dashboard/content/docs/golems/recruiter.md` | Env example |
| `packages/dashboard/content/docs/golems/teller.md` | Env example |
| `packages/dashboard/content/docs/golems/job-golem.md` | Env example |
| `packages/dashboard/content/docs/packages/shared.md` | LLM backend order |
