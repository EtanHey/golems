# Client-Side Aggregation Audit

**Scope:** `packages/dashboard/src/app/(dashboard)/` — tokens, emails, notifications, ops, jobs pages  
**Date:** 2025-02-17

---

## Summary

Patterns where raw rows are fetched then aggregated/filtered/sorted in JavaScript instead of SQL. Each finding includes file, line, description, suggested SQL, and row estimates.

---

## 1. Raw Rows → Aggregation in JavaScript

### 1.1 Tokens — `queries.ts` (not page, but feeds tokens page)

**File:** `packages/dashboard/src/lib/supabase/queries.ts`  
**Lines:** 53–130 (`fetchTokenStats`)

**What it does:** Fetches all `llm_usage` rows for the period, then aggregates in a `for` loop into `by_model`, `by_day`, `by_source`, and totals.

**Suggested SQL:** Use `GROUP BY` in Supabase/RPC or raw SQL:

```sql
-- By model
SELECT model, COUNT(*) AS calls, SUM(input_tokens), SUM(output_tokens), SUM(cost_usd)
FROM llm_usage WHERE created_at >= $since GROUP BY model;

-- By day
SELECT DATE(created_at) AS day, COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost_usd)
FROM llm_usage WHERE created_at >= $since GROUP BY DATE(created_at);

-- By source
SELECT source, COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost_usd)
FROM llm_usage WHERE created_at >= $since GROUP BY source;
```

**Rows:** Fetches all rows in period (potentially thousands); needs only ~10–50 grouped rows per query.

---

### 1.2 Emails — `queries.ts` (`fetchEmailStats`)

**File:** `packages/dashboard/src/lib/supabase/queries.ts`  
**Lines:** 394–415

**What it does:** Fetches all email rows (no limit) and counts by category, last 24h, and urgent in a loop.

**Suggested SQL:**

```sql
-- by_category: COALESCE(human_category, category, 'unknown')
SELECT COALESCE(human_category, category, 'unknown') AS cat, COUNT(*) FROM emails GROUP BY 1;

-- last_24h
SELECT COUNT(*) FROM emails WHERE received_at >= NOW() - INTERVAL '24 hours';

-- urgent (score >= 8)
SELECT COUNT(*) FROM emails WHERE COALESCE(human_score, score, 0) >= 8;
```

**Rows:** Fetches all emails (no limit); needs only a few aggregated values.

---

### 1.3 Jobs — `queries.ts` (`fetchJobStats`)

**File:** `packages/dashboard/src/lib/supabase/queries.ts`  
**Lines:** 338–366

**What it does:** Fetches all `golem_jobs` rows (no limit) and aggregates by status, source, and avg score in a loop.

**Suggested SQL:**

```sql
SELECT COALESCE(status, 'new') AS status, COUNT(*) FROM golem_jobs GROUP BY 1;
SELECT source, COUNT(*) FROM golem_jobs GROUP BY source;
SELECT AVG(match_score) FROM golem_jobs WHERE match_score IS NOT NULL;
SELECT COUNT(*) FROM golem_jobs;
```

**Rows:** Fetches all jobs; needs only a handful of grouped rows.

---

### 1.4 Notifications — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/notifications/page.tsx`  
**Lines:** 112–116, 166, 193

**What it does:** Counts `last24h` and `urgentCount` by filtering 2000 events in JS; filter chips recompute counts per severity/type by iterating over all events.

**Suggested SQL:** Add API params or RPC for:

```sql
-- last24h
SELECT COUNT(*) FROM golem_events WHERE type = ANY($types) AND created_at >= NOW() - INTERVAL '24 hours';

-- urgent count (type IN (email_urgent, service_error, alert))
SELECT COUNT(*) FROM golem_events WHERE type IN ('email_urgent','service_error','alert');

-- counts by severity/type for filter chips
SELECT type, COUNT(*) FROM golem_events WHERE type = ANY($types) GROUP BY type;
```

