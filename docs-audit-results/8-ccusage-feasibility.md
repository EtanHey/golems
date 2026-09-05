# ccusage Integration Feasibility

> Research: Claude Code usage tracker integration with Golems dashboard `llm_usage` table.

---

## 1. ccusage JSON Output Sample

**Command:** `npx ccusage daily --json --days 3`

```json
{
  "daily": [
    {
      "date": "2026-02-17",
      "inputTokens": 14035,
      "outputTokens": 8058,
      "cacheCreationTokens": 1066714,
      "cacheReadTokens": 36510809,
      "totalTokens": 37599616,
      "totalCost": 23.49639580000002,
      "modelsUsed": ["claude-opus-4-6", "claude-haiku-4-5-20251001"],
      "modelBreakdowns": [
        {
          "modelName": "claude-opus-4-6",
          "inputTokens": 13969,
          "outputTokens": 7935,
          "cacheCreationTokens": 866839,
          "cacheReadTokens": 34772066,
          "cost": 23.071996750000018
        },
        {
          "modelName": "claude-haiku-4-5-20251001",
          "inputTokens": 66,
          "outputTokens": 123,
          "cacheCreationTokens": 199875,
          "cacheReadTokens": 1738743,
          "cost": 0.42439905000000006
        }
      ]
    }
  ],
  "totals": {
    "inputTokens": 582253,
    "outputTokens": 857250,
    "cacheCreationTokens": 109630436,
    "cacheReadTokens": 3317073429,
    "totalCost": 2242.3231805000005,
    "totalTokens": 3428143368
  }
}
```

**Key fields:**
- `daily[].date` — YYYY-MM-DD
- `daily[].modelBreakdowns[]` — per-model granularity
- `modelBreakdowns[].modelName`, `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `cost`

---

## 2. llm_usage Table Columns

From `packages/dashboard/src/lib/supabase/queries.ts` and `packages/shared/src/lib/cost-tracker.ts`:

| Column       | Type        | Used by fetchTokenStats | Inserted by cost-tracker |
|-------------|-------------|--------------------------|---------------------------|
| `model`     | string      | ✓                        | ✓                         |
| `source`    | string      | ✓                        | ✓                         |
| `input_tokens`  | number   | ✓                        | ✓                         |
| `output_tokens` | number   | ✓                        | ✓                         |
| `cost_usd`  | number      | ✓                        | ✓                         |
| `created_at`| timestamptz | ✓                        | ✓ (from entry.timestamp)  |
| `tier`      | string      | —                        | ✓ (paid/free/subscription)|
| `duration_ms` | number   | —                        | ✓ (optional)              |
| `metadata`  | jsonb       | —                        | ✓ (empty object)          |
| `user_id`   | uuid        | —                        | RLS (auth.uid())          |

**LlmRow type (queries.ts):**
```ts
type LlmRow = {
  model: string;
  source: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
};
```

---

## 3. Field Mapping: ccusage → llm_usage

| ccusage field                         | llm_usage column | Notes                                      |
|--------------------------------------|------------------|--------------------------------------------|
| `modelBreakdowns[].modelName`        | `model`          | Direct                                     |
| —                                    | `source`         | **Gap:** Must set e.g. `"claude-code"`    |
| `modelBreakdowns[].inputTokens`      | `input_tokens`   | Direct                                     |
| `modelBreakdowns[].outputTokens`     | `output_tokens`  | Direct                                     |
| `modelBreakdowns[].cost`             | `cost_usd`       | Direct                                     |
| `date` + model row                   | `created_at`     | Use `date` + noon or midnight for daily row|
| —                                    | `tier`           | Use `"subscription"` for CC usage           |

**Gaps in ccusage → llm_usage:**
- No `source` — must be assigned (e.g. `"claude-code"`)
- No `tier` — should be `"subscription"` for CC subscription usage
- No `duration_ms` — ccusage doesn't track per-call duration
- Granularity: ccusage daily is **aggregated by date+model**; llm_usage expects **per-call rows**. We can either:
  - Insert one row per (date, model) as a synthetic "daily aggregate", or
  - Parse JSONL for per-message rows (see §6)

**Gaps in llm_usage → ccusage:**
- `cacheCreationTokens`, `cacheReadTokens` — llm_usage has no columns; dashboard doesn't show cache breakdown
- ccusage has richer cache metrics; llm_usage is input/output/cost only

---

## 4. ~/.claude/projects/ — JSONL Inventory

| Metric        | Value   |
|---------------|---------|
| JSONL files   | **962** |
| Total size    | **752 MB** |
| Project dirs   | ~23 (e.g. `-Users-example-Gits`, `-Users-example-Desktop-Gits-taskowl`) |

**Sample JSONL line (assistant message with usage):**
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-6",
    "usage": {
      "input_tokens": 2,
      "cache_creation_input_tokens": 61906,
      "cache_read_input_tokens": 11562,
      "output_tokens": 10
    }
  },
  "cwd": "$HOME/Gits/golems/packages/content",
  "sessionId": "e25e131f-46c6-4d7e-8234-5970210662db",
  "timestamp": "2026-02-15T17:08:40.223Z"
}
```

