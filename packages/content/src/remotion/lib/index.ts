export type {
  AnimatedHeroProps,
  BrandColors,
  ElementAnimation,
  FloatDirection,
  HeroBackground,
  HeroElement,
  SlideDirection,
  SpringConfig,
  SpringPresetName,
  TextOverlay,
  TextVariant,
} from "./types";

export {
  brandPresets,
  CANVAS,
  defaultDark,
  FONT_FAMILY,
  SPACING,
  TYPOGRAPHY,
} from "./design-tokens";

export { LOADED_FONTS } from "./fonts";

export {
  clampedInterpolate,
  DURATIONS,
  SPRING_PRESETS,
  springProgress,
  staggerDelay,
} from "./motion";

export type {
  MetricItem,
  MetricsSceneProps,
  ProductHeroProps,
  Scene,
  SceneBase,
  SceneTransition,
  ScreenRecordingSceneProps,
  ScreenshotHighlight,
  ScreenshotSceneProps,
  TitleCardProps,
} from "./scenes";

export type {
  AudioMixProps,
  BackgroundMusicProps,
  NarrationProps,
  NarrationSegment,
  SoundEffectProps,
  SoundEffectTrigger,
  TTSConfig,
  TTSProvider,
} from "./audio";
