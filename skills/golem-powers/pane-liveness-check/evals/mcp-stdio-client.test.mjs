import { afterEach, expect, test } from "bun:test";

import { McpStdioClient } from "../lib/mcp-stdio-client.mjs";

const clients = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function fakeServer(extra = "") {
  return `
    import readline from "node:readline";
    const rl = readline.createInterface({ input: process.stdin });
    const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
    rl.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
        return;
      }
      if (message.method === "tools/call") {
        ${extra || `send({ jsonrpc: "2.0", id: message.id, result: { structuredContent: { ok: true, tool: message.params.name, arguments: message.params.arguments } } });`}
      }
    });
  `;
}

test("sequential stdio client initializes and returns structured tool content", async () => {
  const client = new McpStdioClient({
    command: process.execPath,
    args: ["--input-type=module", "-e", fakeServer()],
    timeoutMs: 2_000,
  });
  clients.push(client);

  await client.connect();
  const result = await client.callTool("list_surfaces", { verbose: true });
  expect(result).toEqual({ ok: true, tool: "list_surfaces", arguments: { verbose: true } });
});

test("JSON-RPC errors reject with the remote message", async () => {
  const client = new McpStdioClient({
    command: process.execPath,
    args: [
      "--input-type=module",
      "-e",
      fakeServer(`send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "registry poisoned" } });`),
    ],
    timeoutMs: 2_000,
  });
  clients.push(client);

  await client.connect();
  await expect(client.callTool("list_agents", {})).rejects.toThrow("registry poisoned");
});
