/**
 * TellerGolem Expense Categorizer
 *
 * Uses LLM to categorize subscription/payment emails into
 * IRS Schedule C tax categories.
 */

import { runLLMJSON } from "@golems/shared/lib/llm";
import type { CategorizedExpense, ScoredEmail, TaxCategory } from "./types";

/** Valid IRS Schedule C expense categories */
const VALID_CATEGORIES: TaxCategory[] = [
  "advertising",
  "insurance",
  "office",
  "software",
  "education",
  "travel",
  "meals",
  "professional-services",
  "other",
];

/**
 * Categorize a subscription email into an IRS Schedule C tax category using LLM.
 * Falls back to "other" with confidence 0 if the LLM returns null or an invalid category.
 *
 * @param email - The scored email to categorize
 * @returns Promise resolving to categorized expense with category, confidence, and reasoning
 */
export async function categorizeExpense(
  email: ScoredEmail
): Promise<CategorizedExpense> {
  const prompt = `You are a tax categorization assistant. Categorize this business expense email into an IRS Schedule C category.

Email from: ${email.from}
Subject: ${email.subject}
Snippet: ${email.snippet}

Valid categories: ${VALID_CATEGORIES.join(", ")}

Respond in JSON:
{"category": "...", "confidence": 0.0-1.0, "reasoning": "...", "amount": null_or_number, "vendor": "..."}`;

  const result = await runLLMJSON<CategorizedExpense>(
    prompt,
    "teller-categorizer"
  );

  if (!result || !VALID_CATEGORIES.includes(result.category)) {
    return {
      category: "other",
      confidence: 0,
      reasoning: "Failed to categorize",
      vendor: extractVendor(email.from),
    };
  }

  return {
    ...result,
    vendor: result.vendor || extractVendor(email.from),
  };
}

/**
 * Extract vendor name from an email sender string.
 * Handles formats like "Netflix <billing@netflix.com>", "billing@netflix.com", and "Netflix".
 *
 * @param from - Email sender string to extract vendor name from
 * @returns Extracted vendor name or "Unknown" if parsing fails
 */
export function extractVendor(from: string): string {
  const match = from.match(/^([^<]+)/);
  const name = match ? match[1].trim() : from;
  return name || "Unknown";
}
