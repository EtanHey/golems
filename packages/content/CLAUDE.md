# ContentGolem

> Content creation — visual content factory + text publishing. Brand-aware, multi-pipeline.

## Role

ContentGolem handles **all content creation and publishing**: visual content (animations, images, data viz), LinkedIn posts, Soltome publishing, ghostwriting, and content strategy. All visual output is brand-aware via per-project `brand.json` configs.

---

## BrainBar Stub Warnings

BrainBar Swift daemon has 4 STUB tools returning fake success:
- brain_digest, brain_update, brain_expand, brain_tags — ALL BROKEN
- Working: brain_search, brain_store, brain_recall, brain_entity
- Last successful digest: March 14, 2026

---

## Compact Instructions

When compacting this session, follow these rules strictly:

### NEVER preserve
- /loop, QUEUE-OPERATION, cron polling (3+ identical system/cron messages = keep ZERO)
- BrainLayer search injections (re-injected fresh each turn)
- Full file contents re-readable from disk (keep path + one-line summary of decision made)

### ALWAYS preserve verbatim
- User vision/goal/decision statements (if stated 3x+, note "[USER STATED Nx]")
- User repetitions in DIFFERENT places = importance signal, keep ONE with annotation
- Short user messages (approvals, frustration signals) — these carry intent
- Sprint plan with priority ratings
- All decisions with rationale (WHY not just WHAT)
- Modified file paths with one-line change summary

### Structure summary as
1. **Session Intent**: What the user wants (exact quotes)
2. **Decisions Made**: Each + rationale + who
3. **Artifact Trail**: Files, tests, commands
4. **Current State**: Working/broken/in-progress
5. **Next Steps**: Ordered by sprint plan priority

---

## Architecture

```text
packages/content/
├── src/
│   ├── brand/                   # Brand config schema + validation
│   │   ├── schema.ts            # BrandConfig interface + validator
│   │   └── index.ts             # Barrel export
│   ├── remotion/                # Shared animation components + types
│   │   ├── lib/                 # motion.ts, types.ts, design-tokens.ts, brand-bridge.ts, responsive.ts
│   │   └── components/          # AnimatedText, FadeIn, SlideIn, scenes/, audio/
│   ├── comfyui/                 # ComfyUI image generation client
│   │   ├── client.ts            # Connection, queueing, progress, output retrieval
│   │   ├── generate.ts          # Full generation pipeline (workflow + quality + retry)
│   │   ├── workflows/           # Flux GGUF workflow builders (base, social, merch, meme, draft)
│   │   └── index.ts             # Barrel export
│   ├── quality/                 # Image quality scoring pipeline
│   │   ├── scoring.ts           # CLIP Score, LAION Aesthetic, BRISQUE — Python bridge
│   │   └── index.ts             # Barrel export
│   ├── dataviz/                 # Data visualization pipeline
│   │   ├── fetchers/            # Supabase + BrainLayer data fetchers (jobs, finance, brain, activity)
│   │   ├── charts/              # SVG chart generators (bar, donut, line, stat-card)
│   │   ├── templates/           # Infographic layouts (linkedin-card, instagram-square, story-format)
│   │   ├── renderer.ts          # SVG → PNG via sharp
│   │   └── index.ts             # Barrel export
│   ├── pipeline/                # Pipeline intelligence (Phase 6)
│   │   ├── registry.ts          # Pipeline capabilities registry
│   │   ├── router.ts            # AI routing: idea → best pipeline(s)
│   │   ├── executor.ts          # Pipeline execution engine
│   │   ├── tracker.ts           # Performance tracking (Supabase)
│   │   └── index.ts             # Barrel export
│   └── render/                  # Programmatic render service
│       ├── render-service.ts    # renderVideo(), renderThumbnail(), job tracking
│       └── index.ts             # Barrel export
├── remotion/                    # Standalone Remotion project (compositions)
│   └── src/
│       ├── Root.tsx             # All registered compositions
│       └── compositions/        # CodeShowcase, ArchDiagram, MetricsDashboard, ProductHero
├── projects/                    # Per-project brand configs (outputs gitignored)
│   ├── golems-showcase/         # brand.json + templates/ + outputs/
│   ├── techgym-posts/           # brand.json + templates/ + outputs/
│   └── political-merch/         # brand.json + templates/ + outputs/
├── scripts/
│   ├── validate-brand.ts        # CLI: bun run validate-brand [project]
│   ├── render.ts                # CLI: bun run render <compositionId> [--project <name>]
│   ├── generate.ts              # CLI: bun run generate <prompt> [--style social|merch|meme]
│   └── quality-score.py         # Python quality scoring (CLIP + Aesthetic + BRISQUE)
├── CLAUDE.md                    # This file
└── package.json                 # @golems/content
```

