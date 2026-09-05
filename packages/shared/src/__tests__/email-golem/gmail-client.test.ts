/**
 * Tests for Gmail Client
 * Uses dependency injection (resetGmailClient) instead of mock.module
 * because mock.module can't cross Bun workspace boundaries.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  createGmailClient,
  fetchRecentEmails,
  parseEmail,
  resetGmailClient,
  type GmailEmail,
} from "@golems/shared/email/gmail-client";

// Create mock Gmail API methods
const mockMessages = {
  list: mock(() => Promise.resolve({ data: { messages: [] } })),
  get: mock(() => Promise.resolve({ data: {} })),
};

const mockGmailClient = {
  users: {
    messages: mockMessages,
  },
} as any;

describe("Gmail Client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset mocks
    mockMessages.list.mockReset();
    mockMessages.get.mockReset();

    // Inject mock Gmail client
    resetGmailClient(mockGmailClient);

    // Set up test environment
    process.env = {
      ...originalEnv,
      GMAIL_CLIENT_ID: "test-client-id",
      GMAIL_CLIENT_SECRET: "test-client-secret",
      GMAIL_REFRESH_TOKEN: "test-refresh-token",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetGmailClient(null);
  });

  describe("parseEmail", () => {
    it("should parse email headers correctly", () => {
      const rawEmail = {
        id: "abc123",
        internalDate: "1706800000000",
        snippet: "This is a test email snippet...",
        payload: {
          headers: [
            { name: "From", value: "sender@example.com" },
            { name: "Subject", value: "Test Subject" },
            { name: "Date", value: "Thu, 1 Feb 2024 12:00:00 +0000" },
          ],
        },
      };

      const parsed = parseEmail(rawEmail);

      expect(parsed.id).toBe("abc123");
      expect(parsed.subject).toBe("Test Subject");
      expect(parsed.from).toBe("sender@example.com");
      expect(parsed.snippet).toBe("This is a test email snippet...");
      expect(parsed.receivedAt).toBeInstanceOf(Date);
    });

    it("should handle missing headers gracefully", () => {
      const rawEmail = {
        id: "xyz789",
        internalDate: "1706800000000",
        snippet: "Snippet text",
        payload: {
          headers: [],
        },
      };

      const parsed = parseEmail(rawEmail);

      expect(parsed.id).toBe("xyz789");
      expect(parsed.subject).toBe("");
      expect(parsed.from).toBe("");
      expect(parsed.snippet).toBe("Snippet text");
    });

    it("should extract email address from 'Name <email>' format", () => {
      const rawEmail = {
        id: "def456",
        internalDate: "1706800000000",
        snippet: "Test",
        payload: {
          headers: [
            { name: "From", value: "John Doe <john@example.com>" },
            { name: "Subject", value: "Hello" },
          ],
        },
      };

      const parsed = parseEmail(rawEmail);

      expect(parsed.from).toBe("john@example.com");
      expect(parsed.fromName).toBe("John Doe");
    });
  });

  describe("fetchRecentEmails", () => {
    it("should fetch and parse recent emails", async () => {
      // Mock list response
      mockMessages.list.mockResolvedValueOnce({
        data: {
          messages: [{ id: "msg1" }, { id: "msg2" }],
        },
      });

      // Mock get responses
      mockMessages.get
        .mockResolvedValueOnce({
          data: {
            id: "msg1",
            internalDate: "1706800000000",
            snippet: "Interview invitation for...",
            payload: {
              headers: [
                { name: "From", value: "hr@company.com" },
                { name: "Subject", value: "Interview Scheduled" },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: "msg2",
            internalDate: "1706790000000",
            snippet: "Your payment was received...",
            payload: {
              headers: [
                { name: "From", value: "billing@netflix.com" },
                { name: "Subject", value: "Payment Confirmation" },
              ],
            },
          },
        });

      const emails = await fetchRecentEmails(2);

      expect(emails).toHaveLength(2);
      expect(emails[0].id).toBe("msg1");
      expect(emails[0].subject).toBe("Interview Scheduled");
      expect(emails[1].id).toBe("msg2");
      expect(emails[1].from).toBe("billing@netflix.com");
    });

    it("should return empty array when no emails found", async () => {
      mockMessages.list.mockResolvedValueOnce({
        data: { messages: undefined },
      });

      const emails = await fetchRecentEmails();

      expect(emails).toHaveLength(0);
    });

    it("should respect maxResults parameter", async () => {
      mockMessages.list.mockResolvedValueOnce({
        data: { messages: [] },
      });

      await fetchRecentEmails(50);

      expect(mockMessages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          maxResults: 50,
        })
      );
    });

    it("should handle API errors gracefully", async () => {
      mockMessages.list.mockRejectedValueOnce(new Error("API rate limit"));

      await expect(fetchRecentEmails()).rejects.toThrow("API rate limit");
    });

    it("should filter by label when specified", async () => {
      mockMessages.list.mockResolvedValueOnce({
        data: { messages: [] },
      });

      await fetchRecentEmails(10, ["INBOX", "UNREAD"]);

      expect(mockMessages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          labelIds: ["INBOX", "UNREAD"],
        })
      );
    });
  });

  describe("GmailEmail type", () => {
    it("should have required fields", () => {
      const email: GmailEmail = {
        id: "test-id",
        subject: "Test Subject",
        from: "test@example.com",
        snippet: "Test snippet",
        receivedAt: new Date(),
      };

      expect(email.id).toBeDefined();
      expect(email.subject).toBeDefined();
      expect(email.from).toBeDefined();
      expect(email.snippet).toBeDefined();
      expect(email.receivedAt).toBeDefined();
    });
  });
});
