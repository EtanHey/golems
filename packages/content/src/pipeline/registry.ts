/**
 * Pipeline registry — defines available content pipelines and their capabilities.
 *
 * Each pipeline has metadata about what it can do, what inputs it takes,
 * and what outputs it produces. Used by the router to select the best
 * pipeline for a given creative idea.
 */

export interface PipelineCapability {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this pipeline does */
  description: string;
  /** Input types this pipeline accepts */
  inputs: PipelineInput[];
  /** Output formats this pipeline produces */
  outputs: OutputFormat[];
  /** Content types this pipeline is best for */
  bestFor: string[];
  /** Speed rating (1-10, 10 = fastest) */
  speed: number;
  /** Cost rating (1-10, 10 = most expensive) */
  cost: number;
  /** Quality rating (1-10, 10 = highest quality) */
  quality: number;
  /** Whether this pipeline is currently available */
  available: boolean;
  /** Render service endpoint (if any) */
  endpoint?: string;
  /** Pipeline-specific config */
  config?: Record<string, unknown>;
}

export type PipelineInput =
  | "text"
  | "code"
  | "data_source"
  | "prompt"
  | "image"
  | "url"
  | "json";

export type OutputFormat =
  | "mp4"
  | "gif"
  | "png"
  | "svg"
  | "jpg"
  | "webp"
  | "pdf";

export interface PipelineRegistry {
  pipelines: PipelineCapability[];
  get(id: string): PipelineCapability | undefined;
  findByOutput(format: OutputFormat): PipelineCapability[];
  findByUseCase(useCase: string): PipelineCapability[];
}

const PIPELINES: PipelineCapability[] = [
  {
    id: "remotion",
    name: "Remotion Video",
    description:
      "Programmatic video/animation rendering. React components → MP4/GIF. Best for code demos, motion graphics, data story animations.",
    inputs: ["text", "code", "data_source", "json"],
    outputs: ["mp4", "gif", "png"],
    bestFor: [
      "animations",
      "code demos",
      "data stories",
      "motion graphics",
      "product showcases",
      "architecture diagrams",
      "metric dashboards",
    ],
    speed: 4,
    cost: 1,
    quality: 9,
    available: true,
    endpoint: "/api/remotion/render",
    config: {
      compositions: [
        "CodeShowcase",
        "ArchDiagram",
        "MetricsDashboard",
        "ProductHero",
        "WeeklyJobs",
        "MonthlyFinance",
        "BrainGrowth",
      ],
    },
  },
  {
    id: "comfyui",
    name: "Flux Image Generation",
    description:
      "AI image generation via ComfyUI + Flux.1 Dev Q6_K GGUF. Best for generative visuals, social posts, merchandise, memes.",
    inputs: ["prompt", "image"],
    outputs: ["png", "jpg", "webp"],
    bestFor: [
      "social visuals",
      "merchandise designs",
      "memes",
      "backgrounds",
      "hero images",
      "creative illustrations",
      "AI art",
    ],
    speed: 3,
    cost: 1,
    quality: 8,
    available: true,
    endpoint: "/api/comfyui/generate",
    config: {
      styles: ["base", "social", "merch", "meme"],
      qualityPresets: ["social", "print"],
    },
  },
  {
    id: "dataviz",
    name: "Data Visualization",
    description:
      "Branded infographics from golem data (jobs, finance, brain, activity). SVG charts → PNG templates.",
    inputs: ["data_source"],
    outputs: ["png", "svg"],
    bestFor: [
      "charts",
      "infographics",
      "data cards",
      "statistics",
      "reports",
      "weekly summaries",
      "monthly reports",
    ],
    speed: 9,
    cost: 1,
    quality: 7,
    available: true,
    endpoint: "/api/dataviz/render",
    config: {
      types: ["jobs", "finance", "brain", "activity"],
      formats: ["linkedin", "instagram", "story"],
    },
  },
  {
    id: "satori",
    name: "Template Fill",
    description:
      "Ultra-fast branded template rendering via Satori + Sharp. Best for templated content with dynamic text/data (majority of content work).",
    inputs: ["text", "json"],
    outputs: ["png", "svg", "pdf"],
    bestFor: [
      "branded templates",
      "social cards",
      "quote images",
      "announcement cards",
      "event banners",
      "text-heavy designs",
    ],
    speed: 10,
    cost: 1,
    quality: 6,
    available: false, // Not yet implemented
    config: {
      note: "Planned for future phase — currently handled by dataviz templates",
    },
  },
  {
    id: "figma-remotion",
    name: "Figma to Remotion",
    description:
      "Convert Figma designs into animated Remotion compositions. High-fidelity design-to-video pipeline.",
    inputs: ["url", "json"],
    outputs: ["mp4", "gif"],
    bestFor: [
      "design animations",
      "UI walkthroughs",
      "polished brand videos",
      "design system showcases",
    ],
    speed: 2,
    cost: 3,
    quality: 10,
    available: false, // Not yet implemented
    config: {
      note: "Planned for future phase — requires Figma MCP",
    },
  },
];

/** Get the full pipeline registry with lookup methods. */
export function getRegistry(): PipelineRegistry {
  return {
    pipelines: PIPELINES.filter((p) => p.available),

    get(id: string) {
      return PIPELINES.find((p) => p.id === id);
    },

    findByOutput(format: OutputFormat) {
      return PIPELINES.filter(
        (p) => p.available && p.outputs.includes(format),
      );
    },

    findByUseCase(useCase: string) {
      const lower = useCase.toLowerCase();
      return PIPELINES.filter(
        (p) =>
          p.available &&
          p.bestFor.some((bf) => bf.includes(lower) || lower.includes(bf)),
      );
    },
  };
}

/** Get registry as JSON for AI routing prompt context. */
export function getRegistryForPrompt(): string {
  const available = PIPELINES.filter((p) => p.available);
  return JSON.stringify(
    available.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      inputs: p.inputs,
      outputs: p.outputs,
      bestFor: p.bestFor,
      speed: p.speed,
      quality: p.quality,
    })),
    null,
    2,
  );
}
