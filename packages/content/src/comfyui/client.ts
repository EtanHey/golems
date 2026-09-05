/**
 * ComfyUI API client wrapper.
 *
 * Manages connection to local ComfyUI server, workflow queueing,
 * progress tracking, and output retrieval. Uses @stable-canvas/comfyui-client
 * under the hood with Flux-specific defaults.
 */

import { Client } from "@stable-canvas/comfyui-client";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

// --- Types ---

export type ComfyUIConfig = {
  host?: string;
  port?: number;
  /** Use WebSocket for progress tracking (default: true) */
  useWs?: boolean;
};

export type GenerationResult = {
  /** Raw image buffers from ComfyUI */
  images: Buffer[];
  /** Prompt ID for history lookup */
  promptId: string;
  /** Generation time in ms */
  durationMs: number;
  /** Node output metadata */
  metadata?: Record<string, unknown>;
};

export type GenerationProgress = {
  /** Current step */
  value: number;
  /** Total steps */
  max: number;
  /** Progress 0-1 */
  percent: number;
};

export type ProgressCallback = (progress: GenerationProgress) => void;

// --- Client ---

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8188;

let _client: Client | null = null;

/**
 * Get or create the ComfyUI client singleton.
 * Reuses the same connection across calls.
 */
export function getClient(config?: ComfyUIConfig): Client {
  if (_client) return _client;

  const host = config?.host ?? DEFAULT_HOST;
  const port = config?.port ?? DEFAULT_PORT;

  _client = new Client({
    api_host: `${host}:${port}`,
  });

  if (config?.useWs !== false) {
    _client.connect();
  }

  return _client;
}

/**
 * Check if ComfyUI server is reachable.
 */
export async function isServerReady(config?: ComfyUIConfig): Promise<boolean> {
  const host = config?.host ?? DEFAULT_HOST;
  const port = config?.port ?? DEFAULT_PORT;

  try {
    const res = await fetch(`http://${host}:${port}/system_stats`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Queue a workflow prompt and wait for completion.
 * Returns generated images as buffers.
 */
export async function enqueueWorkflow(
  prompt: Record<string, unknown>,
  options?: {
    onProgress?: ProgressCallback;
    config?: ComfyUIConfig;
    /** Timeout in ms (default: 15 minutes) */
    timeout?: number;
  },
): Promise<GenerationResult> {
  const client = getClient(options?.config);
  const start = Date.now();

  const result = await client.enqueue(
    prompt as Parameters<typeof client.enqueue>[0],
    {
      progress: options?.onProgress
        ? ({ max, value }: { max: number; value: number }) => {
            options.onProgress!({
              value,
              max,
              percent: max > 0 ? value / max : 0,
            });
          }
        : undefined,
    },
  );

  const images: Buffer[] = [];
  if (result?.images) {
    for (const img of result.images) {
      if (Buffer.isBuffer(img)) {
        images.push(img);
      } else if (img instanceof Uint8Array) {
        images.push(Buffer.from(img));
      }
    }
  }

  return {
    images,
    promptId: (result as Record<string, unknown>)?.prompt_id as string ?? "unknown",
    durationMs: Date.now() - start,
    metadata: result as Record<string, unknown>,
  };
}

/**
 * Save generated images to disk.
 */
export async function saveImages(
  images: Buffer[],
  outputDir: string,
  prefix = "gen",
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const paths: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const filename = `${prefix}_${Date.now()}_${i}.png`;
    const filepath = join(outputDir, filename);
    await writeFile(filepath, images[i]);
    paths.push(filepath);
  }

  return paths;
}

/**
 * Get available models/checkpoints from ComfyUI.
 */
export async function getAvailableModels(
  config?: ComfyUIConfig,
): Promise<Record<string, string[]>> {
  const host = config?.host ?? DEFAULT_HOST;
  const port = config?.port ?? DEFAULT_PORT;

  const res = await fetch(`http://${host}:${port}/object_info`);
  const info = await res.json() as Record<string, { input?: { required?: Record<string, unknown[]> } }>;

  const models: Record<string, string[]> = {};

  // Extract model lists from loader nodes
  const loaderNodes = [
    "UnetLoaderGGUF",
    "CheckpointLoaderSimple",
    "CLIPLoader",
    "VAELoader",
  ];

  for (const node of loaderNodes) {
    const nodeInfo = info[node];
    if (nodeInfo?.input?.required) {
      for (const [key, val] of Object.entries(nodeInfo.input.required)) {
        if (Array.isArray(val) && Array.isArray(val[0])) {
          models[`${node}.${key}`] = val[0] as string[];
        }
      }
    }
  }

  return models;
}

/**
 * Interrupt the current generation.
 */
export async function interrupt(config?: ComfyUIConfig): Promise<void> {
  const host = config?.host ?? DEFAULT_HOST;
  const port = config?.port ?? DEFAULT_PORT;
  await fetch(`http://${host}:${port}/interrupt`, { method: "POST" });
}

/**
 * Disconnect and clean up client.
 */
export function disconnect(): void {
  if (_client) {
    _client.close();
    _client = null;
  }
}
