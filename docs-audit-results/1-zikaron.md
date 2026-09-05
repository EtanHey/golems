# Zikaron Documentation Audit

Verification of `packages/dashboard/content/docs/packages/zikaron.md` and the "# Zikaron (Memory)" section in `packages/dashboard/content/docs/llm.md` against actual code.

---

## 1. MCP Tools (`packages/zikaron/src/zikaron/mcp/__init__.py`)

**OK** — All 8 tools listed in the docs match the code:

| Doc | Code | Status |
|-----|------|--------|
| `zikaron_search` | ✓ | OK |
| `zikaron_context` | ✓ | OK |
| `zikaron_stats` | ✓ | OK |
| `zikaron_list_projects` | ✓ | OK |
| `zikaron_file_timeline` | ✓ | OK |
| `zikaron_operations` | ✓ | OK |
| `zikaron_regression` | ✓ | OK |
| `zikaron_plan_links` | ✓ | OK |

No missing or renamed tools.

---

## 2. Enrichment Fields (`packages/zikaron/src/zikaron/pipeline/enrichment.py`)

**OK** — All 10 fields in the docs match the `ENRICHMENT_PROMPT` template and `parse_enrichment()`:

| Field | In prompt | In parse_enrichment | Status |
|-------|-----------|---------------------|--------|
| `summary` | ✓ | ✓ | OK |
| `tags` | ✓ | ✓ | OK |
| `importance` | ✓ | ✓ | OK |
| `intent` | ✓ | ✓ | OK |
| `primary_symbols` | ✓ | ✓ | OK |
| `resolved_query` | ✓ | ✓ | OK |
| `epistemic_level` | ✓ | ✓ | OK |
| `version_scope` | ✓ | ✓ | OK |
| `debt_impact` | ✓ | ✓ | OK |
| `external_deps` | ✓ | ✓ | OK |

---

## 3. PII Sanitization (`packages/zikaron/src/zikaron/pipeline/sanitize.py`)

**OK** — The 3-layer description is accurate:

| Layer | Docs | Code | Status |
|-------|------|------|--------|
| 1. Regex | owner names, emails, file paths, IPs, JWTs, phone numbers, 1Password refs, GitHub username | owner_emails, owner_paths, GitHub URL/@mention, owner_names, general emails, IPs, JWTs, op_ref (1Password), phone | OK |
| 2. Known names | WhatsApp contacts + manual list (Hebrew + English, nikud normalization) | `_known_names_re` from config, nikud stripping for Hebrew | OK |
| 3. spaCy NER | unknown English person names (`en_core_web_sm`) | `spacy.load("en_core_web_sm")`, PERSON entities | OK |

---

## 4. CLI Commands (`packages/zikaron/src/zikaron/cli/__init__.py`)

**OK** — The 4 CLI commands shown in the docs exist and work:

| Doc | Code | Status |
|-----|------|--------|
| `zikaron search` | ✓ `search` | OK |
| `zikaron enrich` | ✓ `enrich` | OK |
| `zikaron index` | ✓ `index` (delegates to `index_fast`) | OK |
| `zikaron dashboard` | ✓ `dashboard` | OK |

*Note: The docs show a minimal CLI subset. The full CLI has many more commands (stats, clear, context, serve, migrate, git-overlay, group-operations, topic-chains, plan-linking, export-obsidian, analyze-style, list-chats, analyze-evolution, analyze-semantic, brain-export, etc.).*

---

## 5. pyproject.toml (Python version + deps)

**OK** — Python version and key dependencies match:

| Item | Docs | pyproject.toml | Status |
|------|------|----------------|--------|
| Python | 3.11+ | `requires-python = ">=3.11"` | OK |
| sentence-transformers | ✓ | `sentence-transformers>=2.2.0` | OK |
| sqlite-vec | ✓ | `apsw>=3.45.0`, `sqlite-vec>=0.1.0` | OK |
| FastAPI | ✓ | `fastapi>=0.100.0`, `uvicorn>=0.20.0` | OK |
| tree-sitter | ✓ | `tree-sitter>=0.21.0` | OK |
| spaCy | ✓ | `spacy>=3.7,<4.0` | OK |

---

## Additional Finding (Classify table)

**MISMATCH** — `packages/zikaron/src/zikaron/pipeline/classify.py` defines `dir_listing` (LOW, structure only) in addition to `build_log` and `noise`. The docs' Classify table in both zikaron.md and llm.md omits `dir_listing`:

- **Docs say:** `build_log` (LOW), `noise` (SKIP)
- **Code has:** `build_log` (LOW), `dir_listing` (LOW), `noise` (SKIP)

**Recommendation:** Add `dir_listing` to the Classify table in both docs:

```
| `dir_listing` | LOW | Structure only |
```

---

## Summary

| Check | Result |
|-------|--------|
| MCP tools (8) | OK |
| Enrichment fields (10) | OK |
| PII 3-layer sanitization | OK |
| CLI commands (4 listed) | OK |
| Python version + deps | OK |
| Classify table | MISMATCH — missing `dir_listing` |
