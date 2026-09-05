#!/usr/bin/env bun
/**
 * TellerGolem - Financial domain expert
 *
 * Processes subscription emails routed from email-golem, categorizes expenses
 * for tax purposes (IRS Schedule C), detects payment failures, and generates
 * financial reports.
 *
 * Called from email-golem router when category="subscription"
 * CLI: bun run src/teller-golem/index.ts --report [--month YYYY-MM] [--tax --year YYYY]
 */

import "@golems/shared/lib/load-env";
import { logEvent } from "@golems/shared/lib/event-log";
import { recordPayment, trackSubscription } from "./db";
import { categorizeExpense } from "./categorizer";
import { detectPaymentFailure, sendPaymentAlert } from "./alerts";
import {
  generateMonthlyReport as generateMonthlyReportImpl,
  generateTaxReport as generateTaxReportImpl,
  formatMonthlyReportText,
  formatTaxReportText,
} from "./report";
import type { ScoredEmail, MonthlyReport, TaxReport, InboundEmail } from "./types";

/**
 * Generate a monthly financial report for a given month.
 * Aggregates all payments for the month by category and vendor.
 *
 * @param month - Month in YYYY-MM format (defaults to current month if not provided)
 * @returns Promise resolving to monthly report with spending totals and breakdowns
 */
export async function generateMonthlyReport(
  month?: string
): Promise<MonthlyReport> {
  const reportMonth = month || new Date().toISOString().slice(0, 7);
  return generateMonthlyReportImpl(reportMonth);
}

/**
 * Generate a tax report for a given year.
 * Aggregates all payments for the year into IRS Schedule C categories with line items.
 *
 * @param year - Tax year for report (defaults to current year if not provided)
 * @returns Promise resolving to tax report with deductible totals and vendor itemizations
 */
export async function generateTaxReport(year?: number): Promise<TaxReport> {
  const reportYear = year || new Date().getFullYear();
  return generateTaxReportImpl(reportYear);
}

/**
 * Process a subscription email routed from EmailGolem.
 * Handles payment failure detection, expense categorization, payment recording,
 * subscription tracking, and event logging.
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
    await sendPaymentAlert(failure);
    return; // Don't categorize payment failures as expenses
  }

  // 2. Categorize the expense into IRS Schedule C category
  const expense = await categorizeExpense(email);

  // 3. Record payment if amount detected
  if (expense.amount) {
    const result = await recordPayment({
      subscription_id: null,
      email_id: emailGolemEmail.email.id,
      amount: expense.amount,
      currency: "USD",
      paid_at: new Date(emailGolemEmail.email.internalDate || Date.now()),
    });

    if (!result.success) {
      console.error(
        `[teller-golem] Failed to record payment: ${result.error}`
      );
    }
  }

  // 4. Track subscription
  if (expense.vendor) {
    const result = await trackSubscription({
      service_name: expense.vendor,
      amount: expense.amount || 0,
      currency: "USD",
      frequency: "monthly",
      status: "active",
      first_seen: new Date(emailGolemEmail.email.internalDate || Date.now()),
    });

    if (!result.success) {
      console.error(
        `[teller-golem] Failed to track subscription: ${result.error}`
      );
    }
  }

  // 5. Log event
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

/** Standard status interface for dashboard/Telegram */
export async function getStatus(): Promise<import("@golems/shared/lib/shared-types").GolemStatus> {
  let summary = "Financial domain expert";
  try {
    const report = await generateMonthlyReport();
    summary = `This month: $${report.totalSpend.toFixed(2)} across ${report.subscriptionCount} subscriptions`;
  } catch { /* optional */ }
  return { name: "TellerGolem", healthy: true, lastRun: null, summary };
}

// CLI mode
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--report")) {
    const monthIdx = args.indexOf("--month");
    const yearIdx = args.indexOf("--year");
    const isTax = args.includes("--tax");

    if (isTax) {
      const year = yearIdx >= 0 ? parseInt(args[yearIdx + 1]) : undefined;
      generateTaxReport(year)
        .then((report) => {
          console.log(formatTaxReportText(report));
        })
        .catch((err) => {
          console.error("Failed to generate tax report:", err);
          process.exit(1);
        });
    } else {
      const month = monthIdx >= 0 ? args[monthIdx + 1] : undefined;
      generateMonthlyReport(month)
        .then((report) => {
          console.log(formatMonthlyReportText(report));
        })
        .catch((err) => {
          console.error("Failed to generate monthly report:", err);
          process.exit(1);
        });
    }
  } else {
    console.log("TellerGolem - Financial Domain Expert\n");
    console.log("Usage:");
    console.log(
      "  bun run src/teller-golem/index.ts --report [--month YYYY-MM]"
    );
    console.log(
      "  bun run src/teller-golem/index.ts --report --tax [--year YYYY]"
    );
    console.log("\nExamples:");
    console.log("  bun run src/teller-golem/index.ts --report");
    console.log("  bun run src/teller-golem/index.ts --report --month 2026-02");
    console.log("  bun run src/teller-golem/index.ts --report --tax");
    console.log("  bun run src/teller-golem/index.ts --report --tax --year 2025");
  }
}
