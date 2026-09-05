/**
 * Brand Configuration Schema
 *
 * Centralized brand config system for the content automation pipeline.
 * Each project (golems-showcase, techgym-posts, etc.) has a brand.json
 * that follows this schema. All content pipelines (Remotion, Flux, Satori,
 * data viz) read from brand.json to produce on-brand visuals.
 */

// --- Color System ---

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: {
    primary: string;
    secondary: string;
    onPrimary: string;
    onAccent: string;
  };
}

// --- Typography ---

export interface FontDefinition {
  family: string;
  weights: Record<string, number>;
  /** Google Fonts import URL or local path */
  source?: string;
}

export interface Typography {
  heading: FontDefinition;
  body: FontDefinition;
  code: FontDefinition;
  baseFontSize: number;
}

// --- Logos ---

export interface Logos {
  /** Primary logo — SVG preferred */
  default: string;
  /** Square/circular mark for avatars, favicons */
  mark?: string;
  /** Wordmark variant */
  wordmark?: string;
  /** Dark background variant */
  darkVariant?: string;
}

// --- Tone of Voice ---

export type EmojiUsage = "never" | "occasional" | "frequent";

export interface ToneOfVoice {
  /** 0 = very casual, 10 = very formal */
  formality: number;
  emojiUsage: EmojiUsage;
  /** Primary language (BCP47 tag) */
  language: string;
  /** Additional languages for multilingual content */
  secondaryLanguages?: string[];
  /** Short description of the voice (for LLM prompts) */
  voiceDescription: string;
}

// --- Social ---

export interface SocialConfig {
  handles: Record<string, string>;
  hashtags: string[];
  defaultCTA?: string;
}

// --- Template Overrides ---

export interface TemplateOverrides {
  animation?: {
    fps?: number;
    width?: number;
    height?: number;
    durationFrames?: number;
    defaultTransition?: string;
  };
  image?: {
    width?: number;
    height?: number;
    format?: "png" | "jpg" | "webp";
    quality?: number;
  };
  dataViz?: {
    chartColors?: string[];
    gridColor?: string;
    labelFont?: string;
  };
}

// --- Main Brand Config ---

export interface BrandConfig {
  /** Schema version for forward compatibility */
  $schema: string;
  /** Project display name */
  name: string;
  /** Short description */
  description: string;
  colors: ColorPalette;
  typography: Typography;
  logos: Logos;
  tone: ToneOfVoice;
  social: SocialConfig;
  templates?: TemplateOverrides;
}

// --- Validation ---

const REQUIRED_FIELDS: (keyof BrandConfig)[] = [
  "$schema",
  "name",
  "description",
  "colors",
  "typography",
  "logos",
  "tone",
  "social",
];

const REQUIRED_COLOR_FIELDS: (keyof ColorPalette)[] = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
];

const REQUIRED_TEXT_COLORS: string[] = [
  "primary",
  "secondary",
  "onPrimary",
  "onAccent",
];

export interface ValidationError {
  path: string;
  message: string;
}

