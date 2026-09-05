import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock axiom before importing
const mockLogError = mock(() => {});
const mockFlushAxiom = mock(() => Promise.resolve());

mock.module("@golems/shared/lib/axiom", () => ({
  logError: mockLogError,
  flushAxiom: mockFlushAxiom,
}));

import {
  installProcessGuards,
  _getLastCapturedError,
  _resetGuards,
} from "@golems/shared/lib/process-guards";

describe("process-guards", () => {
  let originalListeners: {
    unhandledRejection: Function[];
    uncaughtException: Function[];
  };

  beforeEach(() => {
    mockLogError.mockClear();
    mockFlushAxiom.mockClear();
    _resetGuards();
    // Save original listeners
    originalListeners = {
      unhandledRejection: process.listeners("unhandledRejection") as Function[],
      uncaughtException: process.listeners("uncaughtException") as Function[],
    };
  });

  afterEach(() => {
    // Restore original listeners
    process.removeAllListeners("unhandledRejection");
    process.removeAllListeners("uncaughtException");
    for (const fn of originalListeners.unhandledRejection) {
      process.on("unhandledRejection", fn as any);
    }
    for (const fn of originalListeners.uncaughtException) {
      process.on("uncaughtException", fn as any);
    }
  });

  it("installs unhandledRejection handler", () => {
    const before = process.listenerCount("unhandledRejection");
    installProcessGuards("test-service");
    const after = process.listenerCount("unhandledRejection");
    expect(after).toBe(before + 1);
  });

  it("installs uncaughtException handler", () => {
    const before = process.listenerCount("uncaughtException");
    installProcessGuards("test-service");
    const after = process.listenerCount("uncaughtException");
    expect(after).toBe(before + 1);
  });

  it("logs unhandled rejection to Axiom", () => {
    installProcessGuards("test-service");
    const error = new Error("test rejection");

    // Manually emit unhandledRejection
    process.emit("unhandledRejection", error, Promise.resolve());

    expect(mockLogError).toHaveBeenCalledTimes(1);
    const call = mockLogError.mock.calls[0] as any[];
    expect(call[0].service).toBe("test-service");
    expect(call[0].error_type).toBe("unhandled_rejection");
    expect(call[0].error_message).toBe("test rejection");
  });

  it("captures non-Error rejection reasons", () => {
    installProcessGuards("test-service");

    process.emit("unhandledRejection", "string reason", Promise.resolve());

    expect(mockLogError).toHaveBeenCalledTimes(1);
    const call = mockLogError.mock.calls[0] as any[];
    expect(call[0].error_message).toBe("string reason");
  });

  it("exposes last captured error for testing", () => {
    installProcessGuards("test-service");
    const error = new Error("captured error");

    process.emit("unhandledRejection", error, Promise.resolve());

    const captured = _getLastCapturedError();
    expect(captured).toBeTruthy();
    expect(captured?.message).toBe("captured error");
    expect(captured?.type).toBe("unhandled_rejection");
  });
});
