/**
 * Bun HTTP microservice for content render backends.
 *
 * Runs on port 3001, called by n8n workflows via HTTP Request nodes.
 * Wraps existing TypeScript code from Phase 2 (Remotion) and Phase 3 (ComfyUI).
 *
 * Routes:
 *   POST /api/comfyui/generate     → Queue Flux generation + quality scoring
 *   GET  /api/comfyui/status       → Check ComfyUI server status
 *   POST /api/remotion/render      → Render Remotion composition
 *   POST /api/remotion/still       → Render single frame
 *   GET  /api/health               → Health check
 *   GET  /api/pipelines            → List available pipelines
 *   POST /api/pipeline/route       → AI-route an idea to best pipeline
 *   POST /api/pipeline/execute     → Route + execute in one call
 *   GET  /api/pipeline/stats       → Pipeline performance stats
 */

import { readFile } from "fs/promises";
import {
  generate,
  isServerReady as isComfyReady,
  type GenerateOptions,
} from "./comfyui/index";
import type { FluxWorkflowStyle } from "./comfyui/workflows/flux-base";
import type { QualityPreset } from "./quality/index";

const PORT = parseInt(process.env.RENDER_SERVICE_PORT ?? "3001", 10);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

function hostnameFromHostHeader(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

function isAllowedLocalRequest(req: Request, url: URL): boolean {
  if (!isLoopbackHostname(url.hostname)) return false;

  const hostHeader = req.headers.get("host");
  if (hostHeader) {
    const hostname = hostnameFromHostHeader(hostHeader);
    if (!hostname || !isLoopbackHostname(hostname)) return false;
  }

  const origin = req.headers.get("origin");
  if (origin === null) return true;

  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

function corsHeadersFor(req: Request, url: URL): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).origin === url.origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

// --- Route Handlers ---

async function handleComfyGenerate(
  body: Record<string, unknown>,
): Promise<Response> {
  const opts: GenerateOptions = {
    prompt: body.prompt as string,
    style: (body.style as FluxWorkflowStyle) ?? "base",
    quality: (body.quality as QualityPreset) ?? "social",
    quick: (body.quick as boolean) ?? false,
    maxRetries: (body.maxRetries as number) ?? 3,
  };

  if (!opts.prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }

  try {
    const result = await generate(opts);

    // Read the image file for binary response
    const imageBuffer = await readFile(result.imagePath);
    const imageBase64 = imageBuffer.toString("base64");

    return Response.json({
      imagePath: result.imagePath,
      imageBase64,
      scores: result.scores,
      scoreSummary: result.scoreSummary,
      durationMs: result.durationMs,
      attempts: result.attempts,
      qualityPassed: result.qualityPassed,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function handleComfyStatus(): Promise<Response> {
  const ready = await isComfyReady();
  return Response.json({
    comfyui: ready ? "ready" : "offline",
    host: "127.0.0.1:8188",
  });
}

async function handleRemotionRender(
  body: Record<string, unknown>,
): Promise<Response> {
  // Dynamic import to avoid loading Remotion deps if not needed
  try {
    const { renderVideo } = await import("./render/index");

    const compositionId = body.compositionId as string;
    if (!compositionId) {
      return Response.json(
        { error: "compositionId is required" },
        { status: 400 },
      );
    }

    const job = await renderVideo({
      compositionId,
      inputProps: (body.inputProps as Record<string, unknown>) ?? {},
      outputPath: body.outputPath as string | undefined,
    });

    return Response.json(job);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function handleRemotionStill(
  body: Record<string, unknown>,
): Promise<Response> {
  try {
    const { renderThumbnail } = await import("./render/index");

    const compositionId = body.compositionId as string;
    if (!compositionId) {
      return Response.json(
        { error: "compositionId is required" },
        { status: 400 },
      );
    }

    const job = await renderThumbnail({
      compositionId,
      inputProps: (body.inputProps as Record<string, unknown>) ?? {},
      frame: (body.frame as number) ?? 0,
      outputPath: body.outputPath as string | undefined,
    });

    return Response.json(job);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

function handleHealth(): Response {
  return Response.json({
    status: "ok",
    service: "golems-render-service",
    port: PORT,
    timestamp: new Date().toISOString(),
    pipelines: ["comfyui", "remotion", "dataviz"],
    features: ["pipeline-routing", "pipeline-tracking"],
  });
}

async function handlePipelines(): Promise<Response> {
  const { getRegistry } = await import("./pipeline/index");
  const registry = getRegistry();
  return Response.json({
    pipelines: registry.pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      endpoint: p.endpoint,
      inputs: p.inputs,
      outputs: p.outputs,
      bestFor: p.bestFor,
      speed: p.speed,
      quality: p.quality,
      config: p.config,
    })),
  });
}

async function handlePipelineRoute(
  body: Record<string, unknown>,
): Promise<Response> {
  const { routeIdea } = await import("./pipeline/index");

  const idea = body.idea as string;
  if (!idea) {
    return Response.json({ error: "idea is required" }, { status: 400 });
  }

  const result = await routeIdea({
    idea,
    preferredFormat: body.preferredFormat as undefined,
    project: body.project as string | undefined,
    allowMulti: body.allowMulti as boolean | undefined,
  });

  return Response.json(result);
}

async function handlePipelineExecute(
  body: Record<string, unknown>,
): Promise<Response> {
  const { routeIdea, executePlan } = await import("./pipeline/index");

  const idea = body.idea as string;
  if (!idea) {
    return Response.json({ error: "idea is required" }, { status: 400 });
  }

  const plan = await routeIdea({
    idea,
    preferredFormat: body.preferredFormat as undefined,
    project: body.project as string | undefined,
    allowMulti: body.allowMulti as boolean | undefined,
  });

  const result = await executePlan(plan, {
    project: body.project as string | undefined,
    serviceUrl: `http://localhost:${PORT}`,
    trackRun: true,
  });

  return Response.json({
    routing: plan,
    execution: result,
  });
}

async function handlePipelineStats(): Promise<Response> {
  const { getPerformanceStats } = await import("./pipeline/index");
  const stats = await getPerformanceStats();
  return Response.json({ stats });
}

async function handleDataVizRender(
  body: Record<string, unknown>,
): Promise<Response> {
  const type = (body.type as string) ?? "jobs";
  const format = (body.format as string) ?? "linkedin";

  // Dynamic import to avoid loading dataviz deps at startup
  const { fetchJobMarketData } = await import("./dataviz/fetchers/jobs");
  const { fetchFinanceData } = await import("./dataviz/fetchers/finance");
  const { fetchBrainData } = await import("./dataviz/fetchers/brain");
  const { fetchActivityData } = await import("./dataviz/fetchers/activity");
  const { renderBarChart } = await import("./dataviz/charts/bar");
  const { renderDonutChart } = await import("./dataviz/charts/donut");
  const { renderLineChart } = await import("./dataviz/charts/line");
  const { renderStatCards } = await import("./dataviz/charts/stat-card");
  const { renderLinkedInCard } =
    await import("./dataviz/templates/linkedin-card");
  const { renderSvgToBuffer } = await import("./dataviz/renderer");

  let chartSvg: string;
  let title: string;
  let statsSvg: string | undefined;

  switch (type) {
    case "jobs": {
      const data = await fetchJobMarketData();
      title = "Job Market Overview";
      chartSvg = renderBarChart({
        title: "Top Tags",
        data: data.topTags.map((t) => ({ label: t.tag, value: t.count })),
        horizontal: true,
        maxBars: 8,
      });
      statsSvg = renderStatCards({
        stats: [
          { label: "Total Jobs", value: data.totalJobs },
          { label: "Sources", value: data.scrapeStats.length },
        ],
        columns: 2,
        width: 600,
      });
      break;
    }
    case "finance": {
      const data = await fetchFinanceData();
      title = "Monthly Finance";
      chartSvg = renderDonutChart({
        data: data.llmCostsByModel
          .filter((m) => m.totalCost > 0)
          .map((m) => ({ label: m.model, value: m.totalCost })),
        centerValue: `$${data.totalLLMCost.toFixed(2)}`,
        centerLabel: "Total",
      });
      break;
    }
    case "brain": {
      const data = await fetchBrainData();
      title = "Brain Growth";
      chartSvg = renderLineChart({
        data: data.monthlyGrowth.map((g) => ({
          date: g.month,
          value: g.chunks,
        })),
        showArea: true,
      });
      statsSvg = renderStatCards({
        stats: [
          { label: "Chunks", value: data.totalChunks },
          { label: "Enriched", value: `${data.enrichmentPercent}%` },
        ],
        columns: 2,
        width: 600,
      });
      break;
    }
    case "activity": {
      const data = await fetchActivityData();
      title = "Golem Activity";
      chartSvg = renderBarChart({
        data: data.golemActivity
          .slice(0, 6)
          .map((g) => ({ label: g.actor, value: g.eventCount })),
        horizontal: true,
      });
      break;
    }
    default:
      return Response.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  const svg = renderLinkedInCard({ title, chartSvg, statsSvg });
  const imageBuffer = await renderSvgToBuffer(svg, "png");
  const imageBase64 = imageBuffer.toString("base64");

  return Response.json({
    success: true,
    type,
    format,
    imageBase64,
    mimeType: "image/png",
  });
}

// --- Server ---

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;

  if (!isAllowedLocalRequest(req, url)) {
    return Response.json(
      { error: "Forbidden: local same-origin requests only" },
      { status: 403 },
    );
  }

  const corsHeaders = corsHeadersFor(req, url);

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let response: Response;

    switch (true) {
      case method === "POST" && pathname === "/api/comfyui/generate": {
        const body = (await req.json()) as Record<string, unknown>;
        response = await handleComfyGenerate(body);
        break;
      }
      case method === "GET" && pathname === "/api/comfyui/status":
        response = await handleComfyStatus();
        break;
      case method === "POST" && pathname === "/api/remotion/render": {
        const body = (await req.json()) as Record<string, unknown>;
        response = await handleRemotionRender(body);
        break;
      }
      case method === "POST" && pathname === "/api/remotion/still": {
        const body = (await req.json()) as Record<string, unknown>;
        response = await handleRemotionStill(body);
        break;
      }
      case method === "GET" && pathname === "/api/health":
        response = handleHealth();
        break;
      case method === "POST" && pathname === "/api/dataviz/render": {
        const body = (await req.json()) as Record<string, unknown>;
        response = await handleDataVizRender(body);
        break;
      }
      case method === "GET" && pathname === "/api/pipelines":
        response = await handlePipelines();
        break;
      case method === "POST" && pathname === "/api/pipeline/route": {
        const body = (await req.json()) as Record<string, unknown>;
        response = await handlePipelineRoute(body);
        break;
      }
      case method === "POST" && pathname === "/api/pipeline/execute": {
        const body = (await req.json()) as Record<string, unknown>;
        response = await handlePipelineExecute(body);
        break;
      }
      case method === "GET" && pathname === "/api/pipeline/stats":
        response = await handlePipelineStats();
        break;
      default:
        response = Response.json(
          { error: "Not found", path: pathname },
          { status: 404 },
        );
    }

    // Add CORS headers to all responses
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }

    return response;
  } catch (err) {
    return Response.json(
      { error: "Internal server error", message: (err as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
}

if (import.meta.main) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    fetch: handleRequest,
  });

  console.log(`Render service running on http://127.0.0.1:${PORT}`);
  console.log("Routes:");
  console.log("  POST /api/comfyui/generate   — Flux image generation");
  console.log("  GET  /api/comfyui/status     — ComfyUI server status");
  console.log("  POST /api/remotion/render    — Video rendering");
  console.log("  POST /api/remotion/still     — Single frame capture");
  console.log("  POST /api/dataviz/render     — Data visualization");
  console.log("  POST /api/pipeline/route     — AI-route idea to pipeline");
  console.log("  POST /api/pipeline/execute   — Route + execute in one call");
  console.log("  GET  /api/pipeline/stats     — Pipeline performance stats");
  console.log("  GET  /api/pipelines          — List pipelines");
  console.log("  GET  /api/health             — Health check");
}
