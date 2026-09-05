/**
 * TellerGolem Types
 *
 * Type definitions for the TellerGolem - handles finance, subscriptions,
 * payments, and tax categorization.
 */

/** IRS Schedule C expense categories */
export type TaxCategory =
  | "advertising"
  | "insurance"
  | "office"
  | "software"
  | "education"
  | "travel"
  | "meals"
  | "professional-services"
  | "other";

/**
 * Result of LLM categorization for an expense
 * @interface CategorizedExpense
 */
export interface CategorizedExpense {
  /** IRS Schedule C category */
  category: TaxCategory;
  /** Confidence score from 0 to 1 */
  confidence: number;
  /** LLM reasoning for the categorization */
  reasoning: string;
  /** Extracted amount if found in email */
  amount?: number;
  /** Vendor name extracted from email */
  vendor?: string;
}

/**
 * Payment failure detected from an email
 * @interface PaymentFailure
 */
export interface PaymentFailure {
  /** Vendor where payment failed */
  vendor: string;
  /** Amount of failed payment */
  amount?: number;
  /** Failure reason (e.g. "card declined", "expired") */
  reason: string;
  /** What the user needs to do */
  actionNeeded: string;
  /** Source email ID */
  emailId: string;
  /** ISO timestamp of detection */
  detectedAt: string;
}

/**
 * Monthly spending report with aggregated expenses by category and vendor
 * @interface MonthlyReport
 */
export interface MonthlyReport {
  /** Month in YYYY-MM format */
  month: string;
  /** Total spending for the month */
  totalSpend: number;
  /** Spending broken down by tax category */
  byCategory: Record<TaxCategory, number>;
  /** Spending broken down by vendor */
  byVendor: Record<string, number>;
  /** Number of active subscriptions */
  subscriptionCount: number;
}

/**
 * Annual tax report with deductible expenses broken down by IRS Schedule C categories
 * @interface TaxReport
 */
export interface TaxReport {
  /** Tax year */
  year: number;
  /** Total deductible amount */
  totalDeductible: number;
  /** Breakdown by category with individual line items */
  byCategory: Record<
    TaxCategory,
    { total: number; items: Array<{ vendor: string; amount: number }> }
  >;
}

/** Monthly subscription spending summary */
export interface SubscriptionSummary {
  totalMonthly: number;
  services: Array<{
    name: string;
    amount: number;
    currency: string;
    status: string;
  }>;
  newThisMonth: string[];
  cancelledThisMonth: string[];
}

/**
 * Inbound email from email-golem router.
 * Minimal interface — avoids importing email-golem types directly.
 */
export interface InboundEmail {
  email: {
    id: string;
    from: string;
    subject: string;
    snippet: string;
    internalDate?: number;
  };
  score: number;
  category: string;
}

/**
 * Scored email input from email-golem scorer
 * @interface ScoredEmail
 */
export interface ScoredEmail {
  /** Unique email ID */
  id: string;
  /** Sender address */
  from: string;
  /** Email subject line */
  subject: string;
  /** Email body snippet */
  snippet: string;
  /** Email category from scorer */
  category: string;
  /** Relevance score 1-10 */
  score: number;
  /** ISO timestamp when received */
  receivedAt: string;
}
