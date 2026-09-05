import { sendNotification } from "@golems/shared/lib/telegram-direct";
import { logEvent } from "@golems/shared/lib/event-log";
import { runLLMJSON } from "@golems/shared/lib/llm";
import { extractVendor } from "./categorizer";
import type { PaymentFailure, ScoredEmail } from "./types";

/** Regex patterns that indicate payment failures */
const FAILURE_PATTERNS = [
  /payment\s+(failed|declined|unsuccessful)/i,
  /card\s+(declined|expired|rejected)/i,
  /billing\s+(issue|problem|error)/i,
  /unable\s+to\s+(charge|process|complete)/i,
  /action\s+required.*payment/i,
  /update.*payment\s+method/i,
];

/**
 * Detect if an email indicates a payment failure using regex pre-check and LLM confirmation.
 * Returns a PaymentFailure object if confirmed, null otherwise.
 *
 * @param email - The scored email to check for payment failure indicators
 * @returns Promise resolving to PaymentFailure object if detected, null otherwise
 */
export async function detectPaymentFailure(
  email: ScoredEmail
): Promise<PaymentFailure | null> {
  // Quick regex pre-check
  const text = `${email.subject} ${email.snippet}`;
  const regexMatch = FAILURE_PATTERNS.some((p) => p.test(text));

  if (!regexMatch) return null;

  // LLM confirmation + detail extraction
  const result = await runLLMJSON<{
    isFailure: boolean;
    vendor: string;
    amount: number | null;
    reason: string;
    actionNeeded: string;
  }>(
    `Analyze this email for payment failure details.

From: ${email.from}
Subject: ${email.subject}
Content: ${email.snippet}

Is this a genuine payment failure (not a marketing email about upgrading)?
Respond JSON: {"isFailure": true/false, "vendor": "...", "amount": null_or_number, "reason": "...", "actionNeeded": "..."}`,
    "teller-alerts"
  );

  if (!result?.isFailure) return null;

  return {
    vendor: result.vendor || extractVendor(email.from),
    amount: result.amount ?? undefined,
    reason: result.reason || "Payment failed",
    actionNeeded: result.actionNeeded || "Update payment method",
    emailId: email.id,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Send a Telegram alert for a payment failure and log the event for operational visibility.
 *
 * @param failure - The payment failure to alert about
 * @returns Promise that resolves when alert and logging are complete
 */
export async function sendPaymentAlert(
  failure: PaymentFailure
): Promise<void> {
  const amountStr = failure.amount ? ` ($${failure.amount})` : "";

  await Promise.allSettled([
    sendNotification({
      title: `Payment Failed: ${failure.vendor}`,
      body: `${failure.reason}${amountStr}. ${failure.actionNeeded}`,
      source: "email",
      priority: "high",
    }),
    logEvent("email_alert", {
      vendor: failure.vendor,
      reason: failure.reason,
      emailId: failure.emailId,
    }, "tellergolem"),
  ]);
}