## Dependencies

- `@golems/shared` — Supabase factory, event log, LLM

## Brand System

**ALWAYS read the project's `brand.json` before generating any visual content.**

```typescript
import { loadBrandConfig } from "@golems/content/brand";

const { config, errors } = await loadBrandConfig("projects/golems-showcase");
if (errors.length > 0) throw new Error(`Invalid brand config: ${errors.map(e => e.message).join(", ")}`);

// Use config.colors, config.typography, config.tone, etc.
```

| Project | Use Case | Brand File |
|---------|----------|------------|
| `golems-showcase` | Product demos, architecture viz, feature showcases | `projects/golems-showcase/brand.json` |
| `techgym-posts` | Israeli tech community content (Hebrew-first) | `projects/techgym-posts/brand.json` |
| `political-merch` | Bold merch designs (t-shirts, stickers) | `projects/political-merch/brand.json` |

Validate all configs: `bun run validate-brand` (runs from packages/content/).

## Remotion Render Pipeline

### Compositions

| ID | What | Default Size |
|----|------|-------------|
| `CodeShowcase` | Animated code walkthrough with syntax highlighting | 1920x1080 |
| `ArchDiagram` | Animated architecture diagram (boxes + arrows) | 1920x1080 |
| `MetricsDashboard` | Animated stats with count-up, trends, sparklines | 1920x1080 |
| `ProductHero` | Scene sequencer (title → screenshots → metrics) | 1920x1080 |
| `WeeklyJobs` | Animated bar chart of top job tags/skills | 1920x1080 |
| `MonthlyFinance` | Animated donut chart of LLM costs by model | 1920x1080 |
| `BrainGrowth` | Animated line chart of knowledge base growth | 1920x1080 |

All core compositions have `-LinkedIn` (1080x1080) variants.
MetricsDashboard also has a `-GIF` (800x450) variant.

### Render Commands

```bash
# List available compositions and projects
bun run render:list

# Render a composition (YouTube 1080p by default)
bun run render CodeShowcase --project golems-showcase

# Render for LinkedIn (1:1)
bun run render MetricsDashboard --project golems-showcase --platform linkedin

# Render a still/thumbnail
bun run render:still ArchDiagram --frame 90

# Open Remotion Studio for visual preview
bun run render:preview
bun run studio  # shortcut — opens Studio directly
```

### Programmatic Rendering

```typescript
import { renderVideo, buildBrandProps } from "@golems/content/render";

const brand = await buildBrandProps("projects/golems-showcase");
const job = await renderVideo({
  compositionId: "CodeShowcase",
  inputProps: { ...brand },
  outputPath: "out/code-showcase.mp4",
  onProgress: (p) => console.log(`${p}%`),
});
```

### Brand Bridge

Converts Phase 1 `BrandConfig` → Remotion's `BrandColors`:

```typescript
import { brandConfigToColors } from "@golems/content/remotion/lib/brand-bridge";
const colors = brandConfigToColors(config);
// → { primary, primaryDark, background, surface, text, textMuted, accent }
```

## Flux Image Generation (ComfyUI)

### Prerequisites

ComfyUI installed at `~/Gits/ComfyUI` with:
- Flux.1 Dev Q6_K GGUF (9.2 GB) in `models/diffusion_models/`
- T5-XXL Q4_K_M GGUF (2.7 GB) + CLIP-L (235 MB) in `models/text_encoders/`
- VAE ae.safetensors (321 MB) in `models/vae/`
- Custom nodes: ComfyUI-GGUF, ComfyUI-TeaCache, ComfyUI-Impact-Pack, ComfyUI_UltimateSDUpscale