---

## 5. ccusage MCP Server

**Package:** `@ccusage/mcp` (separate from main `ccusage` CLI)

**Run:**
```bash
bunx @ccusage/mcp@18.0.11
# or
npx @ccusage/mcp@18.0.11
```

**MCP tools:**
- `blocks` — 5-hour billing block summaries
- `session` — grouped by Claude session ID / project directory
- `monthly` — aggregated usage per month
- `daily` — aggregated usage per day

**Claude Desktop config:**
```json
{
  "mcpServers": {
    "ccusage": {
      "command": "bunx",
      "args": ["@ccusage/mcp@18.0.11"]
    }
  }
}
```

**Not currently in Golems:** No `ccusage` or `@ccusage/mcp` in Cursor/MCP config. Dashboard MCP list (CLAUDE.md) does not include ccusage.

---

## 6. Recommended Approach

| Approach | Pros | Cons |
|---------|------|------|
| **Direct JSONL parsing** | Full control, per-message granularity, no CLI dependency, matches `scripts/cc-usage.ts` pattern | Must maintain pricing logic, handle schema changes, 752MB scan |
| **ccusage CLI** | Maintained, correct pricing, `--json` output | Daily aggregates only; need to map to llm_usage; extra process spawn |
| **ccusage MCP** | Real-time queries, session/monthly views, no file scanning in our code | Same aggregation limits; MCP is for Claude chat, not dashboard ETL |

### Recommendation: **Hybrid — JSONL parsing + optional ccusage CLI**

1. **Primary: Direct JSONL parsing** (like `scripts/cc-usage.ts`)
   - Reuse `scanCCTranscripts()` logic from `scripts/cc-usage.ts`
   - For each `type: "assistant"` line with `message.usage`, emit one `llm_usage` row:
     - `model` ← `message.model`
     - `source` ← `"claude-code"`
     - `input_tokens`, `output_tokens` ← from usage
     - `cost_usd` ← calculate via pricing table (or use ccusage library if available)
     - `created_at` ← `timestamp`
     - `tier` ← `"subscription"`
   - Run as scheduled job (e.g. daily) or on-demand sync
   - **Benefit:** Per-call granularity, matches existing llm_usage row semantics

2. **Optional: ccusage CLI for validation**
   - Run `npx ccusage daily --json --days N` periodically
   - Compare totals with our JSONL-derived sums
   - Use as sanity check, not primary source

3. **Optional: ccusage MCP for Claude chat**
   - Add `@ccusage/mcp` to Cursor MCP config for ad-hoc usage queries in chat
   - Does not replace dashboard ETL

### Schema extension (optional)

If we want cache visibility in the dashboard:

```sql
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS cache_creation_tokens BIGINT;
```

Then map `cache_read_input_tokens` and `cache_creation_input_tokens` from JSONL. `fetchTokenStats` would need to aggregate these for display.

---

## 7. Existing Golems Integration

- **`scripts/cc-usage.ts`** — Already parses `~/.claude/projects/**/*.jsonl`, calculates cost, outputs daily/monthly tables. Merges with Supabase `llm_usage` for API costs. **Reuse this** for CC → llm_usage sync.
- **`packages/shared/src/lib/cost-tracker.ts`** — Dual-writes to JSONL + Supabase for API/helper calls. Pattern for inserting into `llm_usage`.
- **Dashboard** — `fetchTokenStats` aggregates by model, day, source. Adding `source: "claude-code"` would show CC usage alongside API usage.

---

## 8. Summary

| Item | Finding |
|------|---------|
| ccusage JSON | Daily aggregates with `modelBreakdowns`; has cache tokens + cost |
| llm_usage columns | model, source, input_tokens, output_tokens, cost_usd, created_at, tier, duration_ms, metadata |
| Field mapping | Straightforward; need synthetic `source` and `tier` |
| JSONL inventory | 962 files, 752 MB |
| ccusage MCP | Exists as `@ccusage/mcp`; 4 tools (blocks, session, monthly, daily) |
| **Recommended** | Direct JSONL parsing (reuse cc-usage.ts) → llm_usage; ccusage CLI for validation; MCP optional for chat |
