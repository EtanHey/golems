import { describe, it, expect } from "bun:test";
import {
  parseListUnsubscribe,
  senderCategoryFromEmail,
} from "@golems/shared/email/sender-tracker";

describe("sender-tracker", () => {
  describe("parseListUnsubscribe", () => {
    it("should return empty for undefined header", () => {
      expect(parseListUnsubscribe(undefined)).toEqual({});
    });

    it("should return empty for empty string", () => {
      expect(parseListUnsubscribe("")).toEqual({});
    });

    it("should extract URL from List-Unsubscribe header", () => {
      const result = parseListUnsubscribe(
        "<https://example.com/unsubscribe?id=123>"
      );
      expect(result.url).toBe("https://example.com/unsubscribe?id=123");
      expect(result.email).toBeUndefined();
    });

    it("should extract mailto from List-Unsubscribe header", () => {
      const result = parseListUnsubscribe(
        "<mailto:unsubscribe@example.com>"
      );
      expect(result.email).toBe("unsubscribe@example.com");
      expect(result.url).toBeUndefined();
    });

    it("should extract both URL and mailto", () => {
      const result = parseListUnsubscribe(
        "<mailto:unsub@example.com>, <https://example.com/unsub>"
      );
      expect(result.email).toBe("unsub@example.com");
      expect(result.url).toBe("https://example.com/unsub");
    });

    it("should strip query params from mailto", () => {
      const result = parseListUnsubscribe(
        "<mailto:unsub@example.com?subject=unsubscribe>"
      );
      expect(result.email).toBe("unsub@example.com");
    });

    it("should handle HTTP URLs (not just HTTPS)", () => {
      const result = parseListUnsubscribe(
        "<http://old.example.com/unsubscribe>"
      );
      expect(result.url).toBe("http://old.example.com/unsubscribe");
    });

    it("should handle real-world GitHub header format", () => {
      const result = parseListUnsubscribe(
        "<mailto:noreply@github.com>, <https://github.com/notifications/unsubscribe/ABC123>"
      );
      expect(result.email).toBe("noreply@github.com");
      expect(result.url).toBe(
        "https://github.com/notifications/unsubscribe/ABC123"
      );
    });
  });

  describe("senderCategoryFromEmail", () => {
    it("should map promo to promo", () => {
      expect(senderCategoryFromEmail("promo")).toBe("promo");
    });

    it("should map newsletter to newsletter", () => {
      expect(senderCategoryFromEmail("newsletter")).toBe("newsletter");
    });

    it("should map job to job", () => {
      expect(senderCategoryFromEmail("job")).toBe("job");
    });

    it("should map interview to job", () => {
      expect(senderCategoryFromEmail("interview")).toBe("job");
    });

    it("should map tech-update to tech", () => {
      expect(senderCategoryFromEmail("tech-update")).toBe("tech");
    });

    it("should map other categories to normal", () => {
      expect(senderCategoryFromEmail("other")).toBe("normal");
      expect(senderCategoryFromEmail("social")).toBe("normal");
      expect(senderCategoryFromEmail("urgent")).toBe("normal");
    });
  });
});
