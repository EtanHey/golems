/**
 * Pipeline router — AI-powered idea → pipeline selection.
 *
 * Takes a creative idea (text description) and uses LLM to select
 * the best pipeline(s) from the registry. Supports multi-pipeline
 * combinations for complex ideas.
 */

import { runLLMJSON } from "@golems/shared/lib/llm";
import { getRegistry, getRegistryForPrompt } from "./registry";
import type { PipelineCapability, OutputFormat } from "./registry";
import { getPerformanceStats, type PipelineStats } from "./tracker";

export interface RoutingRequest {
  /** The creative idea to route */
  idea: string;
  /** Preferred output format (optional — AI will choose if not specified) */
  preferredFormat?: OutputFormat;
  /** Project name for brand context */
  project?: string;
  /** Whether to allow multi-pipeline combinations */
  allowMulti?: boolean;
}

export interface PipelineStep {
  /** Pipeline ID from registry */
  pipelineId: string;
  /** Why this pipeline was chosen */
  reason: string;
  /** Input to this step (for multi-pipeline, may reference previous step output) */
  input: string;
  /** Expected output format */
  outputFormat: OutputFormat;
  /** Pipeline-specific parameters */
  params: Record<string, unknown>;
}

export interface RoutingResult {
  /** Whether a suitable pipeline was found */
  success: boolean;
  /** Ordered list of pipeline steps to execute */
  steps: PipelineStep[];
  /** Overall reasoning for the routing decision */
  reasoning: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether this is a multi-pipeline combination */
  isMultiPipeline: boolean;
}

/** Build the system prompt for pipeline routing. */
function buildRoutingPrompt(
  registryJson: string,
  stats: PipelineStats[],
): string {
  let statsContext = "";
  if (stats.length > 0) {
    statsContext = `\n\nPipeline performance history (from past runs):\n${JSON.stringify(
      stats.map((s) => ({
        pipeline: s.pipelineId,
        runs: s.totalRuns,
        avgQuality: s.avgQualityScore,
        successRate: s.successRate,
        topIdeaTypes: s.topIdeaTypes,
      })),
      null,
      2,
    )}`;
  }

  return `You are a content pipeline router. Given a creative idea, select the best pipeline(s) to produce the content.

Available pipelines:
${registryJson}
${statsContext}

Rules:
1. Choose the pipeline that best matches the idea's intent and output needs.
2. For multi-pipeline combinations, order steps so each step's output feeds the next.
3. Set confidence based on how well the idea matches the pipeline's "bestFor" list.
4. If the idea involves data from golems (jobs, finance, brain, activity), prefer "dataviz".
5. If the idea involves AI-generated imagery, prefer "comfyui".
6. If the idea involves animation, code demos, or video, prefer "remotion".
7. For simple text-on-image or branded cards, prefer "dataviz" with stat cards.
8. For multi-pipeline: e.g., generate background with comfyui → animate with remotion.

Respond with JSON only (no markdown, no explanation outside JSON):
{
  "success": true,
  "steps": [
    {
      "pipelineId": "pipeline-id",
      "reason": "why this pipeline",
      "input": "what goes into this step",
      "outputFormat": "png|mp4|gif|svg",
      "params": { "style": "social", "compositionId": "WeeklyJobs", ... }
    }
  ],
  "reasoning": "overall explanation of the routing decision",
  "confidence": 0.85,
  "isMultiPipeline": false
}`;
}

/** Route a creative idea to the best pipeline(s). */
export async function routeIdea(
  request: RoutingRequest,
): Promise<RoutingResult> {
  const registry = getRegistry();
  const registryJson = getRegistryForPrompt();

  // Get performance stats for learning loop context
  let stats: PipelineStats[] = [];
  try {
    stats = await getPerformanceStats();
  } catch {
    // Stats not available — route without history
  }

  const systemPrompt = buildRoutingPrompt(registryJson, stats);

  let userPrompt = `Route this creative idea to the best pipeline:\n\n"${request.idea}"`;

  if (request.preferredFormat) {
    userPrompt += `\n\nPreferred output format: ${request.preferredFormat}`;
  }
  if (request.project) {
    userPrompt += `\nProject: ${request.project} (apply brand styling)`;
  }
  if (request.allowMulti === false) {
    userPrompt += `\nConstraint: Use only a single pipeline (no combinations).`;
  }

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  const result = await runLLMJSON<RoutingResult>(
    fullPrompt,
    "content-pipeline-router",
  );

  if (!result || !result.steps || result.steps.length === 0) {
    return fallbackRoute(request, registry.pipelines);
  }

  // Validate pipeline IDs exist in registry
  for (const step of result.steps) {
    const pipeline = registry.get(step.pipelineId);
    if (!pipeline) {
      return fallbackRoute(request, registry.pipelines);
    }
  }

  return {
    ...result,
    isMultiPipeline: result.steps.length > 1,
  };
}

/** Keyword-based fallback when AI routing fails. */
function fallbackRoute(
  request: RoutingRequest,
  pipelines: PipelineCapability[],
): RoutingResult {
  const idea = request.idea.toLowerCase();

  // Keyword matching
  const dataKeywords = [
    "chart",
    "graph",
    "data",
    "stats",
    "metrics",
    "infographic",
    "report",
    "jobs",
    "finance",
    "brain",
    "activity",
    "weekly",
    "monthly",
  ];
  const videoKeywords = [
    "animate",
    "animation",
    "video",
    "demo",
    "showcase",
    "walkthrough",
    "motion",
  ];
  const imageKeywords = [
    "generate",
    "create image",
    "illustration",
    "meme",
    "merch",
    "design",
    "art",
    "background",
  ];

  let pipelineId = "dataviz";
  let outputFormat: OutputFormat = "png";

  if (videoKeywords.some((kw) => idea.includes(kw))) {
    pipelineId = "remotion";
    outputFormat = "mp4";
  } else if (imageKeywords.some((kw) => idea.includes(kw))) {
    pipelineId = "comfyui";
    outputFormat = "png";
  } else if (dataKeywords.some((kw) => idea.includes(kw))) {
    pipelineId = "dataviz";
    outputFormat = "png";
  }

  if (request.preferredFormat) {
    outputFormat = request.preferredFormat;
  }

  return {
    success: true,
    steps: [
      {
        pipelineId,
        reason: "Fallback keyword-based routing (AI routing unavailable)",
        input: request.idea,
        outputFormat,
        params: {},
      },
    ],
    reasoning: `Keyword match selected ${pipelineId} pipeline.`,
    confidence: 0.5,
    isMultiPipeline: false,
  };
}
