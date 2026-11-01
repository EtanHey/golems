#!/usr/bin/env bun
/**
 * TellerGolem - Financial domain expert
 *
 * Processes subscription emails routed from email-golem, categorizes expenses
 * for tax purposes (IRS Schedule C), detects payment failures, and logs
 * categorized expenses.
 *
 * Called from email-golem router when category="subscription"
 */

import "@golems/shared/lib/load-env";
import { logEvent } from "@golems/shared/lib/event-log";
import { categorizeExpense } from "./categorizer";
import { detectPaymentFailure, recordPaymentFailure } from "./alerts";
import type { ScoredEmail, InboundEmail } from "./types";

/**
 * Process a subscription email routed from EmailGolem.
 * Handles payment failure detection, expense categorization, and event logging.
 *
 * @param emailGolemEmail - The scored email from email-golem router
 * @returns Promise that resolves when email processing is complete
 */
export async function processSubscriptionEmail(
  emailGolemEmail: InboundEmail
): Promise<void> {
  // Convert inbound email to teller-golem ScoredEmail format
  const email: ScoredEmail = {
    id: emailGolemEmail.email.id,
    from: emailGolemEmail.email.from,
    subject: emailGolemEmail.email.subject,
    snippet: emailGolemEmail.email.snippet,
    category: emailGolemEmail.category,
    score: emailGolemEmail.score,
    receivedAt: new Date(emailGolemEmail.email.internalDate || Date.now()).toISOString(),
  };

  // 1. Check for payment failures first (high priority)
  const failure = await detectPaymentFailure(email);
  if (failure) {
    await recordPaymentFailure(failure);
    return; // Don't categorize payment failures as expenses
  }

  // 2. Categorize the expense into IRS Schedule C category
  const expense = await categorizeExpense(email);

  // 3. Log event
  await logEvent(
    "email_routed",
    {
      vendor: expense.vendor,
      category: expense.category,
      confidence: expense.confidence,
      amount: expense.amount,
      emailId: emailGolemEmail.email.id,
      subject: emailGolemEmail.email.subject,
    },
    "tellergolem"
  );

  // Log processing result for operational visibility (launchd logs)
  console.warn(
    `[teller-golem] Processed: ${expense.vendor} (${expense.category}${expense.amount ? ` - $${expense.amount.toFixed(2)}` : ""})`
  );
}

/** Standard status interface for dashboard */
export async function getStatus(): Promise<import("@golems/shared/lib/shared-types").GolemStatus> {
  return {
    name: "TellerGolem",
    healthy: true,
    lastRun: null,
    summary: "Financial domain expert",
  };
}
