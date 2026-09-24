/**
 * EmailGolem Router
 *
 * Determines which golem should handle an email based on category and score.
 * This is the core routing logic for the v2 "golems = domain experts" architecture.
 *
 * Routing rules:
 * - job, interview → RecruiterGolem (job search domain)
 * - subscription → TellerGolem (financial domain)
 * - tech-update → ClaudeGolem (knowledge/learning domain)
 * - urgent → ClaudeGolem (needs human-facing response)
 * - newsletter, promo, social, other → EmailGolem (stays triaged, no routing)
 *
 * After routing, the caller's handler for the target golem processes the email,
 * e.g. { tellergolem: processSubscriptionEmail } from @golems/teller. Handlers
 * are injected because shared is the base layer: domain packages import shared,
 * never the reverse (guarded by __tests__/no-domain-imports.test.ts).
 */

import type { GolemActor } from "../lib/event-log";
import type { ScoredEmail } from "./types";

/** Canonical golem → category mapping. Single source of truth for routing. */
export const GOLEM_CATEGORIES: Record<string, string[]> = {
  recruitergolem: ["job", "interview"],
  tellergolem: ["subscription"],
  claudegolem: ["tech-update", "urgent"],
  emailgolem: ["newsletter", "promo", "social", "other"],
};

/** Reverse lookup: category → golem (derived from GOLEM_CATEGORIES) */
const CATEGORY_TO_GOLEM: Record<string, GolemActor> = {};
for (const [golem, cats] of Object.entries(GOLEM_CATEGORIES)) {
  for (const cat of cats) {
    CATEGORY_TO_GOLEM[cat] = golem as GolemActor;
  }
}

/** Per-golem email processors, supplied by the caller. */
export type EmailHandlers = Partial<
  Record<GolemActor, (email: ScoredEmail) => Promise<void>>
>;

/** Result of email routing to a domain golem */
export interface RoutingResult {
  targetGolem: GolemActor;
  reason: string;
}

/**
 * Determine which golem should handle an email based on its category and score.
 *
 * @param category - Email category from scorer
 * @param _score - Email importance score (1-10)
 * @returns Routing result with target golem and reason
 */
// TODO: Use score for priority-based routing (e.g., score 10 → fast-track to ClaudeGolem)
export function determineTargetGolem(
  category: string,
  _score: number,
): RoutingResult {
  const targetGolem = CATEGORY_TO_GOLEM[category] ?? "emailgolem";

  if (targetGolem === "emailgolem") {
    return {
      targetGolem,
      reason: `${category} email stays with EmailGolem (no specific golem needed)`,
    };
  }

  return {
    targetGolem,
    reason: `${category} email routed to ${targetGolem}`,
  };
}

/**
 * Route a scored email to the appropriate domain golem and invoke its handler.
 *
 * This function:
 * 1. Determines the target golem based on category
 * 2. Invokes the caller's handler for that golem, if one was given
 * 3. Handles errors gracefully to ensure single-email failures don't block the batch
 *
 * @param email - The scored email to route
 * @param handlers - Per-golem processors (e.g. { tellergolem: processSubscriptionEmail })
 * @returns Routing result and processing status
 */
export async function routeAndProcessEmail(
  email: ScoredEmail,
  handlers: EmailHandlers = {},
): Promise<{ result: RoutingResult; success: boolean; error?: string }> {
  const result = determineTargetGolem(email.category, email.score);

  try {
    const handler = handlers[result.targetGolem];
    if (handler) {
      await handler(email);
    } else if (result.targetGolem !== "emailgolem") {
      // emailgolem stays with the router; any other golem without a handler is logged
      console.warn(
        `[router] ${email.category} email routed to ${result.targetGolem} (no handler given): ${email.email?.subject || ""}`,
      );
    }

    return { result, success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[router] Error processing email: ${errorMsg}`);
    return { result, success: false, error: errorMsg };
  }
}
