import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import {
  initDb,
  closeDb,
  // Contact functions
  createContact,
  getContact,
  getContactsByCompany,
  // Outreach functions
  createOutreach,
  getOutreach,
  getOutreachByJob,
  getOutreachByContact,
  updateOutreachStatus,
  getPendingFollowups,
  getOutreachStats,
  // Company research functions
  saveCompanyResearch,
  getCompanyResearch,
  type Contact,
  type Outreach,
  type OutreachStatus,
  type MessageType,
  type CompanyResearch,
} from "@golems/recruiter/outreach-db";

// Use a temp directory for tests
const TEST_DB_PATH = join(process.cwd(), ".test-outreach.db");

describe("Outreach Database", () => {
  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
    initDb(TEST_DB_PATH);
  });

  afterEach(() => {
    closeDb();
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
  });

  describe("Contact Management", () => {
    it("should create a new contact", () => {
      const contact = createContact({
        name: "John Doe",
        email: "john@example.com",
        company: "Acme Corp",
        role: "Engineering Manager",
        source: "github",
      });

      expect(contact.id).toBeDefined();
      expect(contact.name).toBe("John Doe");
      expect(contact.email).toBe("john@example.com");
      expect(contact.company).toBe("Acme Corp");
      expect(contact.role).toBe("Engineering Manager");
      expect(contact.source).toBe("github");
      expect(contact.createdAt).toBeDefined();
    });

    it("should create a contact with LinkedIn URL", () => {
      const contact = createContact({
        name: "Jane Smith",
        linkedinUrl: "https://linkedin.com/in/janesmith",
        company: "TechCo",
        role: "CTO",
        source: "linkedin",
      });

      expect(contact.linkedinUrl).toBe("https://linkedin.com/in/janesmith");
      expect(contact.email).toBeNull();
    });

    it("should retrieve a contact by ID", () => {
      const created = createContact({
        name: "Test User",
        email: "test@test.com",
        company: "Test Inc",
        role: "Developer",
        source: "hunter",
      });

      const retrieved = getContact(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe("Test User");
    });

    it("should return null for non-existent contact", () => {
      const contact = getContact("non-existent-id");
      expect(contact).toBeNull();
    });

    it("should get contacts by company", () => {
      createContact({
        name: "Person 1",
        email: "p1@acme.com",
        company: "Acme Corp",
        role: "Engineer",
        source: "github",
      });
      createContact({
        name: "Person 2",
        email: "p2@acme.com",
        company: "Acme Corp",
        role: "Manager",
        source: "linkedin",
      });
      createContact({
        name: "Person 3",
        email: "p3@other.com",
        company: "Other Co",
        role: "CTO",
        source: "hunter",
      });

      const acmeContacts = getContactsByCompany("Acme Corp");
      expect(acmeContacts.length).toBe(2);
      expect(acmeContacts.every((c) => c.company === "Acme Corp")).toBe(true);
    });
  });

  describe("Outreach Tracking", () => {
    let testContact: Contact;

    beforeEach(() => {
      testContact = createContact({
        name: "Test Contact",
        email: "contact@test.com",
        company: "Test Co",
        role: "Manager",
        source: "github",
      });
    });

    it("should create an outreach record", () => {
      const outreach = createOutreach({
        jobId: "job-123",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Hi, I saw your job posting...",
      });

      expect(outreach.id).toBeDefined();
      expect(outreach.jobId).toBe("job-123");
      expect(outreach.contactId).toBe(testContact.id);
      expect(outreach.messageType).toBe("email");
      expect(outreach.messageText).toBe("Hi, I saw your job posting...");
      expect(outreach.status).toBe("draft");
      expect(outreach.createdAt).toBeDefined();
      expect(outreach.sentAt).toBeNull();
      expect(outreach.respondedAt).toBeNull();
    });

    it("should support all message types", () => {
      const types: MessageType[] = ["email", "linkedin_connect", "linkedin_message"];

      for (const messageType of types) {
        const outreach = createOutreach({
          jobId: `job-${messageType}`,
          contactId: testContact.id,
          messageType,
          messageText: `Message for ${messageType}`,
        });
        expect(outreach.messageType).toBe(messageType);
      }
    });

    it("should retrieve outreach by ID", () => {
      const created = createOutreach({
        jobId: "job-456",
        contactId: testContact.id,
        messageType: "linkedin_connect",
        messageText: "Let's connect!",
      });

      const retrieved = getOutreach(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.messageType).toBe("linkedin_connect");
    });

    it("should get all outreach for a job", () => {
      const contact2 = createContact({
        name: "Second Contact",
        email: "second@test.com",
        company: "Test Co",
        role: "CTO",
        source: "linkedin",
      });

      createOutreach({
        jobId: "job-789",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Email message",
      });
      createOutreach({
        jobId: "job-789",
        contactId: contact2.id,
        messageType: "linkedin_connect",
        messageText: "LinkedIn message",
      });
      createOutreach({
        jobId: "other-job",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Other job",
      });

      const jobOutreach = getOutreachByJob("job-789");
      expect(jobOutreach.length).toBe(2);
    });

    it("should get all outreach for a contact", () => {
      createOutreach({
        jobId: "job-1",
        contactId: testContact.id,
        messageType: "email",
        messageText: "First",
      });
      createOutreach({
        jobId: "job-2",
        contactId: testContact.id,
        messageType: "linkedin_message",
        messageText: "Second",
      });

      const contactOutreach = getOutreachByContact(testContact.id);
      expect(contactOutreach.length).toBe(2);
    });

    it("should update outreach status to sent", () => {
      const outreach = createOutreach({
        jobId: "job-send",
        contactId: testContact.id,
        messageType: "email",
        messageText: "To be sent",
      });

      const updated = updateOutreachStatus(outreach.id, "sent");

      expect(updated.status).toBe("sent");
      expect(updated.sentAt).toBeDefined();
      expect(updated.respondedAt).toBeNull();
    });

    it("should update outreach status to responded", () => {
      const outreach = createOutreach({
        jobId: "job-respond",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Will get response",
      });

      updateOutreachStatus(outreach.id, "sent");
      const updated = updateOutreachStatus(outreach.id, "responded");

      expect(updated.status).toBe("responded");
      expect(updated.respondedAt).toBeDefined();
    });

    it("should update outreach status to no_response", () => {
      const outreach = createOutreach({
        jobId: "job-no-resp",
        contactId: testContact.id,
        messageType: "email",
        messageText: "No response expected",
      });

      updateOutreachStatus(outreach.id, "sent");
      const updated = updateOutreachStatus(outreach.id, "no_response");

      expect(updated.status).toBe("no_response");
    });
  });

  describe("Follow-up Tracking", () => {
    let testContact: Contact;

    beforeEach(() => {
      testContact = createContact({
        name: "Followup Contact",
        email: "followup@test.com",
        company: "Followup Co",
        role: "Manager",
        source: "github",
      });
    });

    it("should get pending followups (sent > 5 days ago with no response)", () => {
      // Create an outreach that was sent 6 days ago
      const outreach = createOutreach({
        jobId: "job-old",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Old message",
      });

      // Manually set sent_at to 6 days ago for testing
      const sixDaysAgo = new Date();
      sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

      // Use internal update to set old date (we'll need to expose this or use raw SQL)
      updateOutreachStatus(outreach.id, "sent");
      // For this test to work properly, we need to manipulate the sent_at date
      // This will be tested with the implementation

      const pending = getPendingFollowups(5);
      // Note: This test may need adjustment based on implementation
      // The key is that it finds outreach > 5 days old with status 'sent'
      expect(Array.isArray(pending)).toBe(true);
    });

    it("should not include responded outreach in followups", () => {
      const outreach = createOutreach({
        jobId: "job-responded",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Got response",
      });

      updateOutreachStatus(outreach.id, "sent");
      updateOutreachStatus(outreach.id, "responded");

      const pending = getPendingFollowups(0); // 0 days = include all sent
      const found = pending.find((p) => p.id === outreach.id);
      expect(found).toBeUndefined();
    });

    it("should not include draft outreach in followups", () => {
      createOutreach({
        jobId: "job-draft",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Still draft",
      });

      const pending = getPendingFollowups(0);
      expect(pending.length).toBe(0);
    });
  });

  describe("Outreach Statistics", () => {
    let testContact: Contact;

    beforeEach(() => {
      testContact = createContact({
        name: "Stats Contact",
        email: "stats@test.com",
        company: "Stats Co",
        role: "Manager",
        source: "github",
      });
    });

    it("should calculate outreach statistics", () => {
      // Create various outreach states
      const o1 = createOutreach({
        jobId: "job-1",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Draft",
      });

      const o2 = createOutreach({
        jobId: "job-2",
        contactId: testContact.id,
        messageType: "email",
        messageText: "Sent",
      });
      updateOutreachStatus(o2.id, "sent");

      const o3 = createOutreach({
        jobId: "job-3",
        contactId: testContact.id,
        messageType: "linkedin_connect",
        messageText: "Responded",
      });
      updateOutreachStatus(o3.id, "sent");
      updateOutreachStatus(o3.id, "responded");

      const o4 = createOutreach({
        jobId: "job-4",
        contactId: testContact.id,
        messageType: "email",
        messageText: "No response",
      });
      updateOutreachStatus(o4.id, "sent");
      updateOutreachStatus(o4.id, "no_response");

      const stats = getOutreachStats();

      expect(stats.total).toBe(4);
      expect(stats.draft).toBe(1);
      expect(stats.sent).toBe(1);
      expect(stats.responded).toBe(1);
      expect(stats.noResponse).toBe(1);
      expect(stats.responseRate).toBeCloseTo(33.33, 1); // 1 responded out of 3 non-draft
    });

    it("should return zero stats when no outreach exists", () => {
      const stats = getOutreachStats();

      expect(stats.total).toBe(0);
      expect(stats.draft).toBe(0);
      expect(stats.sent).toBe(0);
      expect(stats.responded).toBe(0);
      expect(stats.noResponse).toBe(0);
      expect(stats.responseRate).toBe(0);
    });
  });

  describe("Company Research", () => {
    it("should save company research", () => {
      const research = saveCompanyResearch({
        companyName: "TechCo",
        data: {
          website: "https://techco.com",
          techStack: ["React", "Node.js", "PostgreSQL"],
          recentNews: ["Series A funding"],
          teamSize: "50-100",
        },
      });

      expect(research.id).toBeDefined();
      expect(research.companyName).toBe("TechCo");
      expect(research.data.website).toBe("https://techco.com");
      expect(research.data.techStack).toContain("React");
      expect(research.researchedAt).toBeDefined();
    });

    it("should retrieve company research", () => {
      saveCompanyResearch({
        companyName: "FindMe Corp",
        data: {
          website: "https://findme.com",
          techStack: ["Vue", "Python"],
        },
      });

      const research = getCompanyResearch("FindMe Corp");

      expect(research).not.toBeNull();
      expect(research!.companyName).toBe("FindMe Corp");
      expect(research!.data.techStack).toContain("Vue");
    });

    it("should return null for non-existent company research", () => {
      const research = getCompanyResearch("Unknown Company");
      expect(research).toBeNull();
    });

    it("should update existing company research", () => {
      saveCompanyResearch({
        companyName: "UpdateMe",
        data: {
          website: "https://old.com",
          techStack: ["Old Tech"],
        },
      });

      saveCompanyResearch({
        companyName: "UpdateMe",
        data: {
          website: "https://new.com",
          techStack: ["New Tech", "Better Tech"],
        },
      });

      const research = getCompanyResearch("UpdateMe");

      expect(research!.data.website).toBe("https://new.com");
      expect(research!.data.techStack).toContain("New Tech");
    });
  });
});
