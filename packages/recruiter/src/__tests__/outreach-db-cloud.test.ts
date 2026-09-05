import { describe, it, expect } from "bun:test";

/**
 * Structural tests for outreach-db-cloud.ts
 * Verifies the module exports match the original outreach-db interface.
 * Integration tests would require a live Supabase instance.
 */

describe("outreach-db-cloud exports", () => {
  it("exports all contact functions", async () => {
    const mod = await import("@golems/recruiter/outreach-db-cloud");
    expect(typeof mod.createContact).toBe("function");
    expect(typeof mod.getContact).toBe("function");
    expect(typeof mod.getContactsByCompany).toBe("function");
  });

  it("exports all outreach functions", async () => {
    const mod = await import("@golems/recruiter/outreach-db-cloud");
    expect(typeof mod.createOutreach).toBe("function");
    expect(typeof mod.getOutreach).toBe("function");
    expect(typeof mod.getOutreachByJob).toBe("function");
    expect(typeof mod.updateOutreachStatus).toBe("function");
    expect(typeof mod.getPendingFollowups).toBe("function");
    expect(typeof mod.getOutreachStats).toBe("function");
  });

  it("exports company research functions", async () => {
    const mod = await import("@golems/recruiter/outreach-db-cloud");
    expect(typeof mod.saveCompanyResearch).toBe("function");
    expect(typeof mod.getCompanyResearch).toBe("function");
  });
});

describe("practice-db-cloud exports", () => {
  it("exports all session functions", async () => {
    const mod = await import("@golems/recruiter/practice-db-cloud");
    expect(typeof mod.createSession).toBe("function");
    expect(typeof mod.getSession).toBe("function");
    expect(typeof mod.completeSession).toBe("function");
    expect(typeof mod.getRecentSessions).toBe("function");
    expect(typeof mod.getActiveSession).toBe("function");
    expect(typeof mod.getStats).toBe("function");
  });

  it("exports question functions", async () => {
    const mod = await import("@golems/recruiter/practice-db-cloud");
    expect(typeof mod.addQuestion).toBe("function");
    expect(typeof mod.getSessionQuestions).toBe("function");
  });
});
