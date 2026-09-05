/**
 * Email Follow-up Tracking Tests (TDD)
 *
 * Tests the follow-up tracking logic for emails.
 */

import { describe, it, expect } from "bun:test";
import {
  createFollowup,
  isOverdue,
  type Followup,
  type FollowupStatus,
} from "@golems/shared/email/followup";

describe("Email Follow-up Tracking", () => {
  describe("createFollowup", () => {
    it("creates a followup with correct structure", () => {
      const followup = createFollowup({
        emailSubject: "Interview at Company X",
        emailFrom: "recruiter@companyx.com",
        category: "interview",
        dueInDays: 3,
      });

      expect(followup.emailSubject).toBe("Interview at Company X");
      expect(followup.emailFrom).toBe("recruiter@companyx.com");
      expect(followup.category).toBe("interview");
      expect(followup.status).toBe("pending");
      expect(followup.createdAt).toBeDefined();
      expect(followup.dueAt).toBeDefined();
    });

    it("sets due date correctly", () => {
      const before = new Date();
      const followup = createFollowup({
        emailSubject: "Test",
        emailFrom: "test@test.com",
        category: "job",
        dueInDays: 7,
      });

      const dueDate = new Date(followup.dueAt);
      const createdDate = new Date(followup.createdAt);
      const diffDays = (dueDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

      // Should be approximately 7 days (allow 1 second tolerance)
      expect(diffDays).toBeGreaterThan(6.99);
      expect(diffDays).toBeLessThan(7.01);
    });

    it("defaults to 3 days for interviews", () => {
      const followup = createFollowup({
        emailSubject: "Interview",
        emailFrom: "hr@test.com",
        category: "interview",
      });

      const dueDate = new Date(followup.dueAt);
      const createdDate = new Date(followup.createdAt);
      const diffDays = (dueDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeGreaterThan(2.99);
      expect(diffDays).toBeLessThan(3.01);
    });

    it("defaults to 5 days for job category", () => {
      const followup = createFollowup({
        emailSubject: "Application Status",
        emailFrom: "jobs@co.com",
        category: "job",
      });

      const dueDate = new Date(followup.dueAt);
      const createdDate = new Date(followup.createdAt);
      const diffDays = (dueDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeGreaterThan(4.99);
      expect(diffDays).toBeLessThan(5.01);
    });

    it("includes optional note", () => {
      const followup = createFollowup({
        emailSubject: "Test",
        emailFrom: "test@test.com",
        category: "other",
        note: "Need to check on this",
      });

      expect(followup.note).toBe("Need to check on this");
    });
  });

  describe("isOverdue", () => {
    it("returns false for future due dates", () => {
      const followup: Followup = {
        id: "test-1",
        emailSubject: "Test",
        emailFrom: "test@test.com",
        category: "job",
        status: "pending",
        createdAt: new Date().toISOString(),
        dueAt: new Date(Date.now() + 86400000).toISOString(), // +1 day
      };

      expect(isOverdue(followup)).toBe(false);
    });

    it("returns true for past due dates", () => {
      const followup: Followup = {
        id: "test-2",
        emailSubject: "Test",
        emailFrom: "test@test.com",
        category: "job",
        status: "pending",
        createdAt: new Date(Date.now() - 172800000).toISOString(), // -2 days
        dueAt: new Date(Date.now() - 86400000).toISOString(), // -1 day
      };

      expect(isOverdue(followup)).toBe(true);
    });

    it("returns false for completed followups regardless of date", () => {
      const followup: Followup = {
        id: "test-3",
        emailSubject: "Test",
        emailFrom: "test@test.com",
        category: "job",
        status: "done",
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        dueAt: new Date(Date.now() - 86400000).toISOString(),
      };

      expect(isOverdue(followup)).toBe(false);
    });

    it("returns false for dismissed followups", () => {
      const followup: Followup = {
        id: "test-4",
        emailSubject: "Test",
        emailFrom: "test@test.com",
        category: "job",
        status: "dismissed",
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        dueAt: new Date(Date.now() - 86400000).toISOString(),
      };

      expect(isOverdue(followup)).toBe(false);
    });
  });
});
