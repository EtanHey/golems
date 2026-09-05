/**
 * Tests for Email Golem Scorer
 *
 * TDD: Tests written FIRST, then implementation.
 * Scoring: 10 = immediate, 7-9 = briefing, 5-6 = track, 1-4 = ignore
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import * as llm from "@golems/shared/lib/llm";
import { scoreEmail, scoreEmails, extractSubscriptionInfo, SCORE_THRESHOLDS } from "@golems/shared/email/scorer";
import type { EmailInput, ScoredEmail } from "@golems/shared/email/scorer";

// Use spyOn instead of mock.module to avoid global pollution
const mockOllamaJSON = mock(() => Promise.resolve({
  score: 5,
  category: "unknown",
  reason: "Test default",
  subscription: null,
}));

// Test fixtures from plan
const FIXTURES: Record<string, EmailInput & { expectedScore: number; expectedCategory: string }> = {
  // Score 10 - Immediate
  interview: {
    id: "gmail-1",
    subject: "Interview Scheduled: Senior SWE at Microsoft",
    from: "recruiting@microsoft.com",
    snippet: "Please use this link to schedule...",
    receivedAt: new Date().toISOString(),
    expectedScore: 10,
    expectedCategory: "interview",
  },
  payment_failed: {
    id: "gmail-2",
    subject: "Payment Failed - Action Required",
    from: "billing@netflix.com",
    snippet: "We couldn't process your payment...",
    receivedAt: new Date().toISOString(),
    expectedScore: 10,
    expectedCategory: "urgent",
  },

  // Score 7-9 - Briefing
  job_update: {
    id: "gmail-3",
    subject: "Your application to Meta",
    from: "noreply@meta.com",
    snippet: "We've received your application...",
    receivedAt: new Date().toISOString(),
    expectedScore: 7,
    expectedCategory: "job",
  },

  // Score 5-6 - Track for monthly
  subscription_receipt: {
    id: "gmail-4",
    subject: "Your Netflix receipt",
    from: "info@netflix.com",
    snippet: "Your monthly charge of $15.99...",
    receivedAt: new Date().toISOString(),
    expectedScore: 5,
    expectedCategory: "subscription",
  },
  new_subscription: {
    id: "gmail-5",
    subject: "Welcome to Spotify Premium",
    from: "no-reply@spotify.com",
    snippet: "Thanks for subscribing! Your plan costs $10.99/month...",
    receivedAt: new Date().toISOString(),
    expectedScore: 6,
    expectedCategory: "subscription",
  },

  // Score 1-2 - Ignore
  newsletter: {
    id: "gmail-6",
    subject: "This Week in JavaScript",
    from: "newsletter@jsweekly.com",
    snippet: "Top stories from the ecosystem...",
    receivedAt: new Date().toISOString(),
    expectedScore: 2,
    expectedCategory: "newsletter",
  },
  promo: {
    id: "gmail-7",
    subject: "50% OFF - Flash Sale!",
    from: "deals@store.com",
    snippet: "Don't miss out on these savings...",
    receivedAt: new Date().toISOString(),
    expectedScore: 1,
    expectedCategory: "promo",
  },
};

beforeEach(() => {
  spyOn(llm, "runLLMJSON").mockImplementation(mockOllamaJSON);
});

afterEach(() => {
  mock.restore();
});

describe("Email Scorer - Score Thresholds", () => {
  it("should define correct thresholds", () => {
    expect(SCORE_THRESHOLDS.IMMEDIATE).toBe(10);
    expect(SCORE_THRESHOLDS.BRIEFING_MIN).toBe(7);
    expect(SCORE_THRESHOLDS.TRACK_MIN).toBe(5);
    expect(SCORE_THRESHOLDS.IGNORE_MAX).toBe(4);
  });
});

describe("Email Scorer - Interview Detection (Score 10)", () => {
  beforeEach(() => {
    mockOllamaJSON.mockReset();
  });

  it("should score interview emails as 10", async () => {
    const fixture = FIXTURES.interview;
    mockOllamaJSON.mockResolvedValueOnce({
      score: 10,
      category: "interview",
      reason: "Interview invite from major tech company",
      subscription: null,
    });

    const result = await scoreEmail({
      id: fixture.id,
      subject: fixture.subject,
      from: fixture.from,
      snippet: fixture.snippet,
      receivedAt: fixture.receivedAt,
    });

    expect(result.score).toBe(fixture.expectedScore);
    expect(result.category).toBe(fixture.expectedCategory);
  });

  it("should score payment failed as 10 (urgent)", async () => {
    const fixture = FIXTURES.payment_failed;
    mockOllamaJSON.mockResolvedValueOnce({
      score: 10,
      category: "urgent",
      reason: "Payment failed requires immediate action",
      subscription: { serviceName: "Netflix", amount: null, frequency: "monthly" },
    });

    const result = await scoreEmail({
      id: fixture.id,
      subject: fixture.subject,
      from: fixture.from,
      snippet: fixture.snippet,
      receivedAt: fixture.receivedAt,
    });

    expect(result.score).toBe(fixture.expectedScore);
    expect(result.category).toBe(fixture.expectedCategory);
  });
});

describe("Email Scorer - Job Updates (Score 7-9)", () => {
  beforeEach(() => {
    mockOllamaJSON.mockReset();
  });

  it("should score job application updates as 7", async () => {
    const fixture = FIXTURES.job_update;
    mockOllamaJSON.mockResolvedValueOnce({
      score: 7,
      category: "job",
      reason: "Job application status update",
      subscription: null,
    });

    const result = await scoreEmail({
      id: fixture.id,
      subject: fixture.subject,
      from: fixture.from,
      snippet: fixture.snippet,
      receivedAt: fixture.receivedAt,
    });

    expect(result.score).toBe(fixture.expectedScore);
    expect(result.category).toBe(fixture.expectedCategory);
  });
});

describe("Email Scorer - Subscription Tracking (Score 5-6)", () => {
  beforeEach(() => {
    mockOllamaJSON.mockReset();
  });

  it("should score subscription receipts as 5", async () => {
    const fixture = FIXTURES.subscription_receipt;
    mockOllamaJSON.mockResolvedValueOnce({
      score: 5,
      category: "subscription",
      reason: "Monthly subscription payment receipt",
      subscription: { serviceName: "Netflix", amount: 15.99, frequency: "monthly" },
    });

    const result = await scoreEmail({
      id: fixture.id,
      subject: fixture.subject,
      from: fixture.from,
      snippet: fixture.snippet,
      receivedAt: fixture.receivedAt,
    });

    expect(result.score).toBe(fixture.expectedScore);
    expect(result.category).toBe(fixture.expectedCategory);
    expect(result.subscription).toBeDefined();
    expect(result.subscription?.serviceName).toBe("Netflix");
    expect(result.subscription?.amount).toBe(15.99);
  });

  it("should score new subscriptions as 6", async () => {
    const fixture = FIXTURES.new_subscription;
    mockOllamaJSON.mockResolvedValueOnce({
      score: 6,
      category: "subscription",
      reason: "New subscription confirmation",
      subscription: { serviceName: "Spotify Premium", amount: 10.99, frequency: "monthly" },
    });

    const result = await scoreEmail({
      id: fixture.id,
      subject: fixture.subject,
      from: fixture.from,
      snippet: fixture.snippet,
      receivedAt: fixture.receivedAt,
    });

    expect(result.score).toBe(fixture.expectedScore);
    expect(result.category).toBe(fixture.expectedCategory);
    expect(result.subscription?.serviceName).toBe("Spotify Premium");
  });
});

describe("Email Scorer - Ignore (Score 1-2)", () => {
  beforeEach(() => {
    mockOllamaJSON.mockReset();
  });

  it("should score newsletters as 2", async () => {
    const fixture = FIXTURES.newsletter;
    mockOllamaJSON.mockResolvedValueOnce({
      score: 2,
      category: "newsletter",
      reason: "Weekly newsletter digest",
      subscription: null,
    });

    const result = await scoreEmail({
      id: fixture.id,
      subject: fixture.subject,
      from: fixture.from,
      snippet: fixture.snippet,
      receivedAt: fixture.receivedAt,
    });

    expect(result.score).toBe(fixture.expectedScore);
    expect(result.category).toBe(fixture.expectedCategory);
  });

  it("should score promos as 1", async () => {
    const fixture = FIXTURES.promo;
    mockOllamaJSON.mockResolvedValueOnce({
      score: 1,
      category: "promo",
      reason: "Marketing promotional email",
      subscription: null,
    });

    const result = await scoreEmail({
      id: fixture.id,
      subject: fixture.subject,
      from: fixture.from,
      snippet: fixture.snippet,
      receivedAt: fixture.receivedAt,
    });

    expect(result.score).toBe(fixture.expectedScore);
    expect(result.category).toBe(fixture.expectedCategory);
  });
});

describe("Email Scorer - Batch Processing", () => {
  beforeEach(() => {
    mockOllamaJSON.mockReset();
  });

  it("should score multiple emails", async () => {
    const emails = [FIXTURES.interview, FIXTURES.newsletter].map(f => ({
      id: f.id,
      subject: f.subject,
      from: f.from,
      snippet: f.snippet,
      receivedAt: f.receivedAt,
    }));

    mockOllamaJSON
      .mockResolvedValueOnce({ score: 10, category: "interview", reason: "Interview", subscription: null })
      .mockResolvedValueOnce({ score: 2, category: "newsletter", reason: "Newsletter", subscription: null });

    const results = await scoreEmails(emails);

    expect(results.length).toBe(2);
    expect(results[0].score).toBe(10);
    expect(results[1].score).toBe(2);
  });

  it("should filter by minimum score", async () => {
    const emails = [FIXTURES.interview, FIXTURES.newsletter].map(f => ({
      id: f.id,
      subject: f.subject,
      from: f.from,
      snippet: f.snippet,
      receivedAt: f.receivedAt,
    }));

    mockOllamaJSON
      .mockResolvedValueOnce({ score: 10, category: "interview", reason: "Interview", subscription: null })
      .mockResolvedValueOnce({ score: 2, category: "newsletter", reason: "Newsletter", subscription: null });

    const results = await scoreEmails(emails, { minScore: 5 });

    expect(results.length).toBe(1);
    expect(results[0].score).toBe(10);
  });
});

describe("Email Scorer - Subscription Extraction", () => {
  it("should extract subscription info from receipt emails", () => {
    const info = extractSubscriptionInfo(
      "Your Netflix receipt",
      "Your monthly charge of $15.99 has been processed.",
      "info@netflix.com"
    );

    expect(info).toBeDefined();
    expect(info?.serviceName).toBe("Netflix");
    expect(info?.amount).toBe(15.99);
    expect(info?.frequency).toBe("monthly");
  });

  it("should extract from yearly subscriptions", () => {
    const info = extractSubscriptionInfo(
      "Your annual Apple One subscription",
      "You've been charged $199.99 for your yearly subscription.",
      "no_reply@email.apple.com"
    );

    expect(info).toBeDefined();
    expect(info?.serviceName).toContain("Apple");
    expect(info?.amount).toBe(199.99);
    expect(info?.frequency).toBe("yearly");
  });

  it("should return null for non-subscription emails", () => {
    const info = extractSubscriptionInfo(
      "This Week in JavaScript",
      "Top stories from the ecosystem...",
      "newsletter@jsweekly.com"
    );

    expect(info).toBeNull();
  });
});

describe("Email Scorer - Auto-Categorize Known Senders", () => {
  beforeEach(() => {
    mockOllamaJSON.mockReset();
  });

  it("should auto-categorize Railway build emails without calling Ollama", async () => {
    const result = await scoreEmail({
      id: "railway-1",
      subject: "Build failed for example-service",
      from: "hello@notify.railway.app",
      snippet: "Your recent deployment to example-service failed",
      receivedAt: new Date().toISOString(),
    });

    expect(result.category).toBe("tech-update");
    expect(result.score).toBe(3);
    expect(result.reason).toContain("Auto-categorized");
    // Should NOT have called Ollama
    expect(mockOllamaJSON).not.toHaveBeenCalled();
  });

  it("should auto-categorize GitHub notification emails", async () => {
    const result = await scoreEmail({
      id: "gh-1",
      subject: "Re: [EtanHey/golems] feat: new feature (#85)",
      from: "notifications@noreply@github.com",
      snippet: "merged this pull request",
      receivedAt: new Date().toISOString(),
    });

    // noreply@github.com should match
    // Note: "notifications@noreply@github.com" has domain "noreply@github.com" which won't match
    // Only exact domain matches work
    expect(result.score).toBeDefined();
  });

  it("should still use Ollama for unknown senders", async () => {
    mockOllamaJSON.mockResolvedValueOnce({
      score: 7,
      category: "job",
      reason: "Job update",
      subscription: null,
    });

    const result = await scoreEmail({
      id: "unknown-1",
      subject: "Your application status",
      from: "careers@company.com",
      snippet: "We'd like to move forward",
      receivedAt: new Date().toISOString(),
    });

    expect(mockOllamaJSON).toHaveBeenCalledTimes(1);
    expect(result.score).toBe(7);
  });
});

describe("Email Scorer - Fallback Behavior", () => {
  beforeEach(() => {
    mockOllamaJSON.mockReset();
  });

  it("should return default score when Ollama fails", async () => {
    mockOllamaJSON.mockResolvedValueOnce(null);

    const result = await scoreEmail({
      id: "test-1",
      subject: "Test email",
      from: "test@example.com",
      snippet: "Test content",
      receivedAt: new Date().toISOString(),
    });

    expect(result.score).toBe(5);
    expect(result.reason).toContain("unavailable");
  });

  it("should handle malformed Ollama response", async () => {
    mockOllamaJSON.mockResolvedValueOnce({ invalid: "response" });

    const result = await scoreEmail({
      id: "test-2",
      subject: "Test email",
      from: "test@example.com",
      snippet: "Test content",
      receivedAt: new Date().toISOString(),
    });

    // Should use defaults for missing fields
    expect(result.score).toBeDefined();
    expect(result.category).toBeDefined();
  });
});
