/**
 * Tests for Telegram Topics Routing
 *
 * Tests the notification routing logic for the group topics feature.
 */

import { describe, it, expect } from "bun:test";

// Source to topic routing configuration (mirrors telegram-bot.ts)
// Note: "claude" goes to "general" (no thread ID, uses General topic)
type TopicKey = "general" | "alerts" | "nightshift" | "email" | "jobs";

const SOURCE_TO_TOPIC: Record<string, TopicKey> = {
  claude: "general",  // Goes to General topic (no thread ID)
  ralph: "alerts",
  nightshift: "nightshift",
  email: "email",
  jobs: "jobs",
  healthcheck: "alerts",
  default: "alerts",
};

function getTopicForSource(source: string): TopicKey {
  return SOURCE_TO_TOPIC[source] || SOURCE_TO_TOPIC.default;
}

describe("Telegram Topics - Source Routing", () => {
  it("should route claude to general (no thread ID)", () => {
    expect(getTopicForSource("claude")).toBe("general");
  });

  it("should route ralph to alerts", () => {
    expect(getTopicForSource("ralph")).toBe("alerts");
  });

  it("should route nightshift to nightshift", () => {
    expect(getTopicForSource("nightshift")).toBe("nightshift");
  });

  it("should route email to email", () => {
    expect(getTopicForSource("email")).toBe("email");
  });

  it("should route jobs to jobs", () => {
    expect(getTopicForSource("jobs")).toBe("jobs");
  });

  it("should route healthcheck to alerts", () => {
    expect(getTopicForSource("healthcheck")).toBe("alerts");
  });

  it("should route unknown sources to alerts (default)", () => {
    expect(getTopicForSource("unknown-source")).toBe("alerts");
    expect(getTopicForSource("cursor-helper")).toBe("alerts");
    expect(getTopicForSource("kiro-helper")).toBe("alerts");
    expect(getTopicForSource("moltbot")).toBe("alerts");
  });
});

describe("Telegram Topics - State Structure", () => {
  // Note: "chat" removed - ClaudeGolem goes to General (no thread ID needed)
  interface TopicsState {
    alerts?: number;
    nightshift?: number;
    email?: number;
    jobs?: number;
  }

  it("should have correct topics state structure", () => {
    const topics: TopicsState = {
      alerts: 3,
      nightshift: 4,
      email: 5,
      jobs: 7,
    };

    // Note: no "chat" - claude goes to General (no thread ID)
    expect(topics.alerts).toBe(3);
    expect(topics.nightshift).toBe(4);
    expect(topics.email).toBe(5);
    expect(topics.jobs).toBe(7);
  });

  it("should handle partial topics configuration", () => {
    const topics: TopicsState = {
      alerts: 3,
    };

    expect(topics.alerts).toBe(3);
    expect(topics.nightshift).toBeUndefined();
  });

  it("should handle empty topics", () => {
    const topics: TopicsState = {};
    expect(Object.keys(topics)).toHaveLength(0);
  });
});

describe("Telegram Topics - Notification Payload", () => {
  interface NotificationPayload {
    title: string;
    body: string;
    source?: string;
    priority?: "default" | "high";
  }

  it("should have valid notification structure", () => {
    const payload: NotificationPayload = {
      title: "Test Title",
      body: "Test body message",
      source: "alerts",
      priority: "default",
    };

    expect(payload.title).toBe("Test Title");
    expect(payload.source).toBe("alerts");
  });

  it("should allow high priority", () => {
    const payload: NotificationPayload = {
      title: "Urgent",
      body: "Something important",
      source: "email",
      priority: "high",
    };

    expect(payload.priority).toBe("high");
  });

  it("should allow missing optional fields", () => {
    const payload: NotificationPayload = {
      title: "Simple",
      body: "Message",
    };

    expect(payload.source).toBeUndefined();
    expect(payload.priority).toBeUndefined();
  });
});

describe("Telegram Topics - Thread ID Selection", () => {
  interface State {
    groupChatId?: number;
    telegramChatId?: number;
    topics?: TopicsState;
  }

  // Note: "chat" removed - ClaudeGolem goes to General (no thread ID)
  interface TopicsState {
    alerts?: number;
    nightshift?: number;
    email?: number;
    jobs?: number;
  }

  function selectDestination(
    state: State,
    topicKey: TopicKey
  ): { chatId: number | null; threadId: number | undefined } {
    if (state.groupChatId && state.topics) {
      // "general" means no thread ID (goes to General topic)
      const threadId = topicKey === "general" ? undefined : state.topics[topicKey as keyof TopicsState];
      return {
        chatId: state.groupChatId,
        threadId,
      };
    }
    return {
      chatId: state.telegramChatId || null,
      threadId: undefined,
    };
  }

  it("should use group chat with thread when topics configured", () => {
    const state: State = {
      groupChatId: -100123456,
      telegramChatId: 123456789, // obvious synthetic user ID
      topics: {
        alerts: 3,
      },
    };

    const dest = selectDestination(state, "alerts");
    expect(dest.chatId).toBe(-100123456);
    expect(dest.threadId).toBe(3);
  });

  it("should route claude (general) to group without thread ID", () => {
    const state: State = {
      groupChatId: -100123456,
      telegramChatId: 123456789,
      topics: {
        alerts: 3,
      },
    };

    const dest = selectDestination(state, "general");
    expect(dest.chatId).toBe(-100123456);
    expect(dest.threadId).toBeUndefined();  // General = no thread ID
  });

  it("should fallback to DM when no group configured", () => {
    const state: State = {
      telegramChatId: 123456789,
    };

    const dest = selectDestination(state, "alerts");
    expect(dest.chatId).toBe(123456789);
    expect(dest.threadId).toBeUndefined();
  });

  it("should return null chatId when nothing configured", () => {
    const state: State = {};
    const dest = selectDestination(state, "alerts");
    expect(dest.chatId).toBeNull();
  });
});