export function validateBrandConfig(config: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!config || typeof config !== "object") {
    errors.push({ path: "$", message: "Config must be an object" });
    return errors;
  }

  const c = config as Record<string, unknown>;

  // Top-level required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in c)) {
      errors.push({ path: field, message: `Missing required field: ${field}` });
    }
  }

  // Schema version
  if (typeof c.$schema === "string" && c.$schema !== "1.0") {
    errors.push({
      path: "$schema",
      message: `Unsupported schema version: ${c.$schema}. Expected "1.0"`,
    });
  }

  // Validate required object fields have correct types
  const objectFields = ["colors", "typography", "logos", "tone", "social"] as const;
  for (const field of objectFields) {
    if (field in c && (typeof c[field] !== "object" || c[field] === null)) {
      errors.push({
        path: field,
        message: `${field} must be an object, got ${c[field] === null ? "null" : typeof c[field]}`,
      });
    }
  }

  // Colors
  if (c.colors && typeof c.colors === "object") {
    const colors = c.colors as Record<string, unknown>;
    for (const field of REQUIRED_COLOR_FIELDS) {
      if (field === "text") {
        if (!colors.text || typeof colors.text !== "object") {
          errors.push({ path: "colors.text", message: "Missing colors.text object" });
        } else {
          const text = colors.text as Record<string, unknown>;
          for (const tf of REQUIRED_TEXT_COLORS) {
            if (typeof text[tf] !== "string") {
              errors.push({
                path: `colors.text.${tf}`,
                message: `Missing or invalid: colors.text.${tf}`,
              });
            }
          }
        }
      } else if (typeof colors[field] !== "string") {
        errors.push({
          path: `colors.${field}`,
          message: `Missing or invalid: colors.${field}`,
        });
      }
    }
  }

  // Typography
  if (c.typography && typeof c.typography === "object") {
    const typo = c.typography as Record<string, unknown>;
    for (const slot of ["heading", "body", "code"] as const) {
      if (!typo[slot] || typeof typo[slot] !== "object") {
        errors.push({
          path: `typography.${slot}`,
          message: `Missing typography.${slot}`,
        });
      } else {
        const font = typo[slot] as Record<string, unknown>;
        if (typeof font.family !== "string") {
          errors.push({
            path: `typography.${slot}.family`,
            message: `Missing font family for ${slot}`,
          });
        }
        if (!font.weights || typeof font.weights !== "object") {
          errors.push({
            path: `typography.${slot}.weights`,
            message: `Missing font weights for ${slot}`,
          });
        }
      }
    }
    if (typeof typo.baseFontSize !== "number") {
      errors.push({
        path: "typography.baseFontSize",
        message: "Missing or invalid baseFontSize (must be number)",
      });
    }
  }

  // Logos
  if (c.logos && typeof c.logos === "object") {
    const logos = c.logos as Record<string, unknown>;
    if (typeof logos.default !== "string") {
      errors.push({
        path: "logos.default",
        message: "Missing logos.default path",
      });
    }
  }

  // Tone
  if (c.tone && typeof c.tone === "object") {
    const tone = c.tone as Record<string, unknown>;
    if (typeof tone.formality !== "number" || tone.formality < 0 || tone.formality > 10) {
      errors.push({
        path: "tone.formality",
        message: "tone.formality must be a number between 0 and 10",
      });
    }
    if (!["never", "occasional", "frequent"].includes(tone.emojiUsage as string)) {
      errors.push({
        path: "tone.emojiUsage",
        message: 'tone.emojiUsage must be "never", "occasional", or "frequent"',
      });
    }
    if (typeof tone.language !== "string") {
      errors.push({ path: "tone.language", message: "Missing tone.language" });
    }
    if (typeof tone.voiceDescription !== "string") {
      errors.push({
        path: "tone.voiceDescription",
        message: "Missing tone.voiceDescription",
      });
    }
  }

  // Social
  if (c.social && typeof c.social === "object") {
    const social = c.social as Record<string, unknown>;
    if (!social.handles || typeof social.handles !== "object") {
      errors.push({
        path: "social.handles",
        message: "Missing social.handles",
      });
    }
    if (!Array.isArray(social.hashtags)) {
      errors.push({
        path: "social.hashtags",
        message: "social.hashtags must be an array",
      });
    }
  }

  return errors;
}

/** Load and validate a brand config from a JSON file */
export async function loadBrandConfig(
  projectPath: string,
): Promise<{ config: BrandConfig; errors: ValidationError[] }> {
  const brandJsonPath = `${projectPath}/brand.json`;
  const file = Bun.file(brandJsonPath);

  if (!(await file.exists())) {
    return {
      config: {} as BrandConfig,
      errors: [{ path: brandJsonPath, message: "brand.json not found" }],
    };
  }

  let raw: unknown;
  try {
    raw = await file.json();
  } catch (e) {
    return {
      config: {} as BrandConfig,
      errors: [{
        path: brandJsonPath,
        message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      }],
    };
  }
  const errors = validateBrandConfig(raw);
  return { config: raw as BrandConfig, errors };
}
