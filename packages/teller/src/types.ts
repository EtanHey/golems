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
