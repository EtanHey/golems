# Financial Report

Generate a financial report.

Arguments: $ARGUMENTS (optional: period — monthly, yearly, tax)

1. **monthly** (default) — This month's spending by category, subscription total, anomalies
2. **yearly** — Year-to-date summary, category trends, subscription cost changes
3. **tax** — Tax-relevant deductions (Schedule C), categorized expenses, totals

Data sources: Supabase payments + subscriptions tables, email receipts.
