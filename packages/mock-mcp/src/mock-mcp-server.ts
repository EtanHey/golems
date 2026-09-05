import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z, type ZodRawShape } from "zod";

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
  sequenceIndex: number;
  result?: unknown;
}

export interface MockToolConfig {
  name: string;
  description?: string;
  inputSchema?: ZodRawShape;
  handler?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * Mock MCP server for behavioral testing. Wraps the real MCP SDK
 * InMemoryTransport to intercept and record tool calls.
 */
export class MockMcpServer {
  private mcpServer: McpServer;
  private client: Client | null = null;
  private calls: ToolCall[] = [];
  private sequenceCounter = 0;
  private connected = false;

  constructor(
    private serverName = "mock-mcp-server",
    private serverVersion = "0.1.0",
  ) {
    this.mcpServer = new McpServer(
      { name: this.serverName, version: this.serverVersion },
      { capabilities: { tools: {} } },
    );
  }

  /**
   * Register a mock tool with optional schema and handler.
   * If no handler is provided, returns a default success response.
   */
  registerMockTool(config: MockToolConfig): void {
    const { name, description, inputSchema, handler } = config;
    const wrappedHandler = async (args: Record<string, unknown>) => {
      const call: ToolCall = {
        toolName: name,
        args: { ...args },
        timestamp: Date.now(),
        sequenceIndex: this.sequenceCounter++,
      };

      let result: unknown;
      if (handler) {
        result = await handler(args);
      } else {
        result = { success: true };
      }
      call.result = result;
      this.calls.push(call);

      const textContent =
        typeof result === "string" ? result : JSON.stringify(result);
      return { content: [{ type: "text" as const, text: textContent }] };
    };

    if (inputSchema) {
      this.mcpServer.tool(
        name,
        description ?? `Mock tool: ${name}`,
        inputSchema,
        (args) => wrappedHandler(args as Record<string, unknown>),
      );
    } else {
      this.mcpServer.tool(name, description ?? `Mock tool: ${name}`, (extra) =>
        wrappedHandler({}),
      );
    }
  }

  /**
   * Connect the mock server to an in-memory client.
   * Returns the Client instance for making tool calls.
   */
  async connect(): Promise<Client> {
    if (this.connected && this.client) return this.client;

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    this.client = new Client(
      { name: "mock-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await this.mcpServer.connect(serverTransport);
    await this.client.connect(clientTransport);
    this.connected = true;

    return this.client;
  }

  /** Get the connected client (throws if not connected). */
  getClient(): Client {
    if (!this.client)
      throw new Error("MockMcpServer not connected. Call connect() first.");
    return this.client;
  }

  /** Get the number of times a tool was called. */
  getCallCount(toolName: string): number {
    return this.calls.filter((c) => c.toolName === toolName).length;
  }

  /** Get all calls for a specific tool. */
  getAllCalls(toolName: string): ToolCall[] {
    return this.calls.filter((c) => c.toolName === toolName);
  }

  /** Get the full call sequence in order. */
  getCallSequence(): ToolCall[] {
    return [...this.calls].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  }

  /** Get tool names in call order. */
  getCallOrder(): string[] {
    return this.getCallSequence().map((c) => c.toolName);
  }

  /** Get the last call for a specific tool. */
  getLastCall(toolName: string): ToolCall | undefined {
    const calls = this.getAllCalls(toolName);
    return calls[calls.length - 1];
  }

  /** Reset all recorded calls and sequence counter. */
  reset(): void {
    this.calls = [];
    this.sequenceCounter = 0;
  }

  /** Close the server and client connections. */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    await this.mcpServer.close();
    this.client = null;
    this.connected = false;
  }
}
