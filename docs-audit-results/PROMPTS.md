# Cursor IDE Audit Prompts

Open Cursor on ~/Gits/golems. Paste each prompt into Composer (Agent mode).
Use @codebase for broad searches, @file for specific files.
Each prompt writes results to docs-audit-results/.

---

## 1. Zikaron docs vs code

```
Write findings to docs-audit-results/1-zikaron.md

Verify @packages/dashboard/content/docs/packages/zikaron.md and the "# Zikaron (Memory)" section in @packages/dashboard/content/docs/llm.md against actual code:

1. @packages/zikaron/src/zikaron/mcp/__init__.py — are all 8 MCP tools listed in the docs? Any missing/renamed?
2. @packages/zikaron/src/zikaron/pipeline/enrichment.py — are the 10 enrichment fields correct? Check the prompt template.
3. @packages/zikaron/src/zikaron/pipeline/sanitize.py — does the PII section accurately describe the 3 layers?
4. @packages/zikaron/src/zikaron/cli/__init__.py — are CLI commands accurate?
5. @packages/zikaron/pyproject.toml — Python version + deps correct?

Format: "MISMATCH: [file] says X but code says Y" or "OK" if accurate.
```

---

## 3. LLM backend references

```
Write findings to docs-audit-results/3-llm-backend.md

Search @codebase in packages/dashboard/content/docs/ for "haiku" or "Haiku".
The cloud worker NOW uses Gemini Flash-Lite (LLM_BACKEND=gemini). Haiku is only a paid fallback.

Flag docs that INCORRECTLY state Haiku is the primary/default cloud backend.
References to Haiku as an available option or historical example are FINE.

Check:
- env var tables showing LLM_BACKEND default value
- retired Railway config examples (service deleted 2026-07-05)
- Sentences saying the cloud worker "uses Haiku"
- GOOGLE_GENERATIVE_AI_API_KEY should be the primary cloud key
```

---

## 4. Shared package modules

```
Write findings to docs-audit-results/4-shared.md

Compare @packages/dashboard/content/docs/packages/shared.md against actual code:
1. Key Modules table — does every module exist in @packages/shared/src/lib/?
2. Are there .ts files in @packages/shared/src/lib/ NOT in the table?
3. Is mlx-llm.ts listed?
4. Email section — accurate vs @packages/shared/src/email/?

List: modules missing from docs, or listed but nonexistent.
```

---

## 5. Chunk count consistency

```
Write findings to docs-audit-results/5-chunk-counts.md

Search @codebase in packages/dashboard/content/docs/ and packages/dashboard/public/golems/ for Zikaron chunk count references.
Current count is 260K+.

Flag ANY file still showing 226K+, 238K+, or any other outdated number.
Note public/golems/ is a static build (lower priority) vs content/docs/ (active, must fix).
```

---

## 6. Dashboard query caps

```
Write findings to docs-audit-results/6-query-caps.md

Read @packages/dashboard/src/lib/supabase/queries.ts

For EVERY exported function, document:
1. Table name queried
2. Whether it has explicit .limit()
3. If no .limit(), will it hit Supabase's default 1000 row cap?
4. Whether it does client-side aggregation (loops, reduces, counts in JS)
5. Could a Postgres RPC function replace it? (GROUP BY, SUM, COUNT)

Format as table:
| Function | Table | Has .limit()? | Client-side agg? | Needs RPC? | Why |
```

---

## 7. Client-side aggregation patterns

```
Write findings to docs-audit-results/7-client-aggregation.md

Search @codebase in packages/dashboard/src/app/(dashboard)/ for patterns where:
1. Raw rows are fetched then aggregated in JavaScript (reduce, forEach, map to count/sum)
2. Data filtered client-side when it could be a SQL WHERE
3. Sorting happens client-side when it could be ORDER BY

For each finding:
- File and line number
- What it does (e.g., "counts emails by category in JS loop")
- What SQL could replace it
- Estimated rows fetched vs rows needed

Focus on: tokens, emails, notifications, ops, jobs pages
```

---

## 8. ccusage feasibility

