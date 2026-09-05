---
name: report
description: Generate financial spending reports — monthly, yearly, or tax-focused with category breakdowns.
---

# Financial Report

Generate a spending report from Supabase data.

**Arguments**: $ARGUMENTS — period (monthly | yearly | tax)

## Report Types

### monthly (default)
- Total spending this month
- Breakdown by category (housing, transport, food, subscriptions, etc.)
- Active subscription total (monthly equivalent)
- Anomalies: unusual charges, failed payments, price increases

### yearly
- Year-to-date total spending
- Category trends vs. previous months
- Subscription cost changes over time
- Top 10 individual expenses

### tax
- Tax-relevant deductions (US Schedule C)
- Categorized business expenses
- Totals per deduction category
- Flagged items needing manual review

## Data Sources

- Supabase `payments` table — individual transactions
- Supabase `subscriptions` table — recurring services
- Email receipts routed to TellerGolem (subscription category)
