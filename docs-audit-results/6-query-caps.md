# Dashboard Supabase Query Caps Audit

**Source:** `packages/dashboard/src/lib/supabase/queries.ts`

Supabase's PostgREST defaults to a **1000 row cap** when no `.limit()` is specified. Queries that fetch unbounded rows may silently truncate results.

---

| Function | Table | Has .limit()? | Hits 1000 cap? | Client-side agg? | Needs RPC? | Why |
|----------|-------|---------------|-----------------|------------------|------------|-----|
| `fetchRecentEvents` | golem_events | Yes (30) | No | No | No | Simple list, capped |
| `fetchServiceRuns` | service_runs | Conditional | Yes (when `sinceDays` set) | No | No | No limit when filtering by date range |
| `fetchServiceHeartbeats` | service_heartbeats | No | Yes | No | No | Unbounded; typically small table |
| `fetchTokenStats` | llm_usage | No | Yes | Yes | Yes | Loops: byModel, byDay, bySource, totals; GROUP BY + SUM/COUNT in Postgres |
| `fetchGolemState` | golem_state | No | Yes | No | No | Key-value; usually few rows |
| `fetchNightShiftEvents` | golem_events | Yes (50) | No | No | No | Simple list, capped |
| `fetchNotificationEvents` | golem_events | Yes (200) | No | No | No | Paginated list |
| `fetchEnrichmentStats` | enrichment_stats | Yes (1) | No | No | No | Single row via .single() |
| `fetchBacklogItems` | backlog_items | No | Yes | No | No | Unbounded; could grow |
| `createBacklogItem` | backlog_items | N/A | N/A | No | No | Insert, returns 1 row |
| `updateBacklogItem` | backlog_items | N/A | N/A | No | No | Update by id |
| `deleteBacklogItem` | backlog_items | N/A | N/A | No | No | Delete by id |
| `fetchPipelineRuns` | pipeline_runs | Yes (30) | No | No | No | Simple list, capped |
| `fetchPipelineStats` | pipeline_runs | No | Yes | Yes | Yes | Groups by pipeline_id; filter/reduce for success_rate, avg_quality, avg_duration; GROUP BY + AVG/COUNT |
| `fetchJobs` | golem_jobs | Yes (100) | No | No | No | Simple list, capped |
| `fetchJobStats` | golem_jobs | No | Yes | Yes | Yes | byStatus, bySource, avg_score; GROUP BY + COUNT + AVG |
| `fetchScrapeActivity` | scrape_activity | Yes (30) | No | No | No | Simple list, capped |
| `fetchEmails` | emails | Yes (50) | No | No | No | Simple list, capped |
| `fetchEmailStats` | emails | No | Yes | Yes | Yes | byCategory, last24h, urgent; GROUP BY + COUNT + date filter |
| `fetchEmailSenders` | email_senders | Yes (50) | No | No | No | Simple list, capped |
| `fetchOutreachContacts` | outreach_contacts | No | Yes | No | No | Unbounded |
| `fetchOutreachMessages` | outreach_messages | No | Yes | No | No | Unbounded |
| `fetchLinkedInStats` | linkedin_connections | No | Yes | Yes | Yes | byCompany, byStrength, topCompanies; GROUP BY + COUNT + ORDER BY + LIMIT |
| `fetchSubscriptions` | subscriptions | No | Yes | No | No | Unbounded |
| `fetchPayments` | payments | Yes (20) | No | No | No | Simple list, capped |
| `fetchTodayActivity` | golem_events, service_runs | Yes (50, 20) | No | No | No | Both queries capped |

---

## Summary

### Queries at risk of 1000-row cap (no `.limit()`)

- `fetchServiceRuns` (when `sinceDays` is set)
- `fetchServiceHeartbeats`
- `fetchTokenStats`
- `fetchGolemState`
- `fetchBacklogItems`
- `fetchPipelineStats`
- `fetchJobStats`
- `fetchEmailStats`
- `fetchOutreachContacts`
- `fetchOutreachMessages`
- `fetchLinkedInStats`
- `fetchSubscriptions`

### Client-side aggregation (RPC candidates)

| Function | Aggregation | RPC benefit |
|----------|-------------|-------------|
| `fetchTokenStats` | byModel, byDay, bySource, totals | Reduce payload; correct aggregates beyond 1000 rows |
| `fetchPipelineStats` | by pipeline_id: count, success_rate, avg_quality, avg_duration | Same |
| `fetchJobStats` | byStatus, bySource, avg_score | Same |
| `fetchEmailStats` | byCategory, last24h, urgent | Same |
| `fetchLinkedInStats` | byCompany, byStrength, topCompanies | Same |

### Recommended actions

1. **Add `.limit()`** to unbounded list queries where full history isn't needed (e.g. `fetchBacklogItems`, `fetchOutreachContacts`).
2. **Add `.limit()`** to `fetchServiceRuns` when `sinceDays` is set (e.g. cap at 500 or 1000).
3. **Create Postgres RPCs** for `fetchTokenStats`, `fetchPipelineStats`, `fetchJobStats`, `fetchEmailStats`, `fetchLinkedInStats` to push aggregation into the database and avoid both the 1000-row cap and large client payloads.
