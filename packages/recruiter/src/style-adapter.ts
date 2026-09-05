/**
 * Style Adapter for Outreach Messages
 *
 * Loads semantic style rules from Zikaron analysis and adjusts
 * outreach message generation to match user's communication patterns.
 *
 * Style rules come from: ~/.golems-zikaron/style/semantic-style-data.json
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { TopicStyle, SemanticStyleData } from "@golems/shared/lib/shared-types";

/** Re-export shared style types for backward compatibility */
export type { TopicStyle, SemanticStyleData } from "@golems/shared/lib/shared-types";

/** Style rules derived from Zikaron analysis for outreach messages */
export interface StyleGuidelines {
  /** Target formality (0=casual, 1=formal) */
  formality: number;
  /** Whether to use emoji */
  useEmoji: boolean;
  /** Emoji rate per message */
  emojiRate: number;
  /** Target sentence length (short/medium/long) */
  sentenceLength: "short" | "medium" | "long";
  /** Common phrases the user naturally uses */
  naturalPhrases: string[];
  /** Overall tone description */
  tone: string;
}

const STYLE_DATA_PATH = join(
  homedir(),
  ".golems-zikaron",
  "style",
  "semantic-style-data.json"
);

let cachedStyleData: SemanticStyleData | null = null;

/**
 * Load semantic style data from file
 */
export function loadStyleData(): SemanticStyleData | null {
  if (cachedStyleData) return cachedStyleData;

  if (!existsSync(STYLE_DATA_PATH)) {
    console.warn(`[StyleAdapter] No style data at ${STYLE_DATA_PATH}`);
    return null;
  }

  try {
    const content = readFileSync(STYLE_DATA_PATH, "utf-8");
    cachedStyleData = JSON.parse(content);
    return cachedStyleData;
  } catch (err) {
    console.error(`[StyleAdapter] Failed to load style data:`, err);
    return null;
  }
}

/**
 * Get style guidelines for outreach messages
 *
 * Uses the "explanatory" context (mostly English, longer messages)
 * with some traits from "professional" context.
 */
export function getOutreachStyleGuidelines(): StyleGuidelines {
  const data = loadStyleData();

  // Default guidelines if no data available
  const defaults: StyleGuidelines = {
    formality: 0.47,
    useEmoji: false,
    emojiRate: 0,
    sentenceLength: "medium",
    naturalPhrases: [],
    tone: "friendly professional",
  };

  if (!data?.topics) return defaults;

  // For outreach, blend "explanatory" (English-heavy) and "professional"
  const explanatory = data.topics.explanatory;
  const professional = data.topics.professional;

  if (!explanatory || !professional) return defaults;

  // Formality: average of explanatory and professional
  const formality = (explanatory.formality + professional.formality) / 2;

  // Emoji: use professional rate (very low for business communication)
  const emojiRate = professional.emoji_rate;
  const useEmoji = emojiRate > 0.02; // Only if naturally uses emoji

  // Sentence length based on explanatory avg_length
  // explanatory = 80 chars → medium
  let sentenceLength: "short" | "medium" | "long" = "medium";
  if (explanatory.avg_length < 50) sentenceLength = "short";
  else if (explanatory.avg_length > 120) sentenceLength = "long";

  // Natural phrases: combine both contexts, filter English-only
  const naturalPhrases = [
    ...explanatory.common_phrases,
    ...professional.common_phrases,
  ].filter(
    (phrase) =>
      // Keep English phrases only
      /^[a-zA-Z\s']+$/.test(phrase) &&
      // Skip very common phrases
      !["i am", "i ll", "for the", "in the", "of the", "to be"].includes(phrase)
  );

  // Tone description
  let tone = "friendly professional";
  if (formality > 0.6) tone = "formal and polished";
  else if (formality < 0.4) tone = "casual and direct";

  return {
    formality,
    useEmoji,
    emojiRate,
    sentenceLength,
    naturalPhrases: naturalPhrases.slice(0, 10),
    tone,
  };
}

/**
 * Apply style guidelines to a message body
 *
 * This is a light-touch adjustment, not a full rewrite.
 */
export function applyStyleToMessage(
  body: string,
  guidelines: StyleGuidelines
): string {
  let result = body;

  // Remove emojis if not natural for user
  if (!guidelines.useEmoji) {
    result = result.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}]/gu,
      ""
    );
  }

  // Clean up double spaces from emoji removal (preserve newlines)
  result = result.replace(/ {2,}/g, " ").trim();

  // Adjust formality markers
  if (guidelines.formality > 0.55) {
    // More formal: expand contractions
    result = result
      .replace(/\bI'm\b/g, "I am")
      .replace(/\bI'd\b/g, "I would")
      .replace(/\bI've\b/g, "I have")
      .replace(/\bdon't\b/g, "do not")
      .replace(/\bcan't\b/g, "cannot");
  }

  return result;
}

/**
 * Get a style-appropriate greeting
 */
export function getStyleAppropriateGreeting(
  firstName?: string,
  guidelines?: StyleGuidelines
): string {
  const style = guidelines || getOutreachStyleGuidelines();

  if (style.formality > 0.6) {
    return firstName ? `Dear ${firstName},` : "Dear Hiring Manager,";
  } else if (style.formality > 0.45) {
    return firstName ? `Hi ${firstName},` : "Hello,";
  } else {
    return firstName ? `Hey ${firstName}!` : "Hi there!";
  }
}

/**
 * Get a style-appropriate sign-off
 */
export function getStyleAppropriateSignOff(
  guidelines?: StyleGuidelines
): string {
  const style = guidelines || getOutreachStyleGuidelines();

  if (style.formality > 0.6) {
    return "Best regards,";
  } else if (style.formality > 0.45) {
    return "Best,";
  } else {
    return "Cheers,";
  }
}

/**
 * Generate style summary for debugging/display
 */
export function getStyleSummary(): string {
  const guidelines = getOutreachStyleGuidelines();

  return [
    `**Outreach Style Guidelines**`,
    `- Tone: ${guidelines.tone}`,
    `- Formality: ${(guidelines.formality * 10).toFixed(1)}/10`,
    `- Emoji: ${guidelines.useEmoji ? "occasionally" : "avoid"}`,
    `- Sentence length: ${guidelines.sentenceLength}`,
    `- Natural phrases: ${guidelines.naturalPhrases.slice(0, 5).join(", ")}`,
  ].join("\n");
}
