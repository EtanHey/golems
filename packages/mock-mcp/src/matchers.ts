import type { MockMcpServer, ToolCall } from "./mock-mcp-server";
import { expect } from "bun:test";

interface MatcherResult {
  pass: boolean;
  message: () => string;
}

function toHaveCalledBefore(
  server: MockMcpServer,
  firstTool: string,
  secondTool: string,
): MatcherResult {
  const sequence = server.getCallSequence();
  const firstIndex = sequence.findIndex((c) => c.toolName === firstTool);
  const secondIndex = sequence.findIndex((c) => c.toolName === secondTool);

  if (firstIndex === -1) {
    return {
      pass: false,
      message: () =>
        `Expected "${firstTool}" to be called, but it was never called`,
    };
  }
  if (secondIndex === -1) {
    return {
      pass: false,
      message: () =>
        `Expected "${secondTool}" to be called, but it was never called`,
    };
  }

  const pass = firstIndex < secondIndex;
  return {
    pass,
    message: () =>
      pass
        ? `Expected "${firstTool}" NOT to be called before "${secondTool}"`
        : `Expected "${firstTool}" (index ${firstIndex}) to be called before "${secondTool}" (index ${secondIndex})`,
  };
}

function toHaveCalledInOrder(
  server: MockMcpServer,
  expectedOrder: string[],
): MatcherResult {
  const sequence = server.getCallOrder();
  let lastIndex = -1;

  for (const tool of expectedOrder) {
    const idx = sequence.indexOf(tool, lastIndex + 1);
    if (idx === -1) {
      return {
        pass: false,
        message: () =>
          `Expected tool "${tool}" in sequence after index ${lastIndex}, but it was not found.\nActual sequence: [${sequence.join(", ")}]`,
      };
    }
    lastIndex = idx;
  }

  return {
    pass: true,
    message: () =>
      `Expected tools NOT to be called in order [${expectedOrder.join(", ")}]`,
  };
}

function toHaveCalledToolCount(
  server: MockMcpServer,
  toolName: string,
  expectedCount: number,
): MatcherResult {
  const actual = server.getCallCount(toolName);
  const pass = actual === expectedCount;
  return {
    pass,
    message: () =>
      pass
        ? `Expected "${toolName}" NOT to be called ${expectedCount} time(s)`
        : `Expected "${toolName}" to be called ${expectedCount} time(s), but was called ${actual} time(s)`,
  };
}

function toHaveCalledWithArgs(
  server: MockMcpServer,
  toolName: string,
  expectedArgs: Record<string, unknown>,
): MatcherResult {
  const calls = server.getAllCalls(toolName);
  if (calls.length === 0) {
    return {
      pass: false,
      message: () =>
        `Expected "${toolName}" to be called, but it was never called`,
    };
  }

  const matched = calls.some((call) => {
    for (const [key, value] of Object.entries(expectedArgs)) {
      if (JSON.stringify(call.args[key]) !== JSON.stringify(value)) {
        return false;
      }
    }
    return true;
  });

  return {
    pass: matched,
    message: () =>
      matched
        ? `Expected "${toolName}" NOT to be called with args ${JSON.stringify(expectedArgs)}`
        : `Expected "${toolName}" to be called with args ${JSON.stringify(expectedArgs)}, but no matching call found.\nActual calls: ${JSON.stringify(
            calls.map((c) => c.args),
            null,
            2,
          )}`,
  };
}

/**
 * Install custom matchers for behavioral assertions on MockMcpServer.
 *
 * Usage:
 *   import { installMatchers } from "@golems/mock-mcp";
 *   installMatchers();
 *
 *   expect(server).toHaveCalledBefore("tool_a", "tool_b");
 *   expect(server).toHaveCalledInOrder(["a", "b", "c"]);
 *   expect(server).toHaveCalledToolCount("tool_a", 2);
 *   expect(server).toHaveCalledWithArgs("tool_a", { key: "value" });
 */
export function installMatchers(): void {
  expect.extend({
    toHaveCalledBefore(
      server: MockMcpServer,
      firstTool: string,
      secondTool: string,
    ) {
      return toHaveCalledBefore(server, firstTool, secondTool);
    },
    toHaveCalledInOrder(server: MockMcpServer, expectedOrder: string[]) {
      return toHaveCalledInOrder(server, expectedOrder);
    },
    toHaveCalledToolCount(
      server: MockMcpServer,
      toolName: string,
      expectedCount: number,
    ) {
      return toHaveCalledToolCount(server, toolName, expectedCount);
    },
    toHaveCalledWithArgs(
      server: MockMcpServer,
      toolName: string,
      expectedArgs: Record<string, unknown>,
    ) {
      return toHaveCalledWithArgs(server, toolName, expectedArgs);
    },
  });
}

declare module "bun:test" {
  interface Matchers<T> {
    toHaveCalledBefore(firstTool: string, secondTool: string): void;
    toHaveCalledInOrder(expectedOrder: string[]): void;
    toHaveCalledToolCount(toolName: string, expectedCount: number): void;
    toHaveCalledWithArgs(
      toolName: string,
      expectedArgs: Record<string, unknown>,
    ): void;
  }
}
