---
name: video-showcase
status: experimental
description: Create product/project showcase videos using Remotion (React). Takes project description + screenshots → generates compositions → renders MP4. Use when asked to make demo videos, product showcases, or animated project walkthroughs.
---

# Video Showcase — Remotion Video Generator

> Create polished 60-90 second product showcase videos programmatically using React + Remotion.

## Prerequisites

- **Remotion project** initialized in `~/Gits/contentGolem/remotion/`
- **ffmpeg** installed (`brew install ffmpeg`)
- **Chrome/Chromium** for headless rendering (Remotion bundles this)

## Quick Reference

| Action | Command |
|--------|---------|
| Preview | `cd ~/Gits/contentGolem/remotion && npx remotion preview` |
| Render | `npx remotion render <CompositionId> out/video.mp4 --props='{"title":"My Project"}'` |
| Batch render | Use `renderMedia()` API in a script (see below) |

## Workflow

### 1. Gather Inputs

Collect from user:
- **Project name** and tagline
- **Screenshots** (2-5 key screens, placed in `remotion/public/`)
- **Key features** (3-5 bullet points)
- **Tech stack** (for badges/icons)
- **Color palette** (or extract from screenshots)
- **Duration** preference (30s / 60s / 90s)

### 2. Choose Template

| Template | Best For | Duration |
|----------|----------|----------|
| `ProductHero` | SaaS/web app with screenshots | 60s |
| `CodeWalkthrough` | Developer tools, CLI, libraries | 90s |
| `BeforeAfter` | Redesigns, improvements | 45s |
| `MetricShowcase` | Growth, performance, stats | 30s |
| `ArchitectureDiagram` | System design, infrastructure | 60s |

### 3. Generate Composition

Create a new TSX composition file in `remotion/src/compositions/`:

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill, Img } from "remotion";
import { staticFile } from "remotion";

type Props = {
  title: string;
  tagline: string;
  features: string[];
  screenshots: string[];  // filenames in public/
  colors: { primary: string; bg: string; text: string };
};

export const ProductHero: React.FC<Props> = ({ title, tagline, features, screenshots, colors }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Intro: title + tagline fade in (0-2s)
  // Screenshots: pan/zoom through each (2-8s per screenshot)
  // Features: slide in one by one (2s each)
  // Outro: call to action (last 3s)

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      {/* Build composition here */}
    </AbsoluteFill>
  );
};
```

### 4. Render

```bash
# Preview in browser
npx remotion preview

# Render to MP4
npx remotion render ProductHero out/showcase.mp4 \
  --props='{"title":"My App","tagline":"Ship faster","features":["Fast","Reliable","Beautiful"],"screenshots":["screen1.png","screen2.png"],"colors":{"primary":"#3B82F6","bg":"#0F172A","text":"#F8FAFC"}}'

# Render for specific platform
npx remotion render ProductHero out/linkedin.mp4 --width=1920 --height=1080  # LinkedIn
npx remotion render ProductHero out/twitter.mp4 --width=1280 --height=720   # Twitter/X
npx remotion render ProductHero out/short.mp4 --width=1080 --height=1920    # Reels/Shorts
```

## Critical Remotion Rules

1. **NO CSS/Tailwind animations** — all animation MUST be frame-based (`interpolate`, `spring`, `useCurrentFrame`)
2. **No `setTimeout`/`setInterval`** — Remotion is deterministic, frame-by-frame
3. **Use `<Sequence from={N}>` for timing** — not conditional rendering based on time
4. **Use `staticFile()` for local assets** — files go in `public/` directory
5. **Use `spring()` for natural motion** — not linear `interpolate` for UI elements
6. **`extrapolateRight: 'clamp'`** — always clamp to prevent values going past target
7. **Props are JSON-serializable** — no functions, no React elements in props

## Animation Patterns

### Fade In
```tsx
const opacity = interpolate(frame, [0, 2 * fps], [0, 1], { extrapolateRight: 'clamp' });
```

### Spring Slide
```tsx
const translateX = spring({ frame, fps, from: -100, to: 0, config: { damping: 12 } });
```

### Staggered List
```tsx
{features.map((f, i) => (
  <Sequence from={startFrame + i * staggerDelay} key={i}>
    <AnimatedFeature text={f} />
  </Sequence>
))}
```

### Screenshot Pan/Zoom
```tsx
const scale = interpolate(frame, [0, duration], [1, 1.15], { extrapolateRight: 'clamp' });
const translateY = interpolate(frame, [0, duration], [0, -50], { extrapolateRight: 'clamp' });
```

## Data-Driven Batch Rendering

```typescript
import { renderMedia, selectComposition } from '@remotion/renderer';

const projects = [
  { title: "Project A", screenshots: ["a1.png", "a2.png"], ... },
  { title: "Project B", screenshots: ["b1.png", "b2.png"], ... },
];

for (const project of projects) {
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'ProductHero',
    inputProps: project,
  });
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: `out/${project.title}.mp4`,
    inputProps: project,
  });
}
```

## Export Settings by Platform

| Platform | Resolution | Codec | FPS | Notes |
|----------|-----------|-------|-----|-------|
| LinkedIn | 1920x1080 | h264 | 30 | Max 10 min, <200MB |
| Twitter/X | 1280x720 | h264 | 30 | Max 2:20, <512MB |
| YouTube | 1920x1080 | h264 | 30 | 16:9 preferred |
| Reels/Shorts | 1080x1920 | h264 | 30 | 9:16 vertical |
| GitHub README | 800x600 | gif | 15 | Keep <10MB |

## See Also

- [Remotion docs](https://www.remotion.dev/docs/)
- `/content` skill — for text content pipeline
- `/linkedin-post` skill — for LinkedIn-specific posting
