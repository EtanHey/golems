/**
 * Style Export - Portable Style Summary
 *
 * Reads Zikaron's semantic-style-data.json and exports a human-readable
 * markdown "style card" for use in Claude Chat project instructions.
 *
 * Usage:
 *   import { exportStyleCard, parseStyleData } from "./lib/style-export";
 *   const card = exportStyleCard(parseStyleData(jsonString));
 *
 * CLI:
 *   bun run src/lib/style-export.ts [output-path]
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SemanticStyleData } from "./shared-types";

/** Re-export for backward compatibility */
export type { TopicStyle } from "./shared-types";
/** Re-export SemanticStyleData as StyleData for backward compatibility */
export type { SemanticStyleData as StyleData } from "./shared-types";

// Keep StyleData as alias for SemanticStyleData
type StyleData = SemanticStyleData;

const DEFAULT_STYLE_PATH = join(
  process.env.HOME || "~",
  ".golems-zikaron/style/semantic-style-data.json"
);

/** Parse raw JSON into validated StyleData */
export function parseStyleData(json: string): StyleData {
  const data = JSON.parse(json);
  if (!data.topics || typeof data.topics !== "object") {
    throw new Error("Invalid style data: missing 'topics' key");
  }
  return data as StyleData;
}

function pct(n: number): string {
  const p = n * 100;
  if (p < 1 && p > 0) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Generate a human-readable markdown style card from style data */
export function exportStyleCard(data: StyleData): string {
  const lines: string[] = [];

  lines.push("# Owner Communication Style Card");
  lines.push("");
  lines.push("> Generated from Zikaron semantic style analysis.");
  lines.push(
    "> Upload alongside golem instructions to personalize responses."
  );
  lines.push(`> Last updated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Overview table
  const topics = Object.entries(data.topics);
  const avgFormality =
    topics.reduce((sum, [, t]) => sum + t.formality, 0) / topics.length;
  const avgEmoji =
    topics.reduce((sum, [, t]) => sum + t.emoji_rate, 0) / topics.length;
  const minLen = Math.round(
    Math.min(...topics.map(([, t]) => t.avg_length))
  );
  const maxLen = Math.round(
    Math.max(...topics.map(([, t]) => t.avg_length))
  );

  lines.push("## Overview");
  lines.push("");
  lines.push("| Trait | Value |");
  lines.push("|-------|-------|");
  lines.push(
    `| Overall Formality | Low (${avgFormality.toFixed(2)} average) |`
  );
  lines.push(
    "| Primary Languages | Hebrew + English (code-switches by context) |"
  );
  lines.push(`| Emoji Usage | Minimal (${pct(avgEmoji)} average) |`);
  lines.push(
    `| Message Length | Varies by context (${minLen}-${maxLen} chars avg) |`
  );
  lines.push("| Tone | Friendly, direct, occasionally playful/sarcastic |");
  lines.push("");

  // Per-topic sections
  lines.push("## By Context");
  lines.push("");

  for (const [name, style] of topics) {
    // Normalize language mix so percentages sum to 100%
    const langTotal = style.language_mix.hebrew + style.language_mix.english;
    const normHebrew = langTotal > 0 ? style.language_mix.hebrew / langTotal : 0.5;
    const normEnglish = langTotal > 0 ? style.language_mix.english / langTotal : 0.5;

    const primaryLang = normHebrew > normEnglish ? "Hebrew" : "English";
    const secondaryLang = primaryLang === "Hebrew" ? "English" : "Hebrew";
    const primaryPct = pct(Math.max(normHebrew, normEnglish));
    const secondaryPct = pct(Math.min(normHebrew, normEnglish));

    lines.push(`### ${capitalize(name)}`);
    lines.push(`- **Length:** ~${Math.round(style.avg_length)} chars avg`);
    lines.push(
      `- **Language:** ${primaryPct} ${primaryLang}, ${secondaryPct} ${secondaryLang}`
    );
    lines.push(`- **Formality:** ${style.formality.toFixed(2)}`);
    lines.push(`- **Emoji:** ${pct(style.emoji_rate)}`);
    lines.push("");
  }

  // Insights
  if (data.insights && data.insights.length > 0) {
    lines.push("## Insights");
    lines.push("");
    for (const insight of data.insights) {
      lines.push(`- ${insight}`);
    }
    lines.push("");
  }

  // Rules section
  lines.push("## Rules for Matching This Style");
  lines.push("");
  lines.push(
    "1. **Default to casual** unless the topic demands otherwise"
  );
  lines.push(
    "2. **Hebrew for casual/professional**, English for technical/explanatory"
  );
  lines.push(
    "3. **Never use excessive emojis** - 1 per message max, often zero"
  );
  lines.push(
    '4. **Keep it short** - if you can say it in 1 sentence, don\'t use 3'
  );
  lines.push(
    '5. **No corporate speak** - "hey" not "Dear", "yeah" not "Certainly"'
  );
  lines.push(
    '6. **Contractions always** - "don\'t", "it\'s", "you\'re" (formality < 0.55)'
  );
  lines.push("7. **Sarcasm is OK** when appropriate, but keep it light");
  lines.push("");

  // Outreach section
  lines.push("## For Outreach Messages");
  lines.push("");
  lines.push('Blend "professional" and "explanatory" styles:');

  const prof = data.topics["professional"];
  const expl = data.topics["explanatory"];
  if (prof && expl) {
    const blendedFormality = ((prof.formality + expl.formality) / 2).toFixed(
      2
    );
    lines.push(
      `- Formality: ~${blendedFormality} (friendly but not too casual)`
    );
  }
  lines.push(
    "- Language: English (outreach is to English-speaking contacts)"
  );
  lines.push("- Emoji: Almost none");
  lines.push("- Length: Medium sentences");
  lines.push(
    '- Greeting: "Hey [Name]" not "Dear [Name]" or "Hi [Name],"'
  );
  lines.push(
    '- Sign-off: "Cheers" or just name, not "Best regards"'
  );
  lines.push("");

  return lines.join("\n");
}

// CLI entrypoint
if (import.meta.main) {
  const outputPath =
    process.argv[2] ||
    join(
      process.env.HOME || "~",
      "Gits/golems/contexts/claude-chat/style-card.md"
    );

  try {
    const json = readFileSync(DEFAULT_STYLE_PATH, "utf-8");
    const data = parseStyleData(json);
    const card = exportStyleCard(data);
    writeFileSync(outputPath, card);
    console.log(`Style card written to: ${outputPath}`);
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error(
      `Make sure Zikaron style data exists at: ${DEFAULT_STYLE_PATH}`
    );
    process.exit(1);
  }
}
