import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import * as llm from "@golems/shared/lib/llm";
import * as telegramDirect from "@golems/shared/lib/telegram-direct";
import * as eventLog from "@golems/shared/lib/event-log";
import { detectPaymentFailure, sendPaymentAlert } from "@golems/teller/alerts";
import type { ScoredEmail } from "@golems/teller/types";

const mockRunOllamaJSON = mock(async () => null);
const mockSendNotification = mock(async () => true);
const mockLogEvent = mock(async () => {});

// Use spyOn instead of mock.module to avoid global pollution
beforeEach(() => {
  spyOn(llm, "runLLMJSON").mockImplementation(mockRunOllamaJSON);
  spyOn(llm, "runLLM").mockImplementation(async () => "");
  spyOn(telegramDirect, "sendNotification").mockImplementation(mockSendNotification);
  spyOn(eventLog, "logEvent").mockImplementation(mockLogEvent);
});

afterEach(() => {
  mock.restore();
});

function makeEmail(overrides: Partial<ScoredEmail> = {}): ScoredEmail {
  return {
    id: "email-1",
    from: "Netflix <billing@netflix.com>",
    subject: "Your weekly newsletter",
    snippet: "Check out what's new this week on Netflix.",
    category: "newsletter",
    score: 3,
    receivedAt: "2026-02-07T10:00:00Z",
    ...overrides,
  };
}

describe("detectPaymentFailure", () => {
  beforeEach(() => {
    mockRunOllamaJSON.mockReset();
    mockRunOllamaJSON.mockImplementation(async () => null);
  });

  test("returns null for non-failure emails", async () => {
    const result = await detectPaymentFailure(makeEmail());
    expect(result).toBeNull();
    // LLM should NOT be called if regex doesn't match
    expect(mockRunOllamaJSON).not.toHaveBeenCalled();
  });

  test("detects 'payment failed' pattern", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: true,
      vendor: "Netflix",
      amount: 15.99,
      reason: "Card declined",
      actionNeeded: "Update card",
    }));

    const result = await detectPaymentFailure(
      makeEmail({ subject: "Your payment failed" })
    );
    expect(result).not.toBeNull();
    expect(result!.vendor).toBe("Netflix");
    expect(result!.amount).toBe(15.99);
  });

  test("detects 'card declined' pattern", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: true,
      vendor: "Spotify",
      amount: null,
      reason: "Card expired",
      actionNeeded: "Update payment method",
    }));

    const result = await detectPaymentFailure(
      makeEmail({ subject: "Your card declined", from: "Spotify <no-reply@spotify.com>" })
    );
    expect(result).not.toBeNull();
    expect(result!.vendor).toBe("Spotify");
    expect(result!.amount).toBeUndefined();
  });

  test("detects 'billing issue' pattern", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: true,
      vendor: "AWS",
      amount: 42.0,
      reason: "Billing error",
      actionNeeded: "Check billing console",
    }));

    const result = await detectPaymentFailure(
      makeEmail({ subject: "Billing issue with your account" })
    );
    expect(result).not.toBeNull();
  });

  test("detects 'unable to charge' pattern", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: true,
      vendor: "Vercel",
      amount: 20,
      reason: "Unable to charge",
      actionNeeded: "Update payment",
    }));

    const result = await detectPaymentFailure(
      makeEmail({ snippet: "We were unable to charge your card on file." })
    );
    expect(result).not.toBeNull();
  });

  test("detects 'action required payment' pattern", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: true,
      vendor: "GitHub",
      amount: null,
      reason: "Payment overdue",
      actionNeeded: "Pay now",
    }));

    const result = await detectPaymentFailure(
      makeEmail({ subject: "Action required: payment overdue" })
    );
    expect(result).not.toBeNull();
  });

  test("detects 'update payment method' pattern", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: true,
      vendor: "Figma",
      amount: null,
      reason: "Expiring card",
      actionNeeded: "Update payment method",
    }));

    const result = await detectPaymentFailure(
      makeEmail({ subject: "Please update your payment method" })
    );
    expect(result).not.toBeNull();
  });

  test("returns null when LLM says isFailure=false (marketing upsell)", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: false,
      vendor: "Netflix",
      amount: null,
      reason: "",
      actionNeeded: "",
    }));

    const result = await detectPaymentFailure(
      makeEmail({ subject: "Update your payment method for premium!" })
    );
    expect(result).toBeNull();
    expect(mockRunOllamaJSON).toHaveBeenCalled();
  });

  test("returns full PaymentFailure when LLM confirms", async () => {
    mockRunOllamaJSON.mockImplementation(async () => ({
      isFailure: true,
      vendor: "Anthropic",
      amount: 100,
      reason: "Card expired",
      actionNeeded: "Add new card in billing settings",
    }));

    const result = await detectPaymentFailure(
      makeEmail({
        id: "email-42",
        subject: "Payment failed for your API usage",
        from: "Anthropic <billing@anthropic.com>",
        snippet: "Your payment failed. Please update your card.",
      })
    );

    expect(result).not.toBeNull();
    expect(result!.vendor).toBe("Anthropic");
    expect(result!.amount).toBe(100);
    expect(result!.reason).toBe("Card expired");
    expect(result!.actionNeeded).toBe("Add new card in billing settings");
    expect(result!.emailId).toBe("email-42");
    expect(result!.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("sendPaymentAlert", () => {
  beforeEach(() => {
    mockSendNotification.mockReset();
    mockSendNotification.mockImplementation(async () => true);
    mockLogEvent.mockReset();
    mockLogEvent.mockImplementation(async () => {});
  });

  const failure = {
    vendor: "Netflix",
    amount: 15.99,
    reason: "Card declined",
    actionNeeded: "Update payment method",
    emailId: "email-1",
    detectedAt: "2026-02-07T10:00:00Z",
  };

  test("calls sendNotification with correct params", async () => {
    await sendPaymentAlert(failure);

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalledWith({
      title: "Payment Failed: Netflix",
      body: "Card declined ($15.99). Update payment method",
      source: "email",
      priority: "high",
    });
  });

  test("sends notification without amount when undefined", async () => {
    await sendPaymentAlert({ ...failure, amount: undefined });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Card declined. Update payment method",
      })
    );
  });

  test("logs email_alert event", async () => {
    await sendPaymentAlert(failure);

    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    expect(mockLogEvent).toHaveBeenCalledWith("email_alert", {
      vendor: "Netflix",
      reason: "Card declined",
      emailId: "email-1",
    }, "tellergolem");
  });
});
