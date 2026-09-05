/**
 * Flux GGUF workflow templates for ComfyUI.
 *
 * Creates prompt-ready JSON workflows for Flux.1 Dev Q6_K GGUF
 * with various output styles (social, merch, meme).
 *
 * IMPORTANT: These use GGUF-specific nodes (UnetLoaderGGUF, DualCLIPLoaderGGUF)
 * from ComfyUI-GGUF, NOT standard CheckpointLoaderSimple.
 */

import type { BrandConfig } from "../../brand/schema";

// --- Types ---

export type FluxWorkflowOptions = {
  /** Text prompt */
  prompt: string;
  /** Negative prompt (Flux uses CFG guidance, not negative) */
  negativePrompt?: string;
  /** Output width */
  width?: number;
  /** Output height */
  height?: number;
  /** Number of steps (default: 25) */
  steps?: number;
  /** CFG scale (Flux works best at 1.0-3.5) */
  cfg?: number;
  /** Sampler (default: euler) */
  sampler?: string;
  /** Scheduler (default: simple) */
  scheduler?: string;
  /** Random seed (default: random) */
  seed?: number;
  /** Enable TeaCache acceleration */
  teaCache?: boolean;
  /** TeaCache threshold (0.2-0.4, lower = higher quality) */
  teaCacheThreshold?: number;
  /** Brand config for prompt prefix injection */
  brand?: BrandConfig;
};

export type FluxWorkflowStyle = "base" | "social" | "merch" | "meme";

// --- Model Paths ---

const MODELS = {
  unet: "flux1-dev-Q6_K.gguf",
  clip_l: "clip_l.safetensors",
  t5xxl: "t5-v1_1-xxl-encoder-Q4_K_M.gguf",
  vae: "ae.safetensors",
} as const;

// --- Workflow Builders ---

/**
 * Build a prompt prefix from brand config.
 * Injects brand tone, style, and color palette into the prompt.
 */
function buildBrandPrefix(brand?: BrandConfig): string {
  if (!brand) return "";

  const parts: string[] = [];

  if (brand.tone) {
    parts.push(`${brand.tone} style`);
  }

  if (brand.colors) {
    const palette = [
      brand.colors.primary,
      brand.colors.secondary,
      brand.colors.accent,
    ]
      .filter(Boolean)
      .join(", ");
    if (palette) {
      parts.push(`color palette: ${palette}`);
    }
  }

  return parts.length > 0 ? `${parts.join(", ")}. ` : "";
}

/**
 * Create a base Flux GGUF workflow.
 * This is the core workflow — all styles build on top of this.
 */
export function createFluxBaseWorkflow(
  opts: FluxWorkflowOptions,
): Record<string, unknown> {
  const width = opts.width ?? 768;
  const height = opts.height ?? 768;
  const steps = opts.steps ?? 25;
  const cfg = opts.cfg ?? 1.0;
  const sampler = opts.sampler ?? "euler";
  const scheduler = opts.scheduler ?? "simple";
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);

  const brandPrefix = buildBrandPrefix(opts.brand);
  const fullPrompt = `${brandPrefix}${opts.prompt}`;

  const workflow: Record<string, unknown> = {
    // Load Flux GGUF model
    "1": {
      class_type: "UnetLoaderGGUF",
      inputs: {
        unet_name: MODELS.unet,
      },
    },
    // Load dual CLIP (CLIP-L + T5-XXL)
    "2": {
      class_type: "DualCLIPLoaderGGUF",
      inputs: {
        clip_name1: MODELS.clip_l,
        clip_name2: MODELS.t5xxl,
        type: "flux",
      },
    },
    // Load VAE
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: MODELS.vae,
      },
    },
    // Positive prompt encoding
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: fullPrompt,
        clip: ["2", 0],
      },
    },
    // Empty latent
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    },
    // KSampler
    "6": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["4", 0], // Flux doesn't use negative — reuse positive
        latent_image: ["5", 0],
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1.0,
      },
    },
    // VAE Decode
    "7": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["6", 0],
        vae: ["3", 0],
      },
    },
    // Save Image
    "8": {
      class_type: "SaveImage",
      inputs: {
        images: ["7", 0],
        filename_prefix: "flux_gen",
      },
    },
  };

  return workflow;
}

/**
 * Social media workflow — 1080x1080 square, optimized for Instagram/LinkedIn.
 */
export function createFluxSocialWorkflow(
  opts: Omit<FluxWorkflowOptions, "width" | "height">,
): Record<string, unknown> {
  return createFluxBaseWorkflow({
    ...opts,
    width: 1080,
    height: 1080,
    steps: opts.steps ?? 25,
    cfg: opts.cfg ?? 1.0,
  });
}

/**
 * Merch workflow — high-res 1024x1024, optimized for print.
 * Will be upscaled 4x to 4096x4096 by the upscaling pipeline.
 */
export function createFluxMerchWorkflow(
  opts: Omit<FluxWorkflowOptions, "width" | "height">,
): Record<string, unknown> {
  return createFluxBaseWorkflow({
    ...opts,
    width: 1024,
    height: 1024,
    steps: opts.steps ?? 30, // More steps for print quality
    cfg: opts.cfg ?? 1.5,
  });
}

/**
 * Meme workflow — landscape 1280x720, quick generation.
 */
export function createFluxMemeWorkflow(
  opts: Omit<FluxWorkflowOptions, "width" | "height">,
): Record<string, unknown> {
  return createFluxBaseWorkflow({
    ...opts,
    width: 1280,
    height: 720,
    steps: opts.steps ?? 20,
    cfg: opts.cfg ?? 1.0,
  });
}

/**
 * Quick draft workflow — 512x512, TeaCache enabled, minimal steps.
 * For fast iteration before committing to full quality.
 */
export function createFluxDraftWorkflow(
  opts: Omit<FluxWorkflowOptions, "width" | "height" | "teaCache">,
): Record<string, unknown> {
  return createFluxBaseWorkflow({
    ...opts,
    width: 512,
    height: 512,
    steps: opts.steps ?? 15,
    cfg: opts.cfg ?? 1.0,
    teaCache: true,
    teaCacheThreshold: opts.teaCacheThreshold ?? 0.3,
  });
}

/**
 * Get a workflow builder by style name.
 */
export function getWorkflowForStyle(
  style: FluxWorkflowStyle,
): (opts: FluxWorkflowOptions) => Record<string, unknown> {
  switch (style) {
    case "social":
      return createFluxSocialWorkflow;
    case "merch":
      return createFluxMerchWorkflow;
    case "meme":
      return createFluxMemeWorkflow;
    case "base":
    default:
      return createFluxBaseWorkflow;
  }
}