**Rows:** Fetches 2000; needs ~20–50 for display. Filter chip counts could be precomputed in one grouped query.

---

### 1.5 Ops — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/ops/page.tsx`  
**Lines:** 172–174, 188–193

**What it does:** `consolidateServices` groups 100 runs by service and computes avg duration via `reduce`; `actorCounts` built by looping over 50 events.

**Suggested SQL:** For actor counts:

```sql
SELECT actor, COUNT(*) FROM golem_events GROUP BY actor ORDER BY 2 DESC LIMIT 10;
```

For service stats, the consolidation logic (grouping email variants) is app-specific; avg duration could be:

```sql
SELECT service, AVG(duration_ms), COUNT(*) FROM service_runs WHERE started_at >= $since GROUP BY service;
```

**Rows:** Fetches 50 events, 100 runs; actor counts need ~5–10 rows; service stats ~10–15 rows.

---

### 1.6 Tokens — `page.tsx` (display-time sort)

**File:** `packages/dashboard/src/app/(dashboard)/tokens/page.tsx`  
**Lines:** 311, 349–350

**What it does:** Sorts `Object.entries(data.by_source)` and `Object.entries(data.by_model)` by `calls` and `cost_usd` in JS.

**Suggested SQL:** If aggregation moves to SQL, add `ORDER BY`:

```sql
... GROUP BY model ORDER BY SUM(cost_usd) DESC, COUNT(*) DESC;
... GROUP BY source ORDER BY COUNT(*) DESC;
```

**Rows:** Data is already aggregated; only sort order changes. Low impact but trivial to fix if aggregation moves to SQL.

---

## 2. Client-Side Filtering (could be SQL WHERE)

### 2.1 Emails — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/emails/page.tsx`  
**Lines:** 67–75

**What it does:** Fetches 2000 emails, then filters by `categoryFilter` and `searchQuery` (subject/from ILIKE) in JS.

**Suggested SQL:** Pass filters to query:

```sql
SELECT ... FROM emails
WHERE ($category::text IS NULL OR COALESCE(human_category, category, 'unknown') = $category)
  AND ($q::text IS NULL OR subject ILIKE '%'||$q||'%' OR from_address ILIKE '%'||$q||'%')
ORDER BY received_at DESC LIMIT 100;
```

**Rows:** Fetches 2000; with filters, often only 10–100 needed.

---

### 2.2 Jobs — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/jobs/page.tsx`  
**Lines:** 66–75, 77

**What it does:** Fetches 200 jobs, filters by status, source, and search (title/company) in JS; derives `sources` with `[...new Set(jobs.map(...))]`.

**Suggested SQL:**

```sql
SELECT ... FROM golem_jobs
WHERE ($status::text IS NULL OR COALESCE(status, 'new') = $status)
  AND ($source::text IS NULL OR source = $source)
  AND ($q::text IS NULL OR title ILIKE '%'||$q||'%' OR company ILIKE '%'||$q||'%')
ORDER BY created_at DESC LIMIT 100;

-- sources for filter chips
SELECT DISTINCT source FROM golem_jobs;
```

**Rows:** Fetches 200; filtered view often 20–80 rows.

---

### 2.3 Notifications — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/notifications/page.tsx`  
**Lines:** 118–123, 126–130

**What it does:** Fetches 2000 events, filters by severity (via type→config mapping) and type in JS; groups by date in a loop.

**Suggested SQL:** Severity maps to types; could filter in SQL:

```sql
-- severityFilter = 'urgent' → type IN ('email_urgent','service_error','alert')
-- typeFilter → type = $type
SELECT * FROM golem_events
WHERE type = ANY($notification_types)
  AND ($severity_types::text[] IS NULL OR type = ANY($severity_types))
  AND ($type_filter::text IS NULL OR type = $type_filter)
ORDER BY created_at DESC LIMIT 500;
```

**Rows:** Fetches 2000; filtered + grouped often 100–500.

---

### 2.4 Ops — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/ops/page.tsx`  
**Lines:** 177–184, 185–186

