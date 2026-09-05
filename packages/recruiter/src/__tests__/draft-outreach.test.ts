import { describe, test, expect } from "bun:test";
import {
  generateOutreachDraft,
  formatDraftForTelegram,
  type ConnectionInfo,
  type JobInfo,
  type MatchInfo,
} from "../draft-outreach";

// No mock needed — style-adapter uses sensible defaults when ~/.golems-zikaron/style/ doesn't exist

const mockConnection: ConnectionInfo = {
  id: "conn-1",
  first_name: "Sarah",
  last_name: "Cohen",
  full_name: "Sarah Cohen",
  company: "Wix",
  position: "Senior Software Engineer",
  linkedin_url: "https://linkedin.com/in/sarahcohen",
  has_messages: true,
  relationship_strength: "strong",
};

const mockJob: JobInfo = {
  id: "job-1",
  title: "Senior React Developer",
  company: "Wix",
  url: "https://jobs.wix.com/react-dev",
  description: "Build React apps at scale",
  match_score: 9,
  match_reasons: ["React: 5yr match", "TypeScript: exact"],
  tech_stack: ["React", "TypeScript", "Node.js"],
};

const mockMatch: MatchInfo = {
  company_match_type: "exact",
  match_confidence: 1.0,
};

describe("generateOutreachDraft", () => {
  test("generates a complete draft with all fields", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.approachAngle).toBeTruthy();
    expect(draft.messageDraft).toBeTruthy();
    expect(draft.followupPlan).toBeTruthy();
    expect(draft.notes).toBeTruthy();
  });

  test("includes connection name in approach angle", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.approachAngle).toContain("Sarah");
  });

  test("mentions warm connection for has_messages", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.approachAngle).toContain("warm connection");
  });

  test("generates shorter follow-up for warm connections", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.followupPlan).toContain("3-4 days");
  });

  test("generates longer follow-up for cold connections", () => {
    const coldConn = { ...mockConnection, has_messages: false, relationship_strength: null };
    const draft = generateOutreachDraft(coldConn, mockJob, mockMatch);
    expect(draft.followupPlan).toContain("5-7 days");
  });

  test("includes greeting and sign-off in message", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    // Should contain Sarah's name in greeting (exact format depends on style-adapter defaults)
    expect(draft.messageDraft).toContain("Sarah");
    expect(draft.messageDraft).toContain("Alon");
  });

  test("includes match reasons when available", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.messageDraft).toContain("React: 5yr match");
  });

  test("falls back to tech stack when no match reasons", () => {
    const jobNoReasons = { ...mockJob, match_reasons: null };
    const draft = generateOutreachDraft(mockConnection, jobNoReasons, mockMatch);
    expect(draft.messageDraft).toMatch(/React|TypeScript|Node/);
  });

  test("references the company name in message", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.messageDraft).toContain("Wix");
  });

  test("references the job title in message", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.messageDraft).toContain("Senior React Developer");
  });

  test("adds notes about timing", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.notes).toContain("AVOID: Don't send on weekends");
  });

  test("handles recruiter connections differently", () => {
    const recruiter = { ...mockConnection, position: "Talent Acquisition Lead", has_messages: false, relationship_strength: null };
    const draft = generateOutreachDraft(recruiter, mockJob, mockMatch);
    expect(draft.approachAngle).toContain("recruiting/HR");
  });

  test("handles leadership connections", () => {
    const leader = { ...mockConnection, position: "Engineering Manager", has_messages: false, relationship_strength: null };
    const draft = generateOutreachDraft(leader, mockJob, mockMatch);
    expect(draft.approachAngle).toContain("leadership role");
  });

  test("handles fuzzy match type with caution note", () => {
    const fuzzyMatch: MatchInfo = { company_match_type: "fuzzy", match_confidence: 0.7 };
    const draft = generateOutreachDraft(mockConnection, mockJob, fuzzyMatch);
    expect(draft.notes).toContain("fuzzy");
  });

  test("warns about no previous messages", () => {
    const noMessages = { ...mockConnection, has_messages: false };
    const draft = generateOutreachDraft(noMessages, mockJob, mockMatch);
    expect(draft.notes).toContain("haven't messaged before");
  });

  test("mentions high match score", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.notes).toContain("High match score");
  });

  test("references connection position in notes", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.notes).toContain("Senior Software Engineer");
  });

  test("includes tech overlap in approach for exact match", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    expect(draft.approachAngle).toContain("works directly at");
  });
});

describe("formatDraftForTelegram", () => {
  test("formats a draft for Telegram display", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    const formatted = formatDraftForTelegram(draft, "Sarah Cohen", "Senior React Developer", "Wix");

    expect(formatted).toContain("Sarah Cohen");
    expect(formatted).toContain("Senior React Developer");
    expect(formatted).toContain("Wix");
    expect(formatted).toContain("Angle:");
    expect(formatted).toContain("approve / edit / skip");
  });

  test("truncates long messages", () => {
    const draft = generateOutreachDraft(mockConnection, mockJob, mockMatch);
    const formatted = formatDraftForTelegram(draft, "Sarah Cohen", "Senior React Developer", "Wix");
    expect(formatted).toContain("...");
  });
});
