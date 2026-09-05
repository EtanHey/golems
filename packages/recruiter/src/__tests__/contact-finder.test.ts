import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import * as outreachDb from "../outreach-db";
import { findContacts, extractDomain, formatContacts, type FoundContact } from "../contact-finder";

// Use spyOn instead of mock.module to avoid global pollution
beforeEach(() => {
  spyOn(outreachDb, "createContact").mockImplementation(mock(() => {}));
  spyOn(outreachDb, "getContactsByCompany").mockImplementation(mock(() => []));
});

afterEach(() => {
  mock.restore();
});

describe("extractDomain", () => {
  test("extracts domain from URL", () => {
    expect(extractDomain("https://www.example.com")).toBe("example.com");
    expect(extractDomain("https://example.com")).toBe("example.com");
  });

  test("guesses domain from company name", () => {
    expect(extractDomain("Acme Corp")).toBe("acmecorp.com");
    expect(extractDomain("My Company")).toBe("mycompany.com");
  });
});

describe("formatContacts", () => {
  test("returns message when no contacts", () => {
    expect(formatContacts([])).toBe("No contacts found.");
  });

  test("formats contacts with email and LinkedIn", () => {
    const contacts: FoundContact[] = [
      {
        name: "Jane Doe",
        email: "jane@example.com",
        linkedinUrl: "https://linkedin.com/in/janedoe",
        role: "CTO",
        source: "exa",
        confidence: "medium",
      },
    ];

    const output = formatContacts(contacts);
    expect(output).toContain("Jane Doe");
    expect(output).toContain("CTO");
    expect(output).toContain("jane@example.com");
    expect(output).toContain("linkedin.com/in/janedoe");
    expect(output).toContain("exa");
  });
});

describe("findContacts", () => {
  beforeEach(() => {
    // Clear env vars
    delete process.env.EXA_API_KEY;
    delete process.env.HUNTER_API_KEY;
  });

  test("returns empty array when no sources configured", async () => {
    const contacts = await findContacts("Acme Corp");
    expect(contacts).toEqual([]);
  });

  test("skips Exa when no API key set", async () => {
    const contacts = await findContacts("Acme Corp", { maxResults: 3 });
    // Should not throw, just return empty
    expect(Array.isArray(contacts)).toBe(true);
  });
});