**What it does:** Filters 50 events by actor/type in JS; filters 100 runs by `status !== 'success'` and by `env === 'cloud'`.

**Suggested SQL:** Add query params:

```sql
-- events
SELECT * FROM golem_events
WHERE ($actor::text IS NULL OR actor = $actor)
  AND ($type::text IS NULL OR type = $type)
ORDER BY created_at DESC LIMIT 50;

-- error runs
SELECT * FROM service_runs WHERE status != 'success' AND started_at >= $since;
```

**Rows:** Fetches 50 + 100; filtered subsets often 10–30 each.

---

## 3. Client-Side Sorting (could be ORDER BY)

### 3.1 Tokens — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/tokens/page.tsx`  
**Lines:** 311, 349–350

**What it does:** Sorts `by_source` by calls, `by_model` by cost then calls.

**Suggested SQL:** See 1.6 — add `ORDER BY` to aggregation queries.

---

### 3.2 Jobs — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/jobs/page.tsx`  
**Lines:** 66–75

**What it does:** No explicit sort on filtered list; `fetchJobs` already uses `ORDER BY created_at DESC`. Filtering is the main issue.

---

### 3.3 Notifications — `page.tsx`

**File:** `packages/dashboard/src/app/(dashboard)/notifications/page.tsx`  
**Lines:** 126–130

**What it does:** Groups by date (client-side); within each day, order comes from fetch (`ORDER BY created_at DESC`). Grouping could be done in SQL with `DATE(created_at)`.

---

### 3.4 Teller — `page.tsx` (out of focus but notable)

**File:** `packages/dashboard/src/app/(dashboard)/teller/page.tsx`  
**Lines:** 128–132

**What it does:** Sorts `upcoming` (next payment dates) client-side.

**Suggested SQL:** `ORDER BY` on computed next payment in a subquery or RPC.

---

## 4. Queries Layer (Server-Side JS Aggregation)

These live in `queries.ts` but are still client-side relative to the database — they fetch rows and aggregate in Node/browser instead of SQL.

| Function           | Table        | Fetches      | Aggregates                    | Could be SQL |
|-------------------|-------------|--------------|-------------------------------|--------------|
| `fetchTokenStats` | llm_usage    | All in range | by_model, by_day, by_source   | Yes          |
| `fetchEmailStats` | emails      | All (no limit)| by_category, last24h, urgent  | Yes          |
| `fetchJobStats`   | golem_jobs  | All (no limit)| by_status, by_source, avg    | Yes          |
| `fetchPipelineStats` | pipeline_runs | All (no limit) | by pipeline, success_rate, avg_quality | Yes |
| `fetchLinkedInStats` | linkedin_connections | All | by_company, by_strength | Yes |

---

## 5. Priority Matrix

| Page          | Impact | Effort | Rows Fetched vs Needed |
|---------------|--------|--------|-------------------------|
| fetchEmailStats | High   | Low    | All → 3–10 values       |
| fetchJobStats   | High   | Low    | All → ~15 values        |
| fetchTokenStats | High   | Medium | 100s–1000s → ~50 rows   |
| Emails filter   | Medium | Medium | 2000 → 10–100           |
| Jobs filter     | Medium | Medium | 200 → 20–80             |
| Notifications  | Medium | Medium | 2000 → 100–500          |
| Ops events      | Low    | Low    | 50 → 10–30              |
| Tokens sort     | Low    | Low    | Already aggregated      |

---

## 6. Recommendations

1. **Immediate:** Add SQL aggregation to `fetchEmailStats` and `fetchJobStats` (both fetch all rows with no limit).
2. **Short-term:** Move `fetchTokenStats` to SQL `GROUP BY`; add filter params to `fetchEmails` and `fetchJobs`.
3. **Medium-term:** Add severity/type filter params to `fetchNotificationEvents`; consider RPC for complex aggregations.
4. **General:** Prefer `WHERE`, `GROUP BY`, and `ORDER BY` in Supabase queries over fetching full result sets and processing in JS.