### ComfyUI Service

```bash
# Start ComfyUI
launchctl load ~/Library/LaunchAgents/com.golems.comfyui.plist

# Stop ComfyUI
launchctl unload ~/Library/LaunchAgents/com.golems.comfyui.plist

# Check status
bun run generate:status
```

### Generation Commands

```bash
# Generate an image
bun run generate "A futuristic city at sunset" --style social

# Quick draft (512x512, fast)
bun run generate "Logo concept" --style merch --quick

# With brand config
bun run generate "Product showcase" --project golems-showcase --style social

# List available models
bun run generate:models
```

### Styles

| Style | Size | Steps | Use Case |
|-------|------|-------|----------|
| `base` | 768x768 | 25 | General purpose |
| `social` | 1080x1080 | 25 | Instagram/LinkedIn square |
| `merch` | 1024x1024 | 30 | Print-quality (upscaled 4x) |
| `meme` | 1280x720 | 20 | Landscape memes |
| Quick draft | 512x512 | 15 | Fast iteration (2-4 min) |

### Quality Pipeline

Generated images are scored against 3 gates:
- **CLIP Score** >= 0.25 (prompt adherence)
- **LAION Aesthetic** >= 5.5 social / >= 6.0 print (visual quality)
- **BRISQUE** <= 40 (perceptual quality)

Auto-retries with new seed up to 3x. Best result returned even if gates fail.

### Programmatic API

```typescript
import { generate } from "@golems/content/comfyui";

const result = await generate({
  prompt: "Minimalist logo, dark background",
  style: "social",
  quality: "social",
  brand: myBrandConfig,
  onProgress: ({ percent }) => console.log(`${(percent * 100).toFixed(0)}%`),
});

console.log(result.imagePath);
console.log(result.scoreSummary);
```

## Data Visualization Pipeline

### Data Sources

| Fetcher | Source | Key Metrics |
|---------|--------|-------------|
| `jobs` | `golem_jobs`, `scrape_activity` | Top tags, status distribution, weekly trends, scrape stats |
| `finance` | `llm_usage`, `subscriptions` | LLM costs by model, daily costs, subscription totals |
| `brain` | BrainLayer SQLite DB | Chunk growth, project coverage, content types, enrichment % |
| `activity` | `golem_events`, `service_runs` | Golem activity, event types, service health |

### Static Infographics (SVG → PNG)

```bash
# Generate a specific data viz
bun run dataviz jobs --format linkedin
bun run dataviz finance --format instagram
bun run dataviz brain --format story

# Generate all types
bun run dataviz all

# SVG only (no PNG conversion)
bun run dataviz jobs --svg-only
```

### Infographic Templates

| Template | Size | Use Case |
|----------|------|----------|
| `linkedin-card` | 1200x627 | LinkedIn posts, articles |
| `instagram-square` | 1080x1080 | Instagram feed posts |
| `story-format` | 1080x1920 | Instagram/LinkedIn Stories |

### Chart Types

| Chart | Function | Use Case |
|-------|----------|----------|
| Bar | `renderBarChart()` | Rankings, comparisons (horizontal/vertical) |
| Donut | `renderDonutChart()` | Proportions, distributions |
| Line | `renderLineChart()` | Time series, growth trends |
| Stat Card | `renderStatCards()` | Key metrics with delta indicators |

### Animated Versions (Remotion)

```bash
# Render animated data viz video
bun run render WeeklyJobs --project golems-showcase
bun run render MonthlyFinance --project golems-showcase --platform linkedin
bun run render BrainGrowth --project golems-showcase
```

### Programmatic API

```typescript
import { fetchJobMarketData, renderBarChart, renderLinkedInCard, renderSvgToPng } from "@golems/content/dataviz";

const data = await fetchJobMarketData();
const chart = renderBarChart({
  data: data.topTags.map(t => ({ label: t.tag, value: t.count })),
  horizontal: true,
});
const infographic = renderLinkedInCard({ title: "Job Market", chartSvg: chart });
await renderSvgToPng({ svg: infographic, outputPath: "out/jobs.png" });
```

### Brand-Aware Theming

Charts automatically use brand colors when a BrandConfig is provided:

