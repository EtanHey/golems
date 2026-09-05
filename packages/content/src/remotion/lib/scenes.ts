/**
 * Scene type schemas for ProductHero compositions.
 *
 * Each scene is a self-contained section of a product video.
 * All props are JSON-serializable for Remotion defaultProps.
 */

import type { BrandColors, ElementAnimation, SpringPresetName, TextVariant } from "./types";

// --- Shared Scene Base ---

export type SceneTransition = {
  type: "fade" | "slide-left" | "slide-right" | "slide-up" | "wipe" | "none";
  durationFrames?: number;
};

export type SceneBase = {
  /** Duration of this scene in frames (at 30fps) */
  durationInFrames: number;
  /** Transition in from previous scene */
  transitionIn?: SceneTransition;
  /** Transition out to next scene */
  transitionOut?: SceneTransition;
  /** Brand colors for this scene (inherits from composition if not set) */
  brand?: BrandColors;
};

// --- TitleCard Scene ---

export type TitleCardProps = SceneBase & {
  type: "title-card";
  /** Main title text */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Optional logo image path (staticFile) */
  logoSrc?: string;
  /** Logo dimensions */
  logoWidth?: number;
  logoHeight?: number;
  /** Background for this scene */
  background: {
    type: "color" | "gradient" | "image";
    value: string;
  };
  /** Title entrance animation */
  titleEntrance?: ElementAnimation;
  /** Subtitle entrance animation */
  subtitleEntrance?: ElementAnimation;
  /** Delay between title and subtitle (frames) */
  subtitleDelay?: number;
  /** RTL mode for Hebrew/Arabic */
  rtl?: boolean;
};

// --- Screenshot Scene ---

export type ScreenshotHighlight = {
  /** Region to highlight (percentage coordinates 0-100) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** When to show highlight (frame offset from scene start) */
  showAtFrame: number;
  /** Optional label text */
  label?: string;
  /** Highlight style */
  style?: "glow" | "border" | "magnify" | "arrow";
};

export type ScreenshotSceneProps = SceneBase & {
  type: "screenshot";
  /** Screenshot image path (staticFile) */
  src: string;
  /** How the screenshot enters */
  entrance?: ElementAnimation;
  /** Frame delay for screenshot entrance */
  entranceDelay?: number;
  /** Optional device frame (mockup) */
  deviceFrame?: "none" | "browser" | "iphone" | "ipad" | "macbook" | "android";
  /** Regions to highlight with animations */
  highlights?: ScreenshotHighlight[];
  /** Optional caption below the screenshot */
  caption?: string;
  /** Zoom into a region after initial display */
  zoomRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
    startFrame: number;
    durationFrames: number;
    scale?: number;
  };
};

// --- Metrics Scene ---

export type MetricItem = {
  /** Label text (e.g., "Active Users") */
  label: string;
  /** Target value to count up to */
  value: number;
  /** Optional prefix (e.g., "$") */
  prefix?: string;
  /** Optional suffix (e.g., "%", "K", "M") */
  suffix?: string;
  /** Number of decimal places */
  decimals?: number;
  /** Icon path (staticFile) or emoji */
  icon?: string;
  /** Frame to start counting */
  startFrame?: number;
  /** Duration of count-up animation (frames) */
  countUpFrames?: number;
  /** Spring preset for the count-up */
  springPreset?: SpringPresetName;
};

export type MetricsSceneProps = SceneBase & {
  type: "metrics";
  /** Scene heading */
  heading?: string;
  /** Array of metrics to display */
  metrics: MetricItem[];
  /** Layout of metric cards */
  layout?: "row" | "grid-2x2" | "grid-3";
  /** Background for this scene */
  background?: {
    type: "color" | "gradient";
    value: string;
  };
  /** Stagger delay between metrics (frames) */
  staggerDelay?: number;
};

// --- Screen Recording Scene ---

export type ScreenRecordingSceneProps = SceneBase & {
  type: "screen-recording";
  /** Video file path (staticFile) */
  src: string;
  /** Start time in the video to play from (seconds) */
  startFrom?: number;
  /** End time in the video to stop at (seconds) */
  endAt?: number;
  /** Playback speed multiplier */
  playbackRate?: number;
  /** Device frame wrapper */
  deviceFrame?: "none" | "browser" | "iphone" | "macbook";
  /** Whether to show a cursor overlay */
  showCursor?: boolean;
  /** Optional caption/annotation overlay */
  captions?: Array<{
    text: string;
    fromFrame: number;
    toFrame: number;
    position?: "top" | "bottom";
    variant?: TextVariant;
  }>;
  /** Entrance animation for the video */
  entrance?: ElementAnimation;
  entranceDelay?: number;
};

// --- Scene Union ---

export type Scene =
  | TitleCardProps
  | ScreenshotSceneProps
  | MetricsSceneProps
  | ScreenRecordingSceneProps;

// --- ProductHero Composition Props ---

export type ProductHeroProps = {
  /** Composition title (for Remotion Studio) */
  title: string;
  /** Brand colors */
  brand: BrandColors;
  /** Scenes in order */
  scenes: Scene[];
  /** Output dimensions */
  width: number;
  height: number;
  /** Frames per second */
  fps: number;
};
