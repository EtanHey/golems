# Dead Code & Duplicate Code Audit

*Generated: 2026-02-08 — by Cursor (GPT-5.2-codex-high) + Claude Opus audit*

---

## Duplicate Code

### 1. Ollama JSON Extraction (HIGH)

**Files:** `ollama-wrapper.ts:53-74` and `ollama-helper.ts:31-46`

Both implement `runOllamaJSON<T>()` with identical regex JSON parse + error handling. The wrapper version adds a `source` parameter and haiku backend support.

**Recommendation:** Delete `ollama-helper.ts` version, use `ollama-wrapper.ts` everywhere.

### 2. Embedding Helpers (HIGH)

**Files:** `ollama-helper.ts:53-103` and `ollama-sandboxed.ts:321-370`

Both implement `getEmbedding()` + `batchEmbed()` with identical Ollama `/api/embeddings` calls (same model, same 2000-char limit, same error handling, same 100ms batch delay).

**Recommendation:** Extract shared embedding module, or delete one copy.

### 3. Cursor CLI Wrapper (MEDIUM)

**Files:** `cursor-helper.ts:52-234` and `lib/agent-runner.ts:65-207`

Both implement `sanitizeFilename()` (identical logic) and `runCursorResearch()` (same pattern, slightly different options). `agent-runner.ts` is the newer replacement.

**Recommendation:** Delete `cursor-helper.ts` entirely (see Dead Code below).

### 4. Telegram Notification Routing (MEDIUM)

**Files:** `telegram-bot.ts:2226-2324` and `lib/telegram-direct.ts:27-53, 187-239`

Both maintain source→topic routing maps and markdown fallback logic. `telegram-bot.ts` uses the Grammy bot API; `telegram-direct.ts` uses raw HTTP (for cloud/headless use).

**Recommendation:** Extract shared routing config (SOURCE_CONFIG map) into `lib/shared-types.ts` or a new `lib/telegram-config.ts`. Both senders import from there.

### 5. Example TypeScript Skill (LOW)

**Files:** `skills/golem-powers/example-typescript/src/index.ts` and `packages/ralph/skills/golem-powers/example-typescript/src/index.ts`

Identical content. One is the canonical source, the other a copy.

**Recommendation:** Determine which is canonical (likely `skills/` root), remove the duplicate.

---

## Dead Code

### Confirmed Dead (safe to delete)

| File | Lines | Reason |
|------|-------|--------|
| `src/gemini-helper.ts` | 320 | No imports found anywhere; replaced by `lib/agent-runner.ts` |
| `src/cursor-helper.ts` | 472 | No imports found; replaced by `lib/agent-runner.ts` |
| `src/ollama-chat-bot.ts` | 388 | Only used by `scripts/start-ollama-chat.sh` which was disabled (plist deleted); 401 token error |

### Not Dead (false positives from stats)

| File | Lines | Reason |
|------|-------|--------|
| `src/helpers-status.ts` | 100 | Used by `golems helpers` CLI command |
| `src/thread-compactor.ts` | ~200 | Imported by `run-compaction.ts` + has tests |
| `src/validation-service.ts` | 272 | Run via `bun run validate` script; exports unused externally but it's an entry point |

### Partially Dead

| File | Lines | Issue |
|------|-------|-------|
| `src/ollama-helper.ts` | 103 | `runOllamaJSON` duplicated from wrapper; `getEmbedding`/`batchEmbed` duplicated from sandboxed. Check if anything imports this. |
| `src/ollama-sandboxed.ts` | 370 | Large file; embedding functions duplicated. The sandboxed pattern may be stale (see config drift). |

---

## Dead Dependencies

| Package | In `package.json` | Issue |
|---------|-------------------|-------|
| `chromadb` | `packages/autonomous` | Never imported via JS SDK. `thread-compactor.ts` talks to ChromaDB via raw HTTP. Can be removed from `package.json`. |
| `ollama` | `packages/autonomous` | Check if imported anywhere — `ollama-wrapper.ts` uses raw `fetch` to Ollama HTTP API, not this SDK. |

---

## Summary

| Category | Count | Estimated Dead Lines |
|----------|-------|---------------------|
| Duplicate code patterns | 5 | ~400 (removable after consolidation) |
| Confirmed dead files | 3 | 1,180 |
| Dead dependencies | 2 | N/A (package.json only) |
| **Total removable** | | **~1,580 lines** |
