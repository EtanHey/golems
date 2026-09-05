# Audit: packages/dashboard/content/docs/packages/shared.md vs packages/shared

**Audit date:** 2026-02-17

---

## 1. Key Modules Table — Does Every Module Exist?

| Module (docs) | Import path | Exists in `packages/shared/src/lib/`? |
|---------------|-------------|--------------------------------------|
| `supabase-factory` | `@golems/shared/lib/supabase-factory` | ✅ Yes |
| `llm` | `@golems/shared/lib/llm` | ✅ Yes |
| `vercel-llm` | `@golems/shared/lib/vercel-llm` | ✅ Yes |
| `glm-llm` | `@golems/shared/lib/glm-llm` | ✅ Yes |
| `mlx-llm` | `@golems/shared/lib/mlx-llm` | ✅ Yes |
| `telegram-direct` | `@golems/shared/lib/telegram-direct` | ✅ Yes |
| `state-store` | `@golems/shared/lib/state-store` | ✅ Yes |
| `event-log` | `@golems/shared/lib/event-log` | ✅ Yes |
| `load-env` | `@golems/shared/lib/load-env` | ✅ Yes |
| `cost-tracker` | `@golems/shared/lib/cost-tracker` | ✅ Yes |
| `config` | `@golems/shared/lib/config` | ✅ Yes |

**Result:** All 11 modules in the Key Modules table exist. None are listed but nonexistent.

---

## 2. .ts Files in lib/ NOT in the Table

These files exist in `packages/shared/src/lib/` but are **not** documented in the Key Modules table:

| File | Purpose (inferred from name) |
|------|------------------------------|
| `session-registry.ts` | Claude session tracking |
| `axiom.ts` | Axiom integration |
| `cloud-llm.ts` | Haiku backend with token/cost tracking |
| `helpers.ts` | CLI helper layer |
| `agent-runner.ts` | Research workflows |
| `ollama-helper.ts` | Local Ollama wrapper |
| `wizard-state.ts` | Wizard/doctor health checks |
| `whatsapp-parser.ts` | WhatsApp parsing |
| `whatsapp-indexer.ts` | WhatsApp indexing |
| `tui.ts` | TUI utilities |
| `teaching.ts` | Teaching utilities |
| `system-detect.ts` | System detection |
| `style-export.ts` | Communication style export |
| `shared-types.ts` | GolemStatus, TopicStyle, GolemActor |
| `self-update.ts` | Self-update logic |
| `quality-sweep.ts` | Quality sweep |
| `plugin-loader.ts` | Plugin loading |
| `ollama-sandboxed.ts` | Sandboxed Ollama |
| `maintainer-golem.ts` | Maintainer golem |
| `i18n.ts` | Internationalization |
| `ascii-mascots.ts` | Golem mascot art |

**Count:** 21 lib modules missing from docs.

---

## 3. Is mlx-llm.ts Listed?

**Yes.** `mlx-llm` is in the Key Modules table (row 5) with import `@golems/shared/lib/mlx-llm` and purpose "Local MLX inference on Apple Silicon (OpenAI-compatible API)".

---

## 4. Email Section — Accurate vs packages/shared/src/email/

| Docs claim | Actual | Match? |
|------------|--------|-------|
| Gmail client | `gmail-client.ts` | ✅ |
| Scorer | `scorer.ts` | ✅ |
| Router | `router.ts` | ✅ |
| Draft replies | `draft-reply.ts` | ✅ |
| Follow-up tracking | `followup.ts` | ✅ |
| MCP server | `mcp-server.ts` | ✅ |
| — | `sender-tracker.ts` | ❌ **Not documented** |
| — | `db-client.ts` | ❌ **Not documented** |

**Email MCP Tools:** Docs say "7 email tools" and list 7 in the table. Actual MCP server exposes **12 tools**:

| Tool (docs) | Tool (actual) | Match? |
|-------------|---------------|-------|
| `email_getRecent` | `email_getRecent` | ✅ |
| `email_search` | `email_search` | ✅ |
| `email_subscriptions` | `email_subscriptions` | ✅ |
| `email_urgent` | `email_urgent` | ✅ |
| `email_stats` | `email_stats` | ✅ |
| `email_getByGolem` | `email_getByGolem` | ✅ |
| `email_draftReply` | `email_draftReply` | ✅ |
| — | `email_getSenders` | ❌ **Missing from docs** |
| — | `email_setSenderAction` | ❌ **Missing from docs** |
| — | `email_unsubscribe` | ❌ **Missing from docs** |
| — | `email_sendersByCategory` | ❌ **Missing from docs** |
| — | `email_unsubscribeHistory` | ❌ **Missing from docs** |

---

## Summary

### Modules missing from docs (lib/)

- `session-registry`, `axiom`, `cloud-llm`, `helpers`, `agent-runner`, `ollama-helper`, `wizard-state`, `whatsapp-parser`, `whatsapp-indexer`, `tui`, `teaching`, `system-detect`, `style-export`, `shared-types`, `self-update`, `quality-sweep`, `plugin-loader`, `ollama-sandboxed`, `maintainer-golem`, `i18n`, `ascii-mascots`

### Modules listed but nonexistent

- **None** — all 11 Key Modules table entries exist.

### Other gaps

- **Email:** `sender-tracker.ts`, `db-client.ts` not documented
- **Email MCP:** 5 tools missing from table (`email_getSenders`, `email_setSenderAction`, `email_unsubscribe`, `email_sendersByCategory`, `email_unsubscribeHistory`)
