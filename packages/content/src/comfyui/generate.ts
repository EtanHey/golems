/**
 * Image generation pipeline.
 *
 * Ties together ComfyUI client, workflow templates, quality scoring,
 * and brand overlay into a single generate() call.
 *
 * Supports auto-retry with new seeds when quality gates fail.
 */

import { join } from "path";
import {
  enqueueWorkflow,
  isServerReady,
  saveImages,
  type GenerationProgress,
} from "./client";
import {
  createFluxBaseWorkflow,
  createFluxDraftWorkflow,
  getWorkflowForStyle,
  type FluxWorkflowOptions,
  type FluxWorkflowStyle,
} from "./workflows/flux-base";
import {
  scoreImage,
  formatScores,
  getThresholds,
  type QualityPreset,
  type QualityScores,
} from "../quality/scoring";
import type { BrandConfig } from "../brand/schema";

// --- Types ---

export type GenerateOptions = {
  /** Text prompt */
  prompt: string;
  /** Generation style */
  style?: FluxWorkflowStyle;
  /** Brand config for prompt prefix and post-processing */
  brand?: BrandConfig;
  /** Quality preset (social, print, draft) */
  quality?: QualityPreset;
  /** Quick mode — 512x512 draft */
  quick?: boolean;
  /** Output directory */
  outputDir?: string;
  /** Max retry attempts on quality failure (default: 3) */
  maxRetries?: number;
  /** Progress callback */
  onProgress?: (progress: GenerationProgress) => void;
  /** Additional workflow options */
  workflowOptions?: Partial<FluxWorkflowOptions>;
};

export type GenerateResult = {
  /** Path to saved image */
  imagePath: string;
  /** Quality scores */
  scores: QualityScores;
  /** Generation time in ms */
  durationMs: number;
  /** Number of attempts (1 = first try) */
  attempts: number;
  /** Whether the image passed quality gates */
  qualityPassed: boolean;
  /** Formatted score summary */
  scoreSummary: string;
};

// --- Pipeline ---

const DEFAULT_OUTPUT_DIR = join(
  process.env.HOME ?? "/tmp",
  "golems-content",
  "outputs",
);

/**
 * Generate an image with quality gating and auto-retry.
 *
 * Flow:
 * 1. Check ComfyUI server is ready
 * 2. Build workflow from style + brand
 * 3. Queue and wait for generation
 * 4. Save image, run quality scoring
 * 5. If quality fails, retry with new seed (up to maxRetries)
 * 6. Return best result
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  // Check server
  const ready = await isServerReady();
  if (!ready) {
    throw new Error(
      "ComfyUI server not reachable at 127.0.0.1:8188. " +
        "Start it with: launchctl load ~/Library/LaunchAgents/com.golems.comfyui.plist",
    );
  }

  const maxRetries = opts.maxRetries ?? 3;
  const outputDir = opts.outputDir ?? DEFAULT_OUTPUT_DIR;
  const qualityPreset = opts.quality ?? (opts.quick ? "draft" : "social");
  const thresholds = getThresholds(qualityPreset);

  let bestResult: GenerateResult | null = null;
  let bestScore = -Infinity;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const seed = Math.floor(Math.random() * 2 ** 32);

    // Build workflow
    const workflowOpts: FluxWorkflowOptions = {
      prompt: opts.prompt,
      brand: opts.brand,
      seed,
      ...opts.workflowOptions,
    };

    let workflow: Record<string, unknown>;
    if (opts.quick) {
      workflow = createFluxDraftWorkflow(workflowOpts);
    } else {
      const builder = getWorkflowForStyle(opts.style ?? "base");
      workflow = builder(workflowOpts);
    }

    // Generate
    const genStart = Date.now();
    const result = await enqueueWorkflow(workflow, {
      onProgress: opts.onProgress,
    });

    if (result.images.length === 0) {
      console.error(`Attempt ${attempt}: No images generated`);
      continue;
    }

    // Save
    const [imagePath] = await saveImages(
      [result.images[0]],
      outputDir,
      `flux_${opts.style ?? "base"}`,
    );

    // Score
    const scores = await scoreImage(imagePath, opts.prompt, thresholds);
    const durationMs = Date.now() - genStart;

    const candidateResult: GenerateResult = {
      imagePath,
      scores,
      durationMs,
      attempts: attempt,
      qualityPassed: scores.passed,
      scoreSummary: formatScores(scores),
    };

    // Track best result by aesthetic score
    const compositeScore =
      scores.aestheticScore * 0.4 +
      scores.clipScore * 100 * 0.4 -
      scores.brisqueScore * 0.2;

    if (compositeScore > bestScore) {
      bestScore = compositeScore;
      bestResult = candidateResult;
    }

    if (scores.passed) {
      return candidateResult;
    }

    console.log(
      `Attempt ${attempt}/${maxRetries}: Quality gate failed — ${scores.failedGates.join(", ")}`,
    );
  }

  // Return best result even if it didn't pass all gates
  if (bestResult) {
    return bestResult;
  }

  throw new Error(
    `Image generation failed after ${maxRetries} attempts. ComfyUI may be misconfigured.`,
  );
}
