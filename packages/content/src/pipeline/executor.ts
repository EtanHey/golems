/**
 * Pipeline executor — runs pipeline steps from routing results.
 *
 * Supports single-pipeline and multi-pipeline execution.
 * Each step produces output that can feed into the next step.
 */

import { getRegistry } from "./registry";
import type { PipelineStep, RoutingResult } from "./router";
import { logPipelineRun } from "./tracker";

export interface ExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Output file paths (one per step) */
  outputs: StepOutput[];
  /** Total execution time in ms */
  totalDurationMs: number;
  /** Error message if failed */
  error?: string;
}

export interface StepOutput {
  pipelineId: string;
  outputPath?: string;
  outputBase64?: string;
  mimeType: string;
  durationMs: number;
  qualityScore?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext {
  /** Project name for brand styling */
  project?: string;
  /** Output directory override */
  outputDir?: string;
  /** Render service URL (default: http://localhost:3001) */
  serviceUrl?: string;
  /** Whether to log the run to tracker */
  trackRun?: boolean;
}

const DEFAULT_SERVICE_URL = "http://localhost:3001";

/** Execute a routing result — runs all pipeline steps in sequence. */
export async function executePlan(
  plan: RoutingResult,
  context: ExecutionContext = {},
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const outputs: StepOutput[] = [];
  const serviceUrl = context.serviceUrl ?? DEFAULT_SERVICE_URL;

  if (!plan.success || plan.steps.length === 0) {
    return {
      success: false,
      outputs: [],
      totalDurationMs: 0,
      error: "No valid pipeline steps in plan",
    };
  }

  for (const step of plan.steps) {
    try {
      const stepStart = Date.now();
      const output = await executeStep(step, serviceUrl, context, outputs);
      output.durationMs = Date.now() - stepStart;
      outputs.push(output);
    } catch (err) {
      const error = `Step ${step.pipelineId} failed: ${(err as Error).message}`;
      // Log failed run
      if (context.trackRun !== false) {
        try {
          await logPipelineRun({
            pipelineId: step.pipelineId,
            idea: step.input,
            ideaType: classifyIdeaType(step.input),
            success: false,
            durationMs: Date.now() - startTime,
            error,
          });
        } catch {
          // Don't fail execution because of tracking failure
        }
      }
      return {
        success: false,
        outputs,
        totalDurationMs: Date.now() - startTime,
        error,
      };
    }
  }

  // Log successful run
  if (context.trackRun !== false) {
    const lastStep = plan.steps[plan.steps.length - 1];
    try {
      await logPipelineRun({
        pipelineId: plan.isMultiPipeline
          ? plan.steps.map((s) => s.pipelineId).join("+")
          : lastStep.pipelineId,
        idea: plan.steps[0].input,
        ideaType: classifyIdeaType(plan.steps[0].input),
        success: true,
        durationMs: Date.now() - startTime,
        qualityScore: outputs[outputs.length - 1]?.qualityScore,
        outputFormat: lastStep.outputFormat,
      });
    } catch {
      // Don't fail execution because of tracking failure
    }
  }

  return {
    success: true,
    outputs,
    totalDurationMs: Date.now() - startTime,
  };
}

/** Execute a single pipeline step via render service. */
async function executeStep(
  step: PipelineStep,
  serviceUrl: string,
  context: ExecutionContext,
  previousOutputs: StepOutput[],
): Promise<StepOutput> {
  const registry = getRegistry();
  const pipeline = registry.get(step.pipelineId);

  if (!pipeline) {
    throw new Error(`Pipeline not found: ${step.pipelineId}`);
  }

  if (!pipeline.endpoint) {
    throw new Error(`Pipeline ${step.pipelineId} has no endpoint`);
  }

  // Build request body based on pipeline type
  const body = buildRequestBody(step, context, previousOutputs);

  const response = await fetch(`${serviceUrl}${pipeline.endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(
      `${step.pipelineId} returned ${response.status}: ${(error as Record<string, string>).error ?? "Unknown"}`,
    );
  }

  const result = (await response.json()) as Record<string, unknown>;

  return {
    pipelineId: step.pipelineId,
    outputPath: result.outputPath as string | undefined,
    outputBase64: result.imageBase64 as string | undefined,
    mimeType: getMimeType(step.outputFormat),
    durationMs: 0, // Set by caller
    qualityScore: result.qualityPassed ? 1 : undefined,
    metadata: {
      ...result,
      imageBase64: undefined, // Don't duplicate large data
    },
  };
}

/** Build the HTTP request body for a pipeline step. */
function buildRequestBody(
  step: PipelineStep,
  context: ExecutionContext,
  previousOutputs: StepOutput[],
): Record<string, unknown> {
  const params = { ...step.params };

  switch (step.pipelineId) {
    case "comfyui":
      return {
        prompt: step.input,
        style: params.style ?? "social",
        quality: params.quality ?? "social",
        quick: params.quick ?? false,
        maxRetries: params.maxRetries ?? 3,
      };

    case "remotion":
      return {
        compositionId: params.compositionId ?? "CodeShowcase",
        inputProps: {
          ...(params.inputProps as Record<string, unknown> ?? {}),
        },
        outputPath: context.outputDir
          ? `${context.outputDir}/${step.pipelineId}-output.mp4`
          : undefined,
      };

    case "dataviz":
      return {
        type: params.type ?? "jobs",
        format: params.format ?? "linkedin",
        project: context.project,
      };

    default:
      return {
        input: step.input,
        ...params,
      };
  }
}

function getMimeType(format: string): string {
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    gif: "image/gif",
    png: "image/png",
    svg: "image/svg+xml",
    jpg: "image/jpeg",
    webp: "image/webp",
    pdf: "application/pdf",
  };
  return mimeTypes[format] ?? "application/octet-stream";
}

/** Classify idea into a high-level type for tracking. */
function classifyIdeaType(idea: string): string {
  const lower = idea.toLowerCase();
  if (/data|chart|stats|metric|report/.test(lower)) return "data-viz";
  if (/anim|video|demo|showcase|motion/.test(lower)) return "animation";
  if (/meme|merch|design|art|illustrat/.test(lower)) return "image-gen";
  if (/brand|card|template|text/.test(lower)) return "branded-template";
  return "general";
}
