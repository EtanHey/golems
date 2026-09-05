# Golems Docs Sync Audit — etanheyman.com vs golems

**Source of truth:** `~/Gits/golems/packages/dashboard/content/docs/`  
**Stale copy:** `~/Gits/etanheyman.com/content/golems/`  
**Audit date:** 2026-02-17

---

## Summary

| Metric | Count |
|--------|-------|
| Missing in etanheyman.com | 3 |
| Orphaned in etanheyman.com | 3 |
| Differ | 20 |
| Identical | 4 |

---

## 1. Missing in etanheyman.com (in golems, not in etanheyman.com)

| File | Status | What's different |
|------|--------|------------------|
| `content-pipelines.md` | **Missing** | Not present in etanheyman.com |
| `packages/orchestrator.md` | **Missing** | Not present in etanheyman.com |
| `packages/dashboard.md` | **Missing** | Not present in etanheyman.com |

---

## 2. Orphaned in etanheyman.com (in etanheyman.com, not in golems)

| File | Status | What's different |
|------|--------|------------------|
| `SECURITY-SWEEP.md` | **Orphaned** | Security audit from 2026-02-11; not in golems |
| `VERIFICATION-RESULTS.md` | **Orphaned** | Cross-reference verification from 2026-02-11; not in golems |
| `VERIFICATION-RESULTS-V2.md` | **Orphaned** | Second verification pass; not in golems |

---

## 3. Files That Differ

| File | Status | What's different |
|------|--------|------------------|
| `packages/content.md` | **Differ** | Major rewrite — golems has condensed structure; etanheyman.com has longer version with mermaid diagrams, pipeline tables, quality gates, expanded ComfyUI/DataViz sections |
| `getting-started.md` | **Differ** | Package count 14→15, Zikaron 260K→238K chunks, folder order (orchestrator, tax-helper, autonomous) |
| `faq.md` | **Differ** | Zikaron chunk count 260K→238K, DB size 1.4GB→1–2GB |
| `deployment/railway.md` | **Differ** | Golems: retired Railway page after the 2026-07-05 service deletion. Etanheyman: older active Railway deployment guidance |
| `cloud-worker.md` | **Differ** | Golems: Model column (Gemini Flash-Lite). Etanheyman: no model column |
| `golems/recruiter.md` | **Differ** | Golems: title/description frontmatter, `packages/recruiter/src/` paths, no Interview Practice section. Etanheyman: sidebar_position, `src/recruiter-golem/` paths, Interview Practice table |
| `golems/coach.md` | **Differ** | Golems: Huberman protocols, LLM coaching, `/schedule` command, dashboard page, protocol, env vars. Etanheyman: simpler life planner, no dashboard |
| `architecture.md` | **Differ** | Golems: 7 golems, 14 packages, Mac + local/successor scheduler + Vercel, architecture-flow.svg, Gemini, Render Service, Enrichment, dashboard, updated DB schema. Etanheyman: 6 golems, 10 packages, older Railway-era schema |
| `llm.md` | **Differ** | Golems: concatenated docs with current architecture. Etanheyman: different structure, "For LLMs" title, sidebar_position in body, older content throughout |
| `golems/claude.md` | **Differ** | Golems: title/description, Files section split (core/infra/shared). Etanheyman: sidebar_position, monolithic Files list, different Source link |
| `golems/teller.md` | **Differ** | Golems: title/description frontmatter. Etanheyman: sidebar_position only |
| `journey.md` | **Differ** | Zikaron 260K→238K, test count 1,148→1,179, packages 14→10, "What's Next" section (golems: dashboard, content pipeline; etanheyman: deploy, smoke test, teaching mode) |
| `golems/email.md` | **Differ** | Golems: title/description frontmatter. Etanheyman: sidebar_position only |
| `mcp-tools.md` | **Differ** | Golems: golems-glm MCP server, All MCP Servers table, zikaron 260K, 8 tools, filters (content_type, source, tag, intent, importance_min), zikaron_file_timeline, zikaron_operations, zikaron_regression, zikaron_plan_links, GLM tools section. Etanheyman: missing all of above |
| `packages/zikaron.md` | **Differ** | Golems: 260K chunks, 10-field enrichment, PII sanitization, HTTP daemon :8787, 8 MCP tools, enrichment backends (Ollama/MLX/Gemini). Etanheyman: 238K, Unix socket, 3 MCP tools, no enrichment/PII sections |
| `packages/services.md` | **Differ** | Golems: current local/successor scheduler rows. Etanheyman: older Railway-era service rows |
| `packages/shared.md` | **Differ** | Golems: vercel-llm, glm-llm, mlx-llm, Gemini/Groq. Etanheyman: Haiku/Ollama only |
| `golems/job-golem.md` | **Differ** | Golems: title/description frontmatter. Etanheyman: sidebar_position only |
| `configuration/env-vars.md` | **Differ** | Golems: LLM_BACKEND=gemini (default), GOOGLE_GENERATIVE_AI_API_KEY, Gemini free tier. Etanheyman: LLM_BACKEND=haiku, ANTHROPIC_API_KEY only |

---

## 4. Identical (no diff)

| File | Status | What's different |
|------|--------|------------------|
| `skills.md` | Identical | — |
| `packages/ralph.md` | Identical | — |
| `interview-practice.md` | Identical | — |
| `per-repo-sessions.md` | Identical | — |
| `configuration/secrets.md` | Identical | — |

---

## 5. Folder Structure

**Same structure.** Both have:
- `configuration/` (env-vars.md, secrets.md)
- `deployment/` (railway.md)
- `golems/` (claude.md, coach.md, email.md, job-golem.md, recruiter.md, teller.md)
- `packages/` (content.md, dashboard.md*, orchestrator.md*, ralph.md, services.md, shared.md, zikaron.md)

\* dashboard.md and orchestrator.md exist only in golems.

---

## 6. Renamed Files

No files with different names but same content were found. All path differences correspond to structural differences (missing/orphaned/differ).

---

## Key Drift Themes

1. **Zikaron:** 238K→260K chunks, 10-field enrichment, PII sanitization, 8 MCP tools (file_timeline, operations, regression, plan_links)
2. **LLM:** Gemini Flash-Lite (free) as default vs Haiku; Render Service; Enrichment pipeline
3. **Architecture:** 14 packages, Mac + local/successor scheduler + Vercel, dashboard, updated DB schema
4. **Coach:** Huberman protocols, LLM coaching, `/schedule`, dashboard page
5. **Content:** Condensed vs expanded (etanheyman.com has more mermaid diagrams; golems is source of truth)
