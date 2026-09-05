/**
 * Remotion ProductHero — shared type definitions.
 *
 * All types here are JSON-serializable (no functions, no React elements)
 * so they can be used as Remotion composition defaultProps.
 */

// --- Brand Colors ---

export type BrandColors = {
  primary: string;
  primaryDark: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
};

// --- Spring Presets ---

export type SpringPresetName =
  | "snappy"
  | "smooth"
  | "bouncy"
  | "gentle"
  | "heavy";

export type SpringConfig = {
  stiffness: number;
  damping: number;
  mass: number;
};

// --- Element Animations (discriminated union) ---

export type ElementAnimation =
  | {
      type: "float";
      amplitude?: number;
      speed?: number;
      direction?: "vertical" | "horizontal" | "circular";
    }
  | { type: "bounce"; springPreset?: SpringPresetName }
  | {
      type: "slide";
      from: "left" | "right" | "top" | "bottom";
      distance?: number;
    }
  | { type: "fade" }
  | { type: "scale"; from?: number; springPreset?: SpringPresetName }
  | {
      type: "pulse";
      minScale?: number;
      maxScale?: number;
      period?: number;
    }
  | { type: "none" };

// --- Text Overlay ---

export type TextVariant = "title" | "subtitle" | "body" | "caption";

export type TextOverlay = {
  text: string;
  x: number;
  y: number;
  variant: TextVariant;
  entrance: ElementAnimation;
  entranceDelay: number;
  color?: string;
  rtl?: boolean;
};

// --- Hero Element ---

export type HeroElement = {
  id: string;
  src: string; // staticFile() path
  x: number;
  y: number;
  width?: number;
  height?: number;
  entrance: ElementAnimation;
  entranceDelay: number;
  ambient?: ElementAnimation;
  zIndex?: number;
};

// --- Background ---

export type HeroBackground =
  | { type: "image"; src: string; fadeInFrames?: number }
  | { type: "gradient"; gradient: string; fadeInFrames?: number }
  | { type: "color"; color: string; fadeInFrames?: number };

// --- AnimatedHero Props (main composition input) ---

export type AnimatedHeroProps = {
  background: HeroBackground;
  elements: HeroElement[];
  brand: BrandColors;
  textOverlays?: TextOverlay[];
};

// --- Slide Direction ---

export type SlideDirection = "left" | "right" | "top" | "bottom";

// --- Float Direction ---

export type FloatDirection = "vertical" | "horizontal" | "circular";
