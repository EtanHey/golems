# Audit: Input Validation — Model B (Gemini 2.5 Pro)

**Scope:** packages/coach/src/schedule/**
**Date:** 2026-03-07

## Findings

### PASS: Date parsing
Validated — uses dayjs strict mode throughout.

### FAIL: Recurrence rule injection
`parseRecurrence()` in `recurrence.ts:87` accepts freeform RRULE strings from user input without sanitizing the UNTIL or COUNT fields. A crafted RRULE like `FREQ=DAILY;COUNT=999999` could generate unbounded calendar entries and exhaust Convex document limits.

**Severity:** HIGH
**Recommendation:** Cap COUNT at 365 and validate UNTIL is within 2 years of current date.

### PASS: Timezone handling
Consistent UTC storage confirmed.

## Verdict: FAIL

One high-severity finding in recurrence rule parsing. Must be addressed before deploy.
