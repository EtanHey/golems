/**
 * Email Draft Reply Tests (TDD)
 *
 * Tests the reply drafting logic for emails.
 */

import { describe, it, expect } from "bun:test";
import { buildReplyDraft, type ReplyDraftInput, type ReplyDraft } from "@golems/shared/email/draft-reply";

describe("Email Draft Reply", () => {
  describe("buildReplyDraft", () => {
    it("generates a draft with correct structure", () => {
      const input: ReplyDraftInput = {
        originalSubject: "Interview Scheduled: Senior SWE",
        originalFrom: "recruiter@company.com",
        originalSnippet: "We'd like to schedule a call...",
        category: "interview",
        intent: "accept",
      };

      const draft = buildReplyDraft(input);
      expect(draft.subject).toContain("Re:");
      expect(draft.to).toBe("recruiter@company.com");
      expect(draft.body).toBeDefined();
      expect(draft.body.length).toBeGreaterThan(0);
      expect(draft.intent).toBe("accept");
      expect(draft.status).toBe("draft");
    });

    it("prefixes subject with Re: if not already present", () => {
      const input: ReplyDraftInput = {
        originalSubject: "Job Opening",
        originalFrom: "hr@example.com",
        originalSnippet: "We have a position...",
        category: "job",
        intent: "interested",
      };

      const draft = buildReplyDraft(input);
      expect(draft.subject).toBe("Re: Job Opening");
    });

    it("does not double-prefix Re:", () => {
      const input: ReplyDraftInput = {
        originalSubject: "Re: Job Opening",
        originalFrom: "hr@example.com",
        originalSnippet: "Following up...",
        category: "job",
        intent: "followup",
      };

      const draft = buildReplyDraft(input);
      expect(draft.subject).toBe("Re: Job Opening");
      expect(draft.subject).not.toBe("Re: Re: Job Opening");
    });

    it("includes original context in body for interview replies", () => {
      const input: ReplyDraftInput = {
        originalSubject: "Technical Interview - Round 2",
        originalFrom: "talent@bigco.com",
        originalSnippet: "Please confirm your availability for next week",
        category: "interview",
        intent: "accept",
      };

      const draft = buildReplyDraft(input);
      // Body should reference the interview context
      expect(draft.body.toLowerCase()).toContain("interview");
    });

    it("generates decline draft for decline intent", () => {
      const input: ReplyDraftInput = {
        originalSubject: "Opportunity at StartupX",
        originalFrom: "recruiter@startupx.com",
        originalSnippet: "We think you'd be a great fit...",
        category: "job",
        intent: "decline",
      };

      const draft = buildReplyDraft(input);
      expect(draft.intent).toBe("decline");
      expect(draft.body.length).toBeGreaterThan(0);
    });

    it("creates timestamp on draft", () => {
      const input: ReplyDraftInput = {
        originalSubject: "Test",
        originalFrom: "test@test.com",
        originalSnippet: "Test",
        category: "other",
        intent: "acknowledge",
      };

      const draft = buildReplyDraft(input);
      expect(draft.createdAt).toBeDefined();
      // Should be a valid ISO date
      expect(new Date(draft.createdAt).toISOString()).toBe(draft.createdAt);
    });
    it("prepends customNote to the body when provided", () => {
      const input: ReplyDraftInput = {
        originalSubject: "Follow-up",
        originalFrom: "sender@example.com",
        originalSnippet: "Let's reconnect",
        category: "other",
        intent: "acknowledge",
        customNote: "Thanks for reaching out!",
      };

      const draft = buildReplyDraft(input);
      expect(draft.body).toStartWith("Thanks for reaching out!");
    });
  });
});
