/**
 * Render Service — programmatic video/still rendering via @remotion/renderer.
 *
 * Wraps Remotion's renderMedia and renderStill with job tracking,
 * progress callbacks, and brand-aware defaults.
 */

import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import path from "path";
import { loadBrandConfig } from "../brand/schema";
import { brandConfigToColors, getAnimationDefaults } from "../remotion/lib/brand-bridge";
import type { BrandColors } from "../remotion/lib/types";

// --- Types ---

export type RenderFormat = "mp4" | "webm" | "gif" | "png";

export type PlatformPreset = "youtube" | "linkedin" | "gif";

export type RenderJobStatus = "queued" | "bundling" | "rendering" | "done" | "failed";

export type RenderJob = {
  id: string;
  compositionId: string;
  status: RenderJobStatus;
  progress: number;
  outputPath?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
};

export type RenderOptions = {
  /** Composition ID (must be registered in Root.tsx) */
  compositionId: string;
  /** Input props for the composition */
  inputProps?: Record<string, unknown>;
  /** Output file path */
  outputPath: string;
  /** Output format */
  format?: RenderFormat;
  /** Video codec (for mp4/webm) */
  codec?: "h264" | "vp8" | "vp9";
  /** Quality (0-100 for images, CRF for video — lower = better) */
  quality?: number;
  /** For GIF: render every Nth frame */
  everyNthFrame?: number;
  /** Progress callback */
  onProgress?: (progress: number) => void;
};

export type StillOptions = {
  compositionId: string;
  inputProps?: Record<string, unknown>;
  outputPath: string;
  /** Frame number to capture */
  frame?: number;
  /** Image format */
  format?: "png" | "jpeg" | "webp";
};

// --- Paths ---

const REMOTION_ROOT = path.resolve(__dirname, "../../remotion");
const REMOTION_ENTRY = path.join(REMOTION_ROOT, "src/index.ts");

// --- Job Tracking ---

const jobs = new Map<string, RenderJob>();

function createJobId(): string {
  return `render-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function getJob(id: string): RenderJob | undefined {
  return jobs.get(id);
}

export function listJobs(): RenderJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
}

// --- Bundle Cache ---

let bundleLocation: string | null = null;

async function ensureBundle(): Promise<string> {
  if (bundleLocation) return bundleLocation;

  bundleLocation = await bundle({
    entryPoint: REMOTION_ENTRY,
    // Disable webpack caching in dev for fresh builds
    webpackOverride: (config) => config,
  });

  return bundleLocation;
}

/** Clear the cached bundle (forces rebuild on next render) */
export function clearBundleCache(): void {
  bundleLocation = null;
}

// --- Render Functions ---

/**
 * Render a video/GIF from a composition.
 */
export async function renderVideo(opts: RenderOptions): Promise<RenderJob> {
  const jobId = createJobId();
  const job: RenderJob = {
    id: jobId,
    compositionId: opts.compositionId,
    status: "queued",
    progress: 0,
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);

  try {
    // Bundle
    job.status = "bundling";
    const bundled = await ensureBundle();

    // Select composition
    const composition = await selectComposition({
      serveUrl: bundled,
      id: opts.compositionId,
      inputProps: opts.inputProps ?? {},
    });

    // Determine codec
    const codec = opts.format === "gif" ? "gif"
      : opts.format === "webm" ? (opts.codec ?? "vp8")
      : (opts.codec ?? "h264");

    // Render
    job.status = "rendering";
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: codec as any,
      outputLocation: opts.outputPath,
      inputProps: opts.inputProps ?? {},
      everyNthFrame: opts.everyNthFrame ?? (opts.format === "gif" ? 2 : 1),
      onProgress: ({ progress }) => {
        job.progress = Math.round(progress * 100);
        opts.onProgress?.(job.progress);
      },
    });

    job.status = "done";
    job.progress = 100;
    job.outputPath = opts.outputPath;
    job.completedAt = Date.now();
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
  }

  return job;
}

/**
 * Render a single frame (thumbnail/still).
 */
export async function renderThumbnail(opts: StillOptions): Promise<RenderJob> {
  const jobId = createJobId();
  const job: RenderJob = {
    id: jobId,
    compositionId: opts.compositionId,
    status: "queued",
    progress: 0,
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);

  try {
    job.status = "bundling";
    const bundled = await ensureBundle();

    const composition = await selectComposition({
      serveUrl: bundled,
      id: opts.compositionId,
      inputProps: opts.inputProps ?? {},
    });

    job.status = "rendering";
    await renderStill({
      composition,
      serveUrl: bundled,
      output: opts.outputPath,
      frame: opts.frame ?? 60,
      inputProps: opts.inputProps ?? {},
      imageFormat: opts.format ?? "png",
    });

    job.status = "done";
    job.progress = 100;
    job.outputPath = opts.outputPath;
    job.completedAt = Date.now();
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
  }

  return job;
}

/**
 * Build brand-aware input props for a composition.
 * Loads brand.json from a project and converts to BrandColors.
 */
export async function buildBrandProps(
  projectPath: string,
): Promise<{ brand: BrandColors; animationDefaults: ReturnType<typeof getAnimationDefaults> } | null> {
  const { config, errors } = await loadBrandConfig(projectPath);
  if (errors.length > 0) {
    console.error("Brand config errors:", errors);
    return null;
  }

  return {
    brand: brandConfigToColors(config),
    animationDefaults: getAnimationDefaults(config),
  };
}
