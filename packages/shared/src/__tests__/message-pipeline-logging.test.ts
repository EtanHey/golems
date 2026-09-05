import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  logMessagePipeline,
  type MessagePipelineEvent,
} from "@golems/shared/lib/axiom";

// Mock the Axiom client
mock.module("@axiomhq/js", () => ({
  Axiom: class {
    ingest = mock(() => {});
    flush = mock(() => Promise.resolve());
  },
}));

// Force axiom enabled for tests
mock.module("@golems/shared/lib/config", () => ({
  loadConfig: () => ({
    observability: {
      enabled: true,
      axiomToken: "test-token",
      axiomDataset: "golems-test",
    },
  }),
}));

describe("message pipeline logging", () => {
  it("logMessagePipeline accepts all required fields", () => {
    // Should not throw
    expect(() =>
      logMessagePipeline({
        message_id: "msg-123",
        golem_name: "claudegolem",
        phase: "receive",
        latency_ms: 0,
        success: true,
      }),
    ).not.toThrow();
  });

  it("logMessagePipeline accepts optional error fields", () => {
    expect(() =>
      logMessagePipeline({
        message_id: "msg-456",
        golem_name: "claudegolem",
        phase: "process",
        latency_ms: 1500,
        success: false,
        error_type: "timeout",
        error_message: "Claude fork timed out",
      }),
    ).not.toThrow();
  });

  it("logMessagePipeline accepts respond phase with response_length", () => {
    expect(() =>
      logMessagePipeline({
        message_id: "msg-789",
        golem_name: "claudegolem",
        phase: "respond",
        latency_ms: 3200,
        success: true,
        response_length: 1500,
      }),
    ).not.toThrow();
  });

  it("MessagePipelineEvent type has correct structure", () => {
    const event: Omit<MessagePipelineEvent, "_type"> = {
      message_id: "test",
      golem_name: "claudegolem",
      phase: "process",
      latency_ms: 100,
      success: true,
    };

    expect(event.message_id).toBe("test");
    expect(event.golem_name).toBe("claudegolem");
    expect(event.phase).toBe("process");
    expect(event.latency_ms).toBe(100);
    expect(event.success).toBe(true);
  });
});
