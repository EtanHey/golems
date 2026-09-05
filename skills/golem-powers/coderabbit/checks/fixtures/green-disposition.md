# Review Disposition Log (GREEN)

Status: COMPLETED

- CRITICAL: SQL injection in the report handler — FIXED (parameterized the query, commit abc123)
- CRITICAL: missing auth check on /internal — WAIVED (endpoint is bound to localhost only; see thread)
- HIGH: N+1 query in the list view — FIXED
- MEDIUM: inconsistent error messages — ACCEPTED (follow-up issue #412)
- LOW: typo in a comment — fixed
