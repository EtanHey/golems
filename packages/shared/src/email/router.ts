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
 * After routing, domain golems are invoked to process their category:
 * - TellerGolem.processSubscriptionEmail() for subscriptions
 * - RecruiterGolem handlers for jobs/interviews (see @golems/recruiter/*)
 * - ClaudeGolem handlers for tech-update/urgent (see CLAUDE.md)
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
 * 2. Invokes the golem's processor if available
 * 3. Handles errors gracefully to ensure single-email failures don't block the batch
 *
 * @param email - The scored email to route
 * @returns Routing result and processing status
 */
export async function routeAndProcessEmail(
  email: ScoredEmail,
): Promise<{ result: RoutingResult; success: boolean; error?: string }> {
  const result = determineTargetGolem(email.category, email.score);

  try {
    // Invoke domain golem handlers based on target
    if (result.targetGolem === "tellergolem") {
      const { processSubscriptionEmail } = await import("@golems/teller/index");
      await processSubscriptionEmail(email);
    } else if (result.targetGolem === "recruitergolem") {
      // RecruiterGolem handler - to be implemented
      // const { processJobEmail } = await import("@golems/recruiter/index");
      // await processJobEmail(email);
      console.warn(
        `[router] Job email routed to RecruiterGolem (handler not implemented): ${email.email?.subject || ""}`,
      );
    } else if (result.targetGolem === "claudegolem") {
      // ClaudeGolem handler - to be implemented
      console.warn(
        `[router] Tech-update/urgent email routed to ClaudeGolem (handler not implemented): ${email.email?.subject || ""}`,
      );
    }
    // emailgolem stays with router (no invocation needed)

    return { result, success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[router] Error processing email: ${errorMsg}`);
    return { result, success: false, error: errorMsg };
  }
}
