/**
 * GLM MCP Server
 *
 * Exposes local LLM (GLM-4.7-Flash via Ollama or MLX) as MCP tools for Claude Code.
 * Tools: glm_summarize, glm_score
 *
 * ENV: GLM_BACKEND=ollama|mlx (default: mlx on arm64, ollama otherwise)
 *
 * Usage in .mcp.json:
 * {
 *   "golems-glm": {
 *     "command": "bun",
 *     "args": ["run", "packages/shared/src/glm/mcp-server.ts"]
 *   }
 * }
 */

import "../lib/load-env";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runGLM, runGLMJSON } from "../lib/glm-llm";
import { runMLX, runMLXJSON } from "../lib/mlx-llm";

// Auto-detect: default to MLX on Apple Silicon (macOS arm64), Ollama otherwise
const isAppleSilicon =
  process.arch === "arm64" && process.platform === "darwin";
const defaultBackend = isAppleSilicon ? "mlx" : "ollama";
const GLM_BACKEND = process.env.GLM_BACKEND || defaultBackend;

// Dispatch with fallback: MLX primary → Ollama fallback on arm64
async function runLocalWithFallback(
  prompt: string,
  source: string,
): Promise<string | null> {
  if (GLM_BACKEND === "mlx") {
    try {
      const result = await runMLX(prompt, source);
      if (result !== null) return result;
    } catch {
      console.error("[golems-glm] MLX failed, falling back to Ollama");
    }
    return runGLM(prompt, source);
  }
  return runGLM(prompt, source);
}

async function runLocalJSONWithFallback<T>(
  prompt: string,
  source: string,
): Promise<T | null> {
  if (GLM_BACKEND === "mlx") {
    try {
      const result = await runMLXJSON<T>(prompt, source);
      if (result !== null) return result;
    } catch {
      console.error("[golems-glm] MLX JSON failed, falling back to Ollama");
    }
    return runGLMJSON<T>(prompt, source);
  }
  return runGLMJSON<T>(prompt, source);
}

const server = new Server(
  { name: "golems-glm", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// --- Tool definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "glm_summarize",
      description:
        "Summarize text using GLM-4.7-Flash. Returns a concise summary in up to N sentences.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The text to summarize",
          },
          maxSentences: {
            type: "number",
            description:
              "Maximum number of sentences in the summary (default: 3)",
            default: 3,
          },
        },
        required: ["text"],
      },
    },
    {
      name: "glm_score",
      description:
        "Score or classify text using GLM-4.7-Flash with structured JSON output. Provide a prompt describing the scoring criteria and a JSON schema for the output shape.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The text to score or classify",
          },
          prompt: {
            type: "string",
            description:
              "Instructions for scoring/classification (what to extract, how to score, etc.)",
          },
          schema: {
            type: "object",
            description:
              "JSON schema object describing the expected output shape (e.g. { score: number, category: string })",
          },
        },
        required: ["text", "prompt", "schema"],
      },
    },
  ],
}));

// --- Tool handlers ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "glm_summarize":
        return await handleSummarize(args);
      case "glm_score":
        return await handleScore(args);
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        };
    }
  } catch (err: unknown) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error in ${name}: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

async function handleSummarize(args: Record<string, unknown> | undefined) {
  const text = args?.text;
  const maxSentences = args?.maxSentences ?? 3;

  if (!text) {
    return {
      content: [{ type: "text" as const, text: "Missing required: text" }],
      isError: true,
    };
  }

  const prompt = `Summarize the following text in at most ${maxSentences} sentences. Be concise and capture the main points.

TEXT:
${text}

SUMMARY:`;

  const summary = await runLocalWithFallback(prompt, "glm-mcp-summarize");

  if (!summary) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Local LLM failed to generate summary. Backend: ${GLM_BACKEND}. Ensure ${GLM_BACKEND === "mlx" ? "MLX server (port 8080) or Ollama (fallback)" : "Ollama"} is running.`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [{ type: "text" as const, text: summary }],
  };
}

async function handleScore(args: Record<string, unknown> | undefined) {
  const {
    text,
    prompt: userPrompt,
    schema,
  } = (args || {}) as {
    text?: string;
    prompt?: string;
    schema?: Record<string, unknown>;
  };

  if (!text) {
    return {
      content: [{ type: "text" as const, text: "Missing required: text" }],
      isError: true,
    };
  }

  if (!userPrompt) {
    return {
      content: [{ type: "text" as const, text: "Missing required: prompt" }],
      isError: true,
    };
  }

  if (!schema || typeof schema !== "object") {
    return {
      content: [
        {
          type: "text" as const,
          text: "Missing required: schema (must be a JSON object)",
        },
      ],
      isError: true,
    };
  }

  const schemaStr = JSON.stringify(schema, null, 2);

  const prompt = `${userPrompt}

TEXT TO SCORE/CLASSIFY:
${text}

Respond with ONLY a JSON object matching this schema. No other text.
SCHEMA:
${schemaStr}

JSON OUTPUT:`;

  const result = await runLocalJSONWithFallback<Record<string, unknown>>(
    prompt,
    "glm-mcp-score",
  );

  if (!result) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Local LLM failed to produce valid JSON. Backend: ${GLM_BACKEND}. Ensure ${GLM_BACKEND === "mlx" ? "MLX server (port 8080) or Ollama (fallback)" : "Ollama"} is running.`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[golems-glm] MCP server running on stdio (backend: ${GLM_BACKEND}, arch: ${process.arch})`,
  );
}

main().catch((err) => {
  console.error("[golems-glm] Fatal:", err);
  process.exit(1);
});