```
Write findings to docs-audit-results/8-ccusage-feasibility.md

Research ccusage (Claude Code usage tracker) integration:
1. Run: npx ccusage daily --json --days 3
2. Capture the JSON output format
3. Compare against @packages/dashboard/src/lib/supabase/queries.ts — what columns does llm_usage have?
4. Check ~/.claude/projects/ — how many JSONL conversation files exist? Total size?
5. Check if @ccusage/mcp exists as an MCP server option

Document:
- ccusage JSON output sample
- llm_usage table columns
- Field mapping (ccusage field → llm_usage column)
- Gaps in either direction
- Recommended approach: direct JSONL parsing vs ccusage CLI vs ccusage MCP
```

---

## 9. etanheyman.com golems docs — stale audit

```
Write findings to docs-audit-results/9-etanheyman-stale.md

Compare the golems docs in TWO repos to find what's out of sync.

Source of truth: @~/Gits/golems/packages/dashboard/content/docs/
Stale copy: @~/Gits/etanheyman.com/content/golems/

For each .md file that exists in BOTH locations, run a diff. Report:
1. Files that exist in golems but NOT in etanheyman.com (missing)
2. Files that exist in etanheyman.com but NOT in golems (orphaned)
3. Files that differ — summarize what changed (e.g., "chunk count 238K→260K", "missing PII section")

Also check:
- Does etanheyman.com/content/golems/ have the same folder structure as golems/content/docs/?
- Are there any files with different names but same content (renamed)?

Format as table:
| File | Status | What's different |
```

---

## 10. Table of Contents — both repos

```
Write findings to docs-audit-results/10-table-of-contents.md

Compare how Table of Contents is generated in BOTH repos:

### Repo 1: golems dashboard
- @packages/dashboard/src/app/(dashboard)/docs/[...slug]/page.tsx — how are headings extracted?
- Does it use gray-matter + marked + regex for headings?
- What heading levels are included (h2 only? h2+h3?)

### Repo 2: etanheyman.com
- @~/Gits/etanheyman.com/app/(golems)/golems/components/TableOfContents.tsx — how does it work?
- Is it client-side (scroll spy)? Server-side (pre-extracted)?
- What heading levels are included?

### For each repo, document:
1. Where headings are extracted (build-time vs runtime)
2. Heading level depth (h2? h2+h3? h2+h3+h4?)
3. Scroll spy / active tracking (yes/no, how)
4. Mobile behavior (hidden? collapsible?)
5. Dependencies (rehype plugins? custom regex?)

### Key question:
If content is single-sourced, would BOTH TOC implementations work identically on the same markdown? Any heading syntax assumptions that differ?

Format as comparison table:
| Feature | golems dashboard | etanheyman.com |
```

---

## 11. Sidebar & navigation config — both repos

```
Write findings to docs-audit-results/11-sidebar-nav.md

Compare how sidebar navigation and prev/next links are configured in BOTH repos:

### Repo 1: golems dashboard
- @packages/dashboard/src/lib/docs/index.ts — how is nav tree generated?
- Check for `sidebar_position` in frontmatter of @packages/dashboard/content/docs/**/*.md
- Check for `_category_.json` files in @packages/dashboard/content/docs/*/
- Is nav auto-generated from filesystem + frontmatter? Or hardcoded?

### Repo 2: etanheyman.com
- @~/Gits/etanheyman.com/app/(golems)/golems/components/Sidebar.tsx — is `sidebarConfig` hardcoded?
- @~/Gits/etanheyman.com/app/(golems)/golems/docs/[...slug]/page.tsx — is `DOC_ORDER` hardcoded?
- How are prev/next links computed?

### For each repo, document:
1. Nav data source (frontmatter? JSON files? hardcoded arrays?)
2. Section grouping (how are docs grouped into categories?)
3. Sort order (by position number? alphabetical? manual order?)
4. Prev/next links (from nav tree? separate config?)
5. Active page highlighting (URL match? slug match?)
6. Mobile sidebar behavior (hamburger? sheet? bottom nav?)

### Key question:
Can etanheyman.com switch from hardcoded config to reading `sidebar_position` frontmatter + `_category_.json` — the same system golems dashboard uses? What would need to change?

Format as comparison table:
| Feature | golems dashboard | etanheyman.com |
```
