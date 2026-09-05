import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { MockMcpServer, installMatchers } from "../index";

installMatchers();

describe("MockMcpServer", () => {
  let server: MockMcpServer;

  beforeEach(() => {
    server = new MockMcpServer("test-server", "1.0.0");
  });

  afterEach(async () => {
    await server.close();
  });

  describe("core lifecycle", () => {
    test("creates server with custom name", () => {
      expect(server).toBeDefined();
    });

    test("connect returns a client", async () => {
      const client = await server.connect();
      expect(client).toBeDefined();
    });

    test("connect is idempotent — returns same client", async () => {
      const client1 = await server.connect();
      const client2 = await server.connect();
      expect(client1).toBe(client2);
    });

    test("getClient throws before connect", () => {
      expect(() => server.getClient()).toThrow("not connected");
    });

    test("getClient returns client after connect", async () => {
      await server.connect();
      expect(server.getClient()).toBeDefined();
    });

    test("close resets connection state", async () => {
      await server.connect();
      await server.close();
      expect(() => server.getClient()).toThrow("not connected");
    });
  });

  describe("tool registration and calling", () => {
    test("registers and calls a tool without schema", async () => {
      server.registerMockTool({ name: "simple_tool" });
      const client = await server.connect();
      const result = await client.callTool({
        name: "simple_tool",
        arguments: {},
      });
      expect(result.content).toBeDefined();
      expect(server.getCallCount("simple_tool")).toBe(1);
    });

    test("registers and calls a tool with schema", async () => {
      server.registerMockTool({
        name: "typed_tool",
        inputSchema: { message: z.string() },
        handler: (args) => ({ echo: args.message }),
      });
      const client = await server.connect();
      const result = await client.callTool({
        name: "typed_tool",
        arguments: { message: "hello" },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.echo).toBe("hello");
    });

    test("default handler returns success", async () => {
      server.registerMockTool({ name: "default_handler" });
      const client = await server.connect();
      const result = await client.callTool({
        name: "default_handler",
        arguments: {},
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.success).toBe(true);
    });

    test("custom handler receives args", async () => {
      let receivedArgs: Record<string, unknown> = {};
      server.registerMockTool({
        name: "capture_tool",
        inputSchema: { x: z.number(), y: z.number() },
        handler: (args) => {
          receivedArgs = args;
          return { sum: (args.x as number) + (args.y as number) };
        },
      });
      const client = await server.connect();
      await client.callTool({
        name: "capture_tool",
        arguments: { x: 3, y: 4 },
      });
      expect(receivedArgs.x).toBe(3);
      expect(receivedArgs.y).toBe(4);
    });

    test("async handler works", async () => {
      server.registerMockTool({
        name: "async_tool",
        handler: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { delayed: true };
        },
      });
      const client = await server.connect();
      const result = await client.callTool({
        name: "async_tool",
        arguments: {},
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.delayed).toBe(true);
    });
  });

  describe("call tracking", () => {
    test("getCallCount returns 0 for uncalled tool", () => {
      expect(server.getCallCount("nonexistent")).toBe(0);
    });

    test("getCallCount tracks multiple calls", async () => {
      server.registerMockTool({ name: "counter_tool" });
      const client = await server.connect();
      await client.callTool({ name: "counter_tool", arguments: {} });
      await client.callTool({ name: "counter_tool", arguments: {} });
      await client.callTool({ name: "counter_tool", arguments: {} });
      expect(server.getCallCount("counter_tool")).toBe(3);
    });

    test("getAllCalls returns call details", async () => {
      server.registerMockTool({
        name: "detail_tool",
        inputSchema: { val: z.string() },
      });
      const client = await server.connect();
      await client.callTool({ name: "detail_tool", arguments: { val: "a" } });
      await client.callTool({ name: "detail_tool", arguments: { val: "b" } });
      const calls = server.getAllCalls("detail_tool");
      expect(calls).toHaveLength(2);
      expect(calls[0].args.val).toBe("a");
      expect(calls[1].args.val).toBe("b");
    });

    test("getAllCalls returns empty for unknown tool", () => {
      expect(server.getAllCalls("unknown")).toHaveLength(0);
    });

    test("getCallSequence returns ordered calls across tools", async () => {
      server.registerMockTool({ name: "tool_a" });
      server.registerMockTool({ name: "tool_b" });
      server.registerMockTool({ name: "tool_c" });
      const client = await server.connect();
      await client.callTool({ name: "tool_a", arguments: {} });
      await client.callTool({ name: "tool_b", arguments: {} });
      await client.callTool({ name: "tool_c", arguments: {} });
      const seq = server.getCallSequence();
      expect(seq).toHaveLength(3);
      expect(seq[0].toolName).toBe("tool_a");
      expect(seq[1].toolName).toBe("tool_b");
      expect(seq[2].toolName).toBe("tool_c");
    });

    test("getCallOrder returns tool names in sequence", async () => {
      server.registerMockTool({ name: "first" });
      server.registerMockTool({ name: "second" });
      const client = await server.connect();
      await client.callTool({ name: "first", arguments: {} });
      await client.callTool({ name: "second", arguments: {} });
      expect(server.getCallOrder()).toEqual(["first", "second"]);
    });

    test("getLastCall returns last call for a tool", async () => {
      server.registerMockTool({
        name: "multi_tool",
        inputSchema: { n: z.number() },
      });
      const client = await server.connect();
      await client.callTool({ name: "multi_tool", arguments: { n: 1 } });
      await client.callTool({ name: "multi_tool", arguments: { n: 2 } });
      const last = server.getLastCall("multi_tool");
      expect(last?.args.n).toBe(2);
    });

    test("getLastCall returns undefined for uncalled tool", () => {
      expect(server.getLastCall("nope")).toBeUndefined();
    });

    test("calls have timestamps", async () => {
      server.registerMockTool({ name: "time_tool" });
      const client = await server.connect();
      const before = Date.now();
      await client.callTool({ name: "time_tool", arguments: {} });
      const after = Date.now();
      const call = server.getLastCall("time_tool");
      expect(call?.timestamp).toBeGreaterThanOrEqual(before);
      expect(call?.timestamp).toBeLessThanOrEqual(after);
    });

    test("calls have sequence indices", async () => {
      server.registerMockTool({ name: "seq_a" });
      server.registerMockTool({ name: "seq_b" });
      const client = await server.connect();
      await client.callTool({ name: "seq_a", arguments: {} });
      await client.callTool({ name: "seq_b", arguments: {} });
      const calls = server.getCallSequence();
      expect(calls[0].sequenceIndex).toBe(0);
      expect(calls[1].sequenceIndex).toBe(1);
    });

    test("calls capture result", async () => {
      server.registerMockTool({
        name: "result_tool",
        handler: () => ({ value: 42 }),
      });
      const client = await server.connect();
      await client.callTool({ name: "result_tool", arguments: {} });
      const call = server.getLastCall("result_tool");
      expect(call?.result).toEqual({ value: 42 });
    });
  });

  describe("reset", () => {
    test("reset clears all calls", async () => {
      server.registerMockTool({ name: "reset_tool" });
      const client = await server.connect();
      await client.callTool({ name: "reset_tool", arguments: {} });
      expect(server.getCallCount("reset_tool")).toBe(1);
      server.reset();
      expect(server.getCallCount("reset_tool")).toBe(0);
      expect(server.getCallSequence()).toHaveLength(0);
    });

    test("reset resets sequence counter", async () => {
      server.registerMockTool({ name: "idx_tool" });
      const client = await server.connect();
      await client.callTool({ name: "idx_tool", arguments: {} });
      server.reset();
      await client.callTool({ name: "idx_tool", arguments: {} });
      expect(server.getLastCall("idx_tool")?.sequenceIndex).toBe(0);
    });
  });
});

describe("custom matchers", () => {
  let server: MockMcpServer;

  beforeEach(() => {
    server = new MockMcpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  test("toHaveCalledBefore — passes when called in correct order", async () => {
    server.registerMockTool({ name: "create" });
    server.registerMockTool({ name: "merge" });
    const client = await server.connect();
    await client.callTool({ name: "create", arguments: {} });
    await client.callTool({ name: "merge", arguments: {} });
    expect(server).toHaveCalledBefore("create", "merge");
  });

  test("toHaveCalledBefore — fails when reversed", async () => {
    server.registerMockTool({ name: "create" });
    server.registerMockTool({ name: "merge" });
    const client = await server.connect();
    await client.callTool({ name: "merge", arguments: {} });
    await client.callTool({ name: "create", arguments: {} });
    expect(() =>
      expect(server).toHaveCalledBefore("create", "merge"),
    ).toThrow();
  });

  test("toHaveCalledInOrder — passes for correct sequence", async () => {
    server.registerMockTool({ name: "a" });
    server.registerMockTool({ name: "b" });
    server.registerMockTool({ name: "c" });
    const client = await server.connect();
    await client.callTool({ name: "a", arguments: {} });
    await client.callTool({ name: "b", arguments: {} });
    await client.callTool({ name: "c", arguments: {} });
    expect(server).toHaveCalledInOrder(["a", "b", "c"]);
  });

  test("toHaveCalledInOrder — allows gaps", async () => {
    server.registerMockTool({ name: "a" });
    server.registerMockTool({ name: "b" });
    server.registerMockTool({ name: "c" });
    const client = await server.connect();
    await client.callTool({ name: "a", arguments: {} });
    await client.callTool({ name: "b", arguments: {} });
    await client.callTool({ name: "c", arguments: {} });
    expect(server).toHaveCalledInOrder(["a", "c"]);
  });

  test("toHaveCalledInOrder — fails for wrong order", async () => {
    server.registerMockTool({ name: "a" });
    server.registerMockTool({ name: "b" });
    const client = await server.connect();
    await client.callTool({ name: "b", arguments: {} });
    await client.callTool({ name: "a", arguments: {} });
    expect(() => expect(server).toHaveCalledInOrder(["a", "b"])).toThrow();
  });

  test("toHaveCalledToolCount — passes for correct count", async () => {
    server.registerMockTool({ name: "counted" });
    const client = await server.connect();
    await client.callTool({ name: "counted", arguments: {} });
    await client.callTool({ name: "counted", arguments: {} });
    expect(server).toHaveCalledToolCount("counted", 2);
  });

  test("toHaveCalledToolCount — fails for wrong count", async () => {
    server.registerMockTool({ name: "counted" });
    const client = await server.connect();
    await client.callTool({ name: "counted", arguments: {} });
    expect(() => expect(server).toHaveCalledToolCount("counted", 5)).toThrow();
  });

  test("toHaveCalledWithArgs — passes for matching args", async () => {
    server.registerMockTool({
      name: "arg_tool",
      inputSchema: { key: z.string() },
    });
    const client = await server.connect();
    await client.callTool({ name: "arg_tool", arguments: { key: "val" } });
    expect(server).toHaveCalledWithArgs("arg_tool", { key: "val" });
  });

  test("toHaveCalledWithArgs — passes for partial match", async () => {
    server.registerMockTool({
      name: "multi_arg",
      inputSchema: { a: z.string(), b: z.number() },
    });
    const client = await server.connect();
    await client.callTool({ name: "multi_arg", arguments: { a: "x", b: 5 } });
    expect(server).toHaveCalledWithArgs("multi_arg", { a: "x" });
  });

  test("toHaveCalledWithArgs — fails for non-matching args", async () => {
    server.registerMockTool({
      name: "arg_check",
      inputSchema: { key: z.string() },
    });
    const client = await server.connect();
    await client.callTool({ name: "arg_check", arguments: { key: "actual" } });
    expect(() =>
      expect(server).toHaveCalledWithArgs("arg_check", { key: "expected" }),
    ).toThrow();
  });

  test("toHaveCalledWithArgs — fails for uncalled tool", () => {
    expect(() =>
      expect(server).toHaveCalledWithArgs("never_called", { key: "val" }),
    ).toThrow();
  });
});
