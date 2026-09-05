# 5. Zikaron Chunk Count Audit

**Current count:** 260K+  
**Audit date:** 2026-02-17

---

## Summary

| Location | Status | Action |
|----------|--------|--------|
| `content/docs/` | ✅ All 260K+ | No changes needed |
| `public/golems/` | ⚠️ Outdated (226K+, 238K+) | Rebuild after source fix; some files may be stale copies |

---

## content/docs/ (Active — Must Fix)

**All files show 260K+.** No outdated numbers.

| File | Chunk refs | Status |
|------|------------|--------|
| `llm.md` | 260K+ (×10) | ✅ |
| `architecture.md` | 260K+ (×1) | ✅ |
| `getting-started.md` | 260K+ (×1) | ✅ |
| `faq.md` | 260K+ (×1) | ✅ |
| `journey.md` | 260K+ (×1) | ✅ |
| `mcp-tools.md` | 260K+ (×3) | ✅ |
| `packages/zikaron.md` | 260K+ (×3) | ✅ |

---

## public/golems/ (Static Build — Lower Priority)

**Outdated numbers:** 226K+, 238K+

### 1. `public/golems/llm.md` — Raw markdown (stale copy)

| Line | Outdated | Should be |
|------|----------|-----------|
| 32 | 226K+ chunks | 260K+ |
| 1108 | 238K+ chunks, "1-2GB" | 260K+, "1.4GB" |
| 1192 | 238K+ chunk memory layer (missing "10-field enrichment") | 260K+ chunk memory layer with 10-field enrichment |
| 2499 | 238K+ conversation chunks | 260K+ |
| 2882 | 226K+ indexed conversation chunks | 260K+ |
| 3095 | 226K+ indexed conversation chunks | 260K+ |
| 3274 | 226K+ chunks | 260K+ |
| 3678 | 238K+ chunks indexed | 260K+ |
| 3724 | 238K+ chunks | 260K+ |

**Note:** This file appears to be a stale copy of `content/docs/llm.md`. If it's a build artifact, it will be overwritten on next build. If it's manually maintained, update or delete.

### 2. `public/golems/docs/architecture/index.html`

| Location | Outdated |
|----------|----------|
| Table row: `zikaron` | 226K+ chunks → 260K+ |

### 3. `public/golems/docs/mcp-tools/index.html`

| Location | Outdated |
|----------|----------|
| MCP table row | 226K+ indexed conversation chunks → 260K+ |
| Memory Tools section | 226K+ indexed conversation chunks → 260K+ |
| Zikaron tools bullet | 226K+ chunks → 260K+ |

### 4. `public/golems/docs/journey/index.html`

| Location | Outdated |
|----------|----------|
| Monolithic daemon paragraph | 226K+ conversation chunks → 260K+ |

### 5. `public/golems/docs/getting-started/index.html`

| Location | Outdated |
|----------|----------|
| Tools bullet | 226K+ chunk memory layer → 260K+ (add "with 10-field enrichment") |

### 6. `public/golems/docs/faq/index.html`

| Location | Outdated |
|----------|----------|
| Zikaron sqlite-vec paragraph | 226K+ chunks, "1-2GB" → 260K+, "1.4GB" |

### 7. `public/golems/assets/js/*.js` (bundled chunks)

Bundled JS contains embedded content from docs. These will be regenerated when the Docusaurus/Next.js build runs with updated source.

---

## Recommended Actions

1. **content/docs/** — No changes. Already correct.
2. **public/golems/llm.md** — If this is a build output: run the dashboard/docs build to regenerate. If it's a manual copy: update all 226K+/238K+ → 260K+ and align wording with `content/docs/llm.md`.
3. **public/golems/docs/*.html** — Regenerate by running the docs build. These are built from `content/docs/`.
4. **public/golems/assets/js/*.js** — Regenerated automatically on build.

---

## Outdated Number Reference

| Number | Meaning |
|--------|---------|
| 226K+ | Older snapshot (pre-260K) |
| 238K+ | Intermediate snapshot |
| 260K+ | Current (correct) |
