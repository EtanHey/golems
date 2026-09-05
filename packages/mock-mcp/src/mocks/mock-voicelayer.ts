import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MockMcpServer } from "../mock-mcp-server";

/**
 * Mock VoiceLayer MCP server tools: voice_speak, voice_ask.
 * Simulates the voice I/O interface.
 */

export function createMockVoicelayer(server: McpServer): void {
  server.tool(
    "voice_speak",
    "Speak text using text-to-speech",
    {
      text: z.string().describe("Text to speak"),
      voice: z.string().optional().describe("Voice name/ID"),
      speed: z.number().optional().describe("Speech speed multiplier"),
    },
    async (args) => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              spoken: true,
              text: args.text,
              voice: args.voice ?? "default",
              duration_ms: args.text.length * 50,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "voice_ask",
    "Ask a question and listen for a voice response",
    {
      prompt: z.string().describe("Question to ask"),
      timeout_ms: z.number().optional().describe("Listen timeout in ms"),
      language: z
        .string()
        .optional()
        .describe("Expected language (e.g. he, en)"),
    },
    async (args) => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              heard: true,
              transcript: `Mock response to: ${args.prompt}`,
              confidence: 0.95,
              language: args.language ?? "en",
            }),
          },
        ],
      };
    },
  );
}

/**
 * Register VoiceLayer mock tools on a MockMcpServer instance.
 */
export function registerVoicelayerMocks(mock: MockMcpServer): void {
  mock.registerMockTool({
    name: "voice_speak",
    description: "Speak text using TTS",
    inputSchema: {
      text: z.string(),
      voice: z.string().optional(),
      speed: z.number().optional(),
    },
    handler: (args) => ({
      spoken: true,
      text: args.text,
      voice: args.voice ?? "default",
      duration_ms: (args.text as string).length * 50,
    }),
  });

  mock.registerMockTool({
    name: "voice_ask",
    description: "Ask and listen for voice response",
    inputSchema: {
      prompt: z.string(),
      timeout_ms: z.number().optional(),
      language: z.string().optional(),
    },
    handler: (args) => ({
      heard: true,
      transcript: `Mock response to: ${args.prompt}`,
      confidence: 0.95,
      language: args.language ?? "en",
    }),
  });
}
