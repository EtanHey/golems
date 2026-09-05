---
name: subscriptions
description: View and manage tracked subscriptions — active services, costs, and payment history.
---

# Subscription Manager

View and manage tracked subscriptions.

## Process

1. Query Supabase `subscriptions` table for all active subscriptions
2. Show each service with: name, amount, currency, frequency, status
3. Calculate total monthly cost (yearly subscriptions ÷ 12)
4. Flag any subscriptions with recent price changes or failed payments
5. Show total: "You're spending $X/month on Y active subscriptions"

## Actions

- **List**: Show all active subscriptions sorted by cost
- **Cancel tracking**: Mark a subscription as cancelled (doesn't actually cancel the service)
- **Add**: Manually track a new subscription not detected from emails