```typescript
import { themeFromBrand, renderBarChart } from "@golems/content/dataviz";
import { loadBrandConfig } from "@golems/content/brand";

const { config } = await loadBrandConfig("projects/golems-showcase");
const theme = themeFromBrand(config);
const chart = renderBarChart({ data: [...], theme });
```

## Pipeline Intelligence

AI-powered routing: describe an idea, get the best pipeline(s) to produce it.

### CLI

```bash
# Route an idea to the best pipeline
bun run pipeline route "Weekly job market bar chart"

# Route + execute in one command
bun run pipeline route "Animated code demo" --execute

# Show pipeline performance stats
bun run pipeline stats

# List all available pipelines
bun run pipeline list
```

### Available Pipelines

| ID | Name | Inputs | Outputs | Best For |
|----|------|--------|---------|----------|
| `remotion` | Remotion Video | text, code, data | mp4, gif, png | Animations, code demos, data stories |
| `comfyui` | Flux Image Gen | prompt, image | png, jpg, webp | Social visuals, merch, memes |
| `dataviz` | Data Visualization | data_source | png, svg | Charts, infographics, reports |
| `satori` | Template Fill | text, json | png, svg, pdf | Branded cards, quotes (planned) |
| `figma-remotion` | Figma to Remotion | url, json | mp4, gif | Design animations (planned) |

### Programmatic API

```typescript
import { routeIdea, executePlan } from "@golems/content/pipeline";

// Route an idea
const plan = await routeIdea({
  idea: "Create a weekly job market infographic",
  project: "golems-showcase",
});

console.log(plan.steps[0].pipelineId); // "dataviz"
console.log(plan.reasoning); // "Job market data → dataviz pipeline..."

// Execute the plan
const result = await executePlan(plan, {
  project: "golems-showcase",
  trackRun: true,
});
```

### Multi-Pipeline Combinations

For complex ideas, the router can chain pipelines:
- ComfyUI background → Remotion text animation overlay
- Dataviz chart → Remotion animated version
- Multiple chart types → infographic template

### Performance Tracking

Pipeline runs are logged to `pipeline_runs` Supabase table:
- Pipeline ID, idea text, idea type classification
- Success/failure, duration, quality score
- User feedback (1-5 via Telegram reactions)
- Used by the learning loop to improve routing over time

---

## Current State

ContentGolem has two distinct halves:

### Visual Content Factory (in `src/`)
Fully implemented: brand system, Remotion compositions, ComfyUI image gen, data viz pipeline, pipeline intelligence router. All code lives in this package.

### Text Publishing (in skills + services)
Logic is currently spread across other packages:
- **`golem-powers/content/`** skill — draft workflow (draft → critique → refine → publish)
- **`golem-powers/linkedin-post/`** skill — LinkedIn-specific drafting with 2026 algorithm rules
- **Soltome client** — `@golems/services/soltome-client.ts` (API client for soltome.com)
- **Post generator** — `@golems/services/post-generator.ts` (critique-waves pattern)
- **Soltome learner** — `@golems/services/soltome-learner.ts` (2am: scrape + learn patterns)

Text publishing logic will migrate into `src/` in a future phase.

### n8n Orchestration (in `packages/orchestrator/`)
The n8n automation layer and Bun render microservice live in a separate package. See `packages/orchestrator/CLAUDE.md`.

## Content Pipeline

1. **Topic Discovery** — from code commits, research, conversations
2. **Drafting** — LLM generates draft matching owner's voice
3. **Critique Waves** — parallel agents critique → refine → polish
4. **Approval** — human approves via Telegram `/drafts` command
5. **Publishing** — post to Soltome (2 credits) or LinkedIn

## Writing Voice

See `~/.claude/learnings/hebrew-tech-ghostwriting.md` for Hebrew voice guidelines.
Key traits: casual, technical depth without jargon, collaborative researcher tone.

## Soltome Integration

| Endpoint | Cost | Description |
|----------|------|-------------|
| `POST /api/posts` | 2 credits | Create post |
| `POST /api/votes` | 1 credit | Vote on post |
| `POST /api/comments` | 1 credit | Comment on post |
| `GET /api/credits/balance` | FREE | Check balance |
