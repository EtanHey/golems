/**
 * Motion helpers — re-exported from the main content remotion lib.
 * All compositions should import from here (../../lib) not from ../../../src/remotion.
 */

export {
  clampedInterpolate,
  DURATIONS,
  SPRING_PRESETS,
  springProgress,
  staggerDelay,
} from "../../../src/remotion/lib/motion";

export type {
  SpringPresetName,
  SpringConfig,
  BrandColors,
  ElementAnimation,
  SlideDirection,
  FloatDirection,
  TextVariant,
  TextOverlay,
  HeroElement,
  HeroBackground,
  AnimatedHeroProps,
} from "../../../src/remotion/lib/types";

export {
  SPACING,
  TYPOGRAPHY,
  CANVAS,
  FONT_FAMILY,
  defaultDark,
  brandPresets,
} from "../../../src/remotion/lib/design-tokens";

export type {
  Scene,
  SceneBase,
  SceneTransition,
  TitleCardProps,
  ScreenshotSceneProps,
  MetricsSceneProps,
  MetricItem,
  ScreenRecordingSceneProps,
  ScreenshotHighlight,
  ProductHeroProps,
} from "../../../src/remotion/lib/scenes";

// Components
export { AnimatedText } from "../../../src/remotion/components/AnimatedText";
export { FadeIn } from "../../../src/remotion/components/FadeIn";
export { FloatLoop } from "../../../src/remotion/components/FloatLoop";
export { ScaleReveal } from "../../../src/remotion/components/ScaleReveal";
export { SlideIn } from "../../../src/remotion/components/SlideIn";

// Scene components
export { TitleCardScene } from "../../../src/remotion/components/scenes/TitleCardScene";
export { ScreenshotScene } from "../../../src/remotion/components/scenes/ScreenshotScene";
export { MetricsScene } from "../../../src/remotion/components/scenes/MetricsScene";
export { ScreenRecordingScene } from "../../../src/remotion/components/scenes/ScreenRecordingScene";
