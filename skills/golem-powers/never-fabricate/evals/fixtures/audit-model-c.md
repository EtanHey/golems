# Audit: Input Validation — Model C (Claude Opus 4)

**Scope:** packages/coach/src/schedule/**
**Date:** 2026-03-07

## Findings

### PASS: Date parsing
dayjs strict mode used consistently. Good.

### INCONCLUSIVE: Recurrence rules
`parseRecurrence()` accepts raw RRULE strings. I could not determine whether downstream Convex mutations enforce document count limits per user. If they do, this is safe. If they don't, a malicious RRULE could create thousands of entries.

**Recommendation:** Verify Convex-side limits exist OR add client-side RRULE validation.

### PASS: Timezone handling
UTC internally, local at display. Correct.

## Verdict: CONDITIONAL PASS

Green if Convex document limits are confirmed. Needs verification otherwise.
