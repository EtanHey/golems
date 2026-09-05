/**
 * EmailGolem Router Tests (TDD)
 *
 * Tests the routing logic that determines which golem should handle an email.
 */

import { describe, it, expect } from "bun:test";
import { determineTargetGolem, type RoutingResult } from "@golems/shared/email/router";

describe("EmailGolem Router", () => {
  describe("determineTargetGolem", () => {
    // Job-related emails → RecruiterGolem
    it("routes job category to recruitergolem", () => {
      const result = determineTargetGolem("job", 7);
      expect(result.targetGolem).toBe("recruitergolem");
      expect(result.reason).toBeDefined();
    });

    it("routes interview category to recruitergolem", () => {
      const result = determineTargetGolem("interview", 10);
      expect(result.targetGolem).toBe("recruitergolem");
    });

    // Subscription/payment emails → TellerGolem (financial)
    it("routes subscription category to tellergolem", () => {
      const result = determineTargetGolem("subscription", 5);
      expect(result.targetGolem).toBe("tellergolem");
    });

    // Tech updates → ClaudeGolem (the brain)
    it("routes tech-update to claudegolem", () => {
      const result = determineTargetGolem("tech-update", 9);
      expect(result.targetGolem).toBe("claudegolem");
    });

    // Urgent emails always go to ClaudeGolem regardless of category
    it("routes urgent category to claudegolem", () => {
      const result = determineTargetGolem("urgent", 10);
      expect(result.targetGolem).toBe("claudegolem");
    });

    // Low-score emails → emailgolem (stays with email golem, no routing needed)
    it("keeps low-score newsletters with emailgolem", () => {
      const result = determineTargetGolem("newsletter", 2);
      expect(result.targetGolem).toBe("emailgolem");
    });

    it("keeps low-score promos with emailgolem", () => {
      const result = determineTargetGolem("promo", 1);
      expect(result.targetGolem).toBe("emailgolem");
    });

    // Other/unknown → emailgolem
    it("routes unknown category to emailgolem", () => {
      const result = determineTargetGolem("other", 4);
      expect(result.targetGolem).toBe("emailgolem");
    });

    // Social → emailgolem (no specific golem for social yet)
    it("routes social to emailgolem", () => {
      const result = determineTargetGolem("social", 3);
      expect(result.targetGolem).toBe("emailgolem");
    });

    // Result shape
    it("returns complete routing result shape", () => {
      const result = determineTargetGolem("job", 8);
      expect(result).toHaveProperty("targetGolem");
      expect(result).toHaveProperty("reason");
      expect(typeof result.targetGolem).toBe("string");
      expect(typeof result.reason).toBe("string");
    });
  });
});
