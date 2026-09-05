#!/usr/bin/env bun
/**
 * Style Card v2 — Build per-context style profiles from Zikaron data
 *
 * Queries WhatsApp + Claude Code + YouTube chunks from Zikaron (SQLite),
 * computes language, formality, length, emoji, and pattern metrics,
 * then stores profiles in Supabase and generates a style card markdown.
 *
 * Config (env vars):
 *   GOLEMS_OWNER_NAME    — Filter LinkedIn messages by sender (default: "Owner")
 *   LINKEDIN_EXPORT_DIR  — LinkedIn export path (default: docs.local/linkedin/ or ~/Downloads)
 *
 * Usage:
 *   bun scripts/build-style-profiles.ts              # Build all profiles
 *   bun scripts/build-style-profiles.ts --card-only   # Just regenerate card from Supabase
 *   bun scripts/build-style-profiles.ts --dry-run     # Compute but don't save
 *   bun scripts/build-style-profiles.ts --linkedin=/path/to/export  # Explicit LinkedIn path
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Database } from "bun:sqlite";

// ─── Types ──────────────────────────────────────────────────────

interface StyleProfile {
  context: string;
  language: string | null;
  formality_score: number;
  avg_message_length: number;
  emoji_rate: number;
  top_emojis: string[];
  patterns: Record<string, any>;
  topic_clusters: Record<string, number>;
  sample_count: number;
  raw_metrics: Record<string, any>;
}

// ─── Config ─────────────────────────────────────────────────────

const ZIKARON_DB = join(homedir(), ".local/share/zikaron/zikaron.db");
const STYLE_CARD_PATH = join(homedir(), ".golems-zikaron/style/style-card-v2.md");
const STYLE_DATA_PATH = join(homedir(), ".golems-zikaron/style/style-profiles-v2.json");

// LinkedIn export path — checks docs.local/linkedin/ first, then ~/Downloads
// Override with --linkedin=PATH or LINKEDIN_EXPORT_DIR env
const LINKEDIN_DIR_DEFAULT = process.env.LINKEDIN_EXPORT_DIR
  || (existsSync(join(process.cwd(), "docs.local/linkedin")) ? join(process.cwd(), "docs.local/linkedin") : join(homedir(), "Downloads"));
// Owner name(s) for filtering "my messages" in LinkedIn export
// Comma-separated for variations (e.g. "Jane Doe,Jane A. Doe")
const OWNER_NAMES = (process.env.GOLEMS_OWNER_NAME || "Owner")
  .split(",")
  .map(n => n.trim().toLowerCase());

/**
 * Auto-discover LinkedIn export directory within a base path.
 * Looks for folders matching "Complete_LinkedInDataExport*" or containing messages.csv.
 */
function findLinkedInExport(basePath: string): string {
  if (!existsSync(basePath)) return basePath;

  // If basePath itself has messages.csv, it IS the export
  if (existsSync(join(basePath, "messages.csv"))) return basePath;

  // Scan for LinkedIn export folders
  try {
    const entries = readdirSync(basePath);
    const match = entries
      .filter(e => e.toLowerCase().includes("linkedindataexport"))
      .sort()
      .pop(); // most recent by name
    if (match) return join(basePath, match);
  } catch { /* not a directory */ }

  return basePath;
}

// ─── CSV Parser (handles quoted multi-line fields) ─────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      if (text[i] === '"') {
        // Quoted field — consume until closing quote
        i++; // skip opening quote
        let field = "";
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2; // escaped quote
            } else {
              i++; // closing quote
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
        row.push(field);
        // Skip comma or newline after quoted field
        if (i < len && text[i] === ',') i++;
        else if (i < len && (text[i] === '\n' || text[i] === '\r')) {
          if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i += 2;
          else i++;
          break;
        }
      } else if (text[i] === '\n' || text[i] === '\r') {
        // End of row (empty last field)
        row.push("");
        if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i += 2;
        else i++;
        break;
      } else {
        // Unquoted field
        let field = "";
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i];
          i++;
        }
        row.push(field);
        if (i < len && text[i] === ',') i++;
        else if (i < len && (text[i] === '\n' || text[i] === '\r')) {
          if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i += 2;
          else i++;
          break;
        }
      }
    }
    if (row.length > 0 && !(row.length === 1 && row[0] === "")) {
      rows.push(row);
    }
  }
  return rows;
}

function stripHTML(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Emoji regex (basic — catches common unicode emoji ranges)
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/gu;

// Hebrew character range
const HEBREW_RE = /[\u0590-\u05FF]/g;

// ─── Zikaron Queries ────────────────────────────────────────────

function openZikaron(): Database {
  return new Database(ZIKARON_DB, { readonly: true });
}

interface ChunkRow {
  content: string;
  language: string | null;
  sender: string | null;
  project: string | null;
  char_count: number;
}

function queryWhatsApp(db: Database): ChunkRow[] {
  return db.query(
    `SELECT content, language, sender, project, char_count
     FROM chunks WHERE source = 'whatsapp' AND LENGTH(content) > 5`
  ).all() as ChunkRow[];
}

function queryCCUserMessages(db: Database): ChunkRow[] {
  // Filter out system prompts and CLAUDE.md content that gets classified as user_message
  // Real user messages are typically <500 chars and don't contain markdown headers
  return db.query(
    `SELECT content, language, sender, project, char_count
     FROM chunks WHERE content_type = 'user_message'
     AND LENGTH(content) > 10 AND LENGTH(content) < 500
     AND content NOT LIKE '%## %'
     AND content NOT LIKE '%CLAUDE.md%'
     AND content NOT LIKE '%system-reminder%'
     AND content NOT LIKE '%IMPORTANT:%'`
  ).all() as ChunkRow[];
}

// ─── Analysis Functions ─────────────────────────────────────────

function detectLanguage(text: string): "hebrew" | "english" | "mixed" {
  const hebrewChars = (text.match(HEBREW_RE) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const total = hebrewChars + latinChars;
  if (total === 0) return "mixed";
  const hebrewRatio = hebrewChars / total;
  if (hebrewRatio > 0.7) return "hebrew";
  if (hebrewRatio < 0.3) return "english";
  return "mixed";
}

function countEmojis(text: string): { count: number; emojis: string[] } {
  const matches = text.match(EMOJI_RE) || [];
  return { count: matches.length, emojis: matches };
}

function estimateFormality(text: string, lang: "hebrew" | "english" | "mixed"): number {
  // Simple heuristic: 1 (very casual) to 10 (very formal)
  let score = 5;

  // Length-based: very short = casual
  if (text.length < 30) score -= 1;
  if (text.length < 15) score -= 1;
  if (text.length > 200) score += 1;

  // Punctuation: proper periods/question marks = more formal
  if (text.endsWith(".") || text.endsWith("?") || text.endsWith("!")) score += 0.5;
  if (!text.match(/[.?!]$/)) score -= 0.5;

  // Casual markers
  const casualMarkers = /\b(lol|haha|yeah|nah|nope|wdyt|btw|idk|imo|tbh|lmao|omg|bruh)\b/i;
  const hebrewCasual = /חחח|חח|אחלה|סבבה|יאללה|בסדר|תודה רבה/;
  if (casualMarkers.test(text)) score -= 1.5;
  if (hebrewCasual.test(text)) score -= 1;

  // Formal markers
  const formalMarkers = /\b(regarding|furthermore|please note|kindly|therefore|consequently)\b/i;
  if (formalMarkers.test(text)) score += 2;

  // Contractions = casual
  if (/\b(don't|can't|won't|it's|I'm|you're|they're|we're|isn't|aren't)\b/.test(text)) score -= 0.5;

  // Emojis = casual
  const emojiCount = countEmojis(text).count;
  if (emojiCount > 0) score -= 0.5;
  if (emojiCount > 2) score -= 1;

  // Capitalization: ALL CAPS or no caps = casual
  if (text === text.toLowerCase()) score -= 0.3;
  if (text === text.toUpperCase() && text.length > 5) score -= 0.5;

  return Math.max(1, Math.min(10, score));
}

function extractPatterns(messages: string[]): Record<string, any> {
  const patterns: Record<string, any> = {};

  // Question rate
  const questions = messages.filter(m => m.includes("?")).length;
  patterns.question_rate = questions / messages.length;

  // Link sharing rate
  const links = messages.filter(m => /https?:\/\//.test(m)).length;
  patterns.link_sharing_rate = links / messages.length;

  // Multi-line messages
  const multiline = messages.filter(m => m.includes("\n")).length;
  patterns.multiline_rate = multiline / messages.length;

  // Average words per message
  const totalWords = messages.reduce((sum, m) => sum + m.split(/\s+/).length, 0);
  patterns.avg_words = totalWords / messages.length;

  // Starts with lowercase (casual indicator)
  const lowercaseStart = messages.filter(m => /^[a-z]/.test(m)).length;
  patterns.lowercase_start_rate = lowercaseStart / messages.length;

  // Command/imperative style (for CC messages)
  const imperative = messages.filter(m =>
    /^(fix|add|update|remove|create|change|make|run|check|show|move|delete|rename|read|write|set|get|find|use|try|do|let|go)/i.test(m)
  ).length;
  patterns.imperative_rate = imperative / messages.length;

  return patterns;
}

// ─── Profile Builders ───────────────────────────────────────────

function buildWhatsAppProfile(chunks: ChunkRow[]): StyleProfile {
  const messages = chunks.map(c => c.content);
  const emojiCounts: Record<string, number> = {};
  let totalEmojis = 0;

  const langDist = { hebrew: 0, english: 0, mixed: 0 };

  for (let i = 0; i < chunks.length; i++) {
    const msg = chunks[i].content;
    const { count, emojis } = countEmojis(msg);
    totalEmojis += count;
    for (const e of emojis) {
      emojiCounts[e] = (emojiCounts[e] || 0) + 1;
    }
    // DB stores 2-letter codes: "he", "en", "mixed"
    const rawLang = chunks[i].language;
    const lang = rawLang === "he" ? "hebrew" : rawLang === "en" ? "english" : rawLang === "mixed" ? "mixed" : detectLanguage(msg);
    langDist[lang]++;
  }

  const formalities = messages.map(m => estimateFormality(m, "mixed"));
  const avgFormality = formalities.reduce((a, b) => a + b, 0) / formalities.length;
  const avgLength = messages.reduce((sum, m) => sum + m.length, 0) / messages.length;
  const emojiRate = totalEmojis / messages.length;

  // Top emojis
  const topEmojis = Object.entries(emojiCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emoji, count]) => `${emoji} (${count})`);

  const patterns = extractPatterns(messages);

  return {
    context: "whatsapp",
    language: langDist.hebrew > langDist.english ? "hebrew" : "english",
    formality_score: Math.round(avgFormality * 10) / 10,
    avg_message_length: Math.round(avgLength),
    emoji_rate: Math.round(emojiRate * 1000) / 1000,
    top_emojis: topEmojis,
    patterns,
    topic_clusters: {},
    sample_count: messages.length,
    raw_metrics: {
      language_distribution: langDist,
      total_emojis: totalEmojis,
      formality_histogram: {
        "1-3": formalities.filter(f => f <= 3).length,
        "4-6": formalities.filter(f => f > 3 && f <= 6).length,
        "7-10": formalities.filter(f => f > 6).length,
      },
    },
  };
}

function buildCCProfile(chunks: ChunkRow[]): StyleProfile {
  const messages = chunks.map(c => c.content);

  const langDist = { hebrew: 0, english: 0, mixed: 0 };
  for (const msg of messages) {
    const lang = detectLanguage(msg);
    langDist[lang]++;
  }

  const formalities = messages.map(m => estimateFormality(m, "english"));
  const avgFormality = formalities.reduce((a, b) => a + b, 0) / formalities.length;
  const avgLength = messages.reduce((sum, m) => sum + m.length, 0) / messages.length;

  const emojiCounts: Record<string, number> = {};
  let totalEmojis = 0;
  for (const msg of messages) {
    const { count, emojis } = countEmojis(msg);
    totalEmojis += count;
    for (const e of emojis) {
      emojiCounts[e] = (emojiCounts[e] || 0) + 1;
    }
  }
  const emojiRate = totalEmojis / messages.length;

  const topEmojis = Object.entries(emojiCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emoji, count]) => `${emoji} (${count})`);

  const patterns = extractPatterns(messages);

  // Project distribution
  const projectDist: Record<string, number> = {};
  for (const chunk of chunks) {
    const p = chunk.project || "unknown";
    projectDist[p] = (projectDist[p] || 0) + 1;
  }

  // Length distribution
  const lengthBuckets = {
    "short (<50 chars)": messages.filter(m => m.length < 50).length,
    "medium (50-200)": messages.filter(m => m.length >= 50 && m.length < 200).length,
    "long (200-500)": messages.filter(m => m.length >= 200 && m.length < 500).length,
    "very long (500+)": messages.filter(m => m.length >= 500).length,
  };

  return {
    context: "claude_code",
    language: "english",
    formality_score: Math.round(avgFormality * 10) / 10,
    avg_message_length: Math.round(avgLength),
    emoji_rate: Math.round(emojiRate * 1000) / 1000,
    top_emojis: topEmojis,
    patterns,
    topic_clusters: projectDist,
    sample_count: messages.length,
    raw_metrics: {
      language_distribution: langDist,
      total_emojis: totalEmojis,
      length_distribution: lengthBuckets,
      formality_histogram: {
        "1-3": formalities.filter(f => f <= 3).length,
        "4-6": formalities.filter(f => f > 3 && f <= 6).length,
        "7-10": formalities.filter(f => f > 6).length,
      },
    },
  };
}

// ─── LinkedIn Data Loaders ──────────────────────────────────────

interface LinkedInMessage {
  content: string;
  from: string;
  date: string;
}

function loadLinkedInMessages(dir: string): LinkedInMessage[] {
  const path = join(dir, "messages.csv");
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, "utf-8");
  const rows = parseCSV(raw);
  if (rows.length < 2) return [];

  // Header: CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,ATTACHMENTS
  const header = rows[0];
  const fromIdx = header.indexOf("FROM");
  const contentIdx = header.indexOf("CONTENT");
  const dateIdx = header.indexOf("DATE");

  const messages: LinkedInMessage[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const from = row[fromIdx] || "";
    const rawContent = row[contentIdx] || "";
    const content = stripHTML(rawContent).trim();
    if (OWNER_NAMES.includes(from.toLowerCase()) && content.length > 3) {
      messages.push({ content, from, date: row[dateIdx] || "" });
    }
  }
  return messages;
}

function loadLinkedInComments(dir: string): string[] {
  const path = join(dir, "Comments.csv");
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, "utf-8");
  const rows = parseCSV(raw);
  if (rows.length < 2) return [];

  // Header: Date,Link,Message
  const msgIdx = rows[0].indexOf("Message");
  return rows.slice(1)
    .map(r => (r[msgIdx] || "").trim())
    .filter(m => m.length > 3);
}

function loadLinkedInShares(dir: string): string[] {
  const path = join(dir, "Shares.csv");
  if (!existsSync(path)) return [];

  const raw = readFileSync(path, "utf-8");
  const rows = parseCSV(raw);
  if (rows.length < 2) return [];

  // Header: Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility
  const commentaryIdx = rows[0].indexOf("ShareCommentary");
  return rows.slice(1)
    .map(r => (r[commentaryIdx] || "").trim())
    .filter(m => m.length > 10);
}

function buildLinkedInProfile(dir: string): StyleProfile | null {
  const dms = loadLinkedInMessages(dir);
  const comments = loadLinkedInComments(dir);
  const shares = loadLinkedInShares(dir);

  const dmTexts = dms.map(m => m.content);
  const allMessages = [...dmTexts, ...comments, ...shares];

  if (allMessages.length === 0) return null;

  const langDist = { hebrew: 0, english: 0, mixed: 0 };
  const emojiCounts: Record<string, number> = {};
  let totalEmojis = 0;

  for (const msg of allMessages) {
    const lang = detectLanguage(msg);
    langDist[lang]++;
    const { count, emojis } = countEmojis(msg);
    totalEmojis += count;
    for (const e of emojis) {
      emojiCounts[e] = (emojiCounts[e] || 0) + 1;
    }
  }

  const formalities = allMessages.map(m => estimateFormality(m, "mixed"));
  const avgFormality = formalities.reduce((a, b) => a + b, 0) / formalities.length;
  const avgLength = allMessages.reduce((sum, m) => sum + m.length, 0) / allMessages.length;
  const emojiRate = totalEmojis / allMessages.length;

  const topEmojis = Object.entries(emojiCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emoji, count]) => `${emoji} (${count})`);

  const patterns = extractPatterns(allMessages);

  // Sub-context breakdown
  const dmFormalities = dmTexts.length > 0
    ? dmTexts.map(m => estimateFormality(m, "mixed")).reduce((a, b) => a + b, 0) / dmTexts.length
    : 0;
  const commentFormalities = comments.length > 0
    ? comments.map(m => estimateFormality(m, "mixed")).reduce((a, b) => a + b, 0) / comments.length
    : 0;
  const shareFormalities = shares.length > 0
    ? shares.map(m => estimateFormality(m, "mixed")).reduce((a, b) => a + b, 0) / shares.length
    : 0;

  return {
    context: "linkedin",
    language: langDist.hebrew > langDist.english ? "hebrew" : "english",
    formality_score: Math.round(avgFormality * 10) / 10,
    avg_message_length: Math.round(avgLength),
    emoji_rate: Math.round(emojiRate * 1000) / 1000,
    top_emojis: topEmojis,
    patterns,
    topic_clusters: {},
    sample_count: allMessages.length,
    raw_metrics: {
      language_distribution: langDist,
      total_emojis: totalEmojis,
      sub_contexts: {
        dms: { count: dmTexts.length, avg_length: dmTexts.length > 0 ? Math.round(dmTexts.reduce((s, m) => s + m.length, 0) / dmTexts.length) : 0, formality: Math.round(dmFormalities * 10) / 10 },
        comments: { count: comments.length, avg_length: comments.length > 0 ? Math.round(comments.reduce((s, m) => s + m.length, 0) / comments.length) : 0, formality: Math.round(commentFormalities * 10) / 10 },
        shares: { count: shares.length, avg_length: shares.length > 0 ? Math.round(shares.reduce((s, m) => s + m.length, 0) / shares.length) : 0, formality: Math.round(shareFormalities * 10) / 10 },
      },
      formality_histogram: {
        "1-3": formalities.filter(f => f <= 3).length,
        "4-6": formalities.filter(f => f > 3 && f <= 6).length,
        "7-10": formalities.filter(f => f > 6).length,
      },
    },
  };
}

// ─── Style Card Generator ───────────────────────────────────────

function generateStyleCard(profiles: StyleProfile[]): string {
  const lines: string[] = [];

  lines.push("# Owner Communication Style Card v2");
  lines.push("");
  lines.push("> Generated from Zikaron + LinkedIn data — WhatsApp, Claude Code, LinkedIn.");
  lines.push(`> Last updated: ${new Date().toISOString().split("T")[0]}`);
  lines.push(`> Total samples analyzed: ${profiles.reduce((s, p) => s + p.sample_count, 0).toLocaleString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Overview
  const wa = profiles.find(p => p.context === "whatsapp");
  const cc = profiles.find(p => p.context === "claude_code");
  const li = profiles.find(p => p.context === "linkedin");

  lines.push("## Quick Reference");
  lines.push("");
  lines.push("| Trait | WhatsApp | Claude Code | LinkedIn |");
  lines.push("|-------|----------|-------------|----------|");

  const fmtLang = (p: StyleProfile | undefined) => {
    if (!p) return "—";
    const ld = p.raw_metrics.language_distribution;
    const dominant = ld.hebrew > ld.english ? "Hebrew" : "English";
    const pct = Math.round(Math.max(ld.hebrew, ld.english) / p.sample_count * 100);
    return `${dominant} (${pct}%)`;
  };
  lines.push(`| Language | ${fmtLang(wa)} | ${fmtLang(cc)} | ${fmtLang(li)} |`);
  lines.push(`| Formality | ${wa?.formality_score.toFixed(1) || "—"}/10 | ${cc?.formality_score.toFixed(1) || "—"}/10 | ${li?.formality_score.toFixed(1) || "—"}/10 |`);
  lines.push(`| Avg Length | ${wa?.avg_message_length || "—"} chars | ${cc?.avg_message_length || "—"} chars | ${li?.avg_message_length || "—"} chars |`);
  lines.push(`| Emoji Rate | ${wa ? (wa.emoji_rate * 100).toFixed(1) + "%" : "—"} | ${cc ? (cc.emoji_rate * 100).toFixed(1) + "%" : "—"} | ${li ? (li.emoji_rate * 100).toFixed(1) + "%" : "—"} |`);
  lines.push("");

  // Per-context sections
  for (const profile of profiles) {
    const contextLabel = profile.context === "whatsapp" ? "WhatsApp Style"
      : profile.context === "claude_code" ? "Claude Code Instructions Style"
      : profile.context === "linkedin" ? "LinkedIn Style"
      : profile.context;
    lines.push(`## ${contextLabel}`);
    lines.push("");
    lines.push(`**${profile.sample_count.toLocaleString()} messages analyzed**`);
    lines.push("");

    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Primary Language | ${profile.language || "mixed"} |`);
    lines.push(`| Formality | ${profile.formality_score}/10 — ${profile.formality_score <= 3 ? "very casual" : profile.formality_score <= 5 ? "casual" : "moderate"} |`);
    lines.push(`| Avg Message Length | ${profile.avg_message_length} chars |`);
    lines.push(`| Emoji Rate | ${(profile.emoji_rate * 100).toFixed(1)}% of messages |`);
    lines.push(`| Question Rate | ${(profile.patterns.question_rate * 100).toFixed(0)}% |`);
    lines.push(`| Link Sharing | ${(profile.patterns.link_sharing_rate * 100).toFixed(1)}% |`);
    if (profile.patterns.imperative_rate > 0.01) {
      lines.push(`| Imperative Commands | ${(profile.patterns.imperative_rate * 100).toFixed(0)}% |`);
    }
    lines.push(`| Avg Words/Message | ${profile.patterns.avg_words.toFixed(1)} |`);
    lines.push("");

    if (profile.top_emojis.length > 0) {
      lines.push(`**Top Emojis:** ${profile.top_emojis.slice(0, 5).join(", ")}`);
      lines.push("");
    }

    // Language distribution
    const langDist = profile.raw_metrics.language_distribution;
    if (langDist) {
      const total = langDist.hebrew + langDist.english + langDist.mixed;
      lines.push("**Language Mix:**");
      lines.push(`- Hebrew: ${Math.round(langDist.hebrew / total * 100)}%`);
      lines.push(`- English: ${Math.round(langDist.english / total * 100)}%`);
      lines.push(`- Mixed: ${Math.round(langDist.mixed / total * 100)}%`);
      lines.push("");
    }

    // Length distribution (CC only)
    const lengthDist = profile.raw_metrics.length_distribution;
    if (lengthDist) {
      lines.push("**Message Length Distribution:**");
      for (const [bucket, count] of Object.entries(lengthDist) as [string, number][]) {
        lines.push(`- ${bucket}: ${Math.round(count / profile.sample_count * 100)}%`);
      }
      lines.push("");
    }

    // Topic clusters (CC only — project distribution)
    if (profile.context === "claude_code" && Object.keys(profile.topic_clusters).length > 0) {
      const sorted = Object.entries(profile.topic_clusters)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 8);
      lines.push("**Top Projects:**");
      for (const [project, count] of sorted) {
        lines.push(`- ${project}: ${(count as number).toLocaleString()} messages`);
      }
      lines.push("");
    }

    // LinkedIn sub-contexts
    const subContexts = profile.raw_metrics.sub_contexts;
    if (subContexts) {
      lines.push("**Sub-Contexts:**");
      lines.push(`- DMs: ${subContexts.dms.count} messages, avg ${subContexts.dms.avg_length} chars, formality ${subContexts.dms.formality}/10`);
      lines.push(`- Comments: ${subContexts.comments.count} comments, avg ${subContexts.comments.avg_length} chars, formality ${subContexts.comments.formality}/10`);
      lines.push(`- Posts/Shares: ${subContexts.shares.count} posts, avg ${subContexts.shares.avg_length} chars, formality ${subContexts.shares.formality}/10`);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  // Rules
  lines.push("## Rules for Matching This Style");
  lines.push("");
  lines.push("### When Writing as Etan (Telegram, WhatsApp):");
  lines.push('1. **Ultra casual** — "hey" not "Dear", "yeah" not "Certainly"');
  lines.push("2. **Hebrew-first** for personal/social, English for technical");
  lines.push("3. **Short and direct** — 1-3 sentences max");
  lines.push('4. **Emojis sparingly** — 🫶 is the signature, not 🎉🎊🥳');
  lines.push("5. **Never overexplain** — trust the reader to get context");
  lines.push("");
  lines.push("### When Executing Claude Code Tasks:");
  lines.push("1. **Imperative style** — \"fix this\", \"add body\", \"run tests\"");
  lines.push("2. **English always** for code instructions");
  lines.push("3. **Reference prior context** — \"like we did with X\"");
  lines.push("4. **Quick iteration** — try it, see result, adjust");
  lines.push("5. **No hand-holding** — assume competence, skip explanations");
  lines.push("");
  lines.push("### When Writing LinkedIn Content:");
  lines.push("1. **Bilingual** — Hebrew for Israeli audience, English for international");
  lines.push("2. **DMs are casual** — like WhatsApp, short and direct");
  lines.push("3. **Posts are structured** — bullet points, emojis for section markers");
  lines.push("4. **Comments are brief** — 1-2 sentences, conversational");
  lines.push("5. **Technical credibility** — mention tools, repos, specifics");
  lines.push("");

  return lines.join("\n");
}

// ─── Supabase Storage ───────────────────────────────────────────

async function saveToSupabase(profiles: StyleProfile[]): Promise<void> {
  try {
    const { getSupabase } = await import("../packages/shared/src/lib/supabase-factory");
    const supabase = getSupabase();

    for (const profile of profiles) {
      const { error } = await supabase
        .from("style_profiles")
        .upsert({
          context: profile.context,
          language: profile.language,
          formality_score: profile.formality_score,
          avg_message_length: profile.avg_message_length,
          emoji_rate: profile.emoji_rate,
          top_emojis: profile.top_emojis,
          patterns: profile.patterns,
          topic_clusters: profile.topic_clusters,
          sample_count: profile.sample_count,
          raw_metrics: profile.raw_metrics,
          last_updated: new Date().toISOString(),
        }, { onConflict: "context,language" });

      if (error) {
        console.error(`Failed to upsert ${profile.context}:`, error.message);
      } else {
        console.log(`  Saved ${profile.context} profile to Supabase`);
      }
    }
  } catch (err) {
    console.error("Supabase save failed (will still save locally):", err);
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cardOnly = args.includes("--card-only");
  const linkedinArg = args.find(a => a.startsWith("--linkedin="));
  const linkedinDir = linkedinArg
    ? linkedinArg.substring(linkedinArg.indexOf("=") + 1)
    : findLinkedInExport(LINKEDIN_DIR_DEFAULT);

  console.log("=== Style Card v2 Builder ===\n");

  if (cardOnly) {
    // Just read existing profiles from JSON and regenerate card
    try {
      const data = JSON.parse(readFileSync(STYLE_DATA_PATH, "utf-8"));
      const card = generateStyleCard(data);
      writeFileSync(STYLE_CARD_PATH, card);
      console.log(`Style card regenerated: ${STYLE_CARD_PATH}`);
    } catch (err) {
      console.error("No existing profiles found. Run without --card-only first.");
    }
    return;
  }

  // Open Zikaron DB
  console.log(`Reading from: ${ZIKARON_DB}`);
  const db = openZikaron();

  // Build profiles
  const profiles: StyleProfile[] = [];

  // 1. WhatsApp
  console.log("\n1. Analyzing WhatsApp messages...");
  const waChunks = queryWhatsApp(db);
  console.log(`   Found ${waChunks.length.toLocaleString()} messages`);
  if (waChunks.length > 0) {
    const waProfile = buildWhatsAppProfile(waChunks);
    profiles.push(waProfile);
    console.log(`   Formality: ${waProfile.formality_score}/10`);
    console.log(`   Avg length: ${waProfile.avg_message_length} chars`);
    console.log(`   Emoji rate: ${(waProfile.emoji_rate * 100).toFixed(1)}%`);
    console.log(`   Language: ${waProfile.language} (${waProfile.raw_metrics.language_distribution.hebrew} he / ${waProfile.raw_metrics.language_distribution.english} en)`);
  }

  // 2. Claude Code
  console.log("\n2. Analyzing Claude Code instructions...");
  const ccChunks = queryCCUserMessages(db);
  console.log(`   Found ${ccChunks.length.toLocaleString()} messages`);
  if (ccChunks.length > 0) {
    const ccProfile = buildCCProfile(ccChunks);
    profiles.push(ccProfile);
    console.log(`   Formality: ${ccProfile.formality_score}/10`);
    console.log(`   Avg length: ${ccProfile.avg_message_length} chars`);
    console.log(`   Imperative rate: ${(ccProfile.patterns.imperative_rate * 100).toFixed(0)}%`);
    console.log(`   Top projects: ${Object.entries(ccProfile.topic_clusters).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 3).map(([p, c]) => `${p}(${c})`).join(", ")}`);
  }

  db.close();

  // 3. LinkedIn
  console.log("\n3. Analyzing LinkedIn data...");
  if (existsSync(linkedinDir)) {
    const liProfile = buildLinkedInProfile(linkedinDir);
    if (liProfile) {
      profiles.push(liProfile);
      const sc = liProfile.raw_metrics.sub_contexts;
      console.log(`   Total: ${liProfile.sample_count} items (${sc.dms.count} DMs, ${sc.comments.count} comments, ${sc.shares.count} posts)`);
      console.log(`   Formality: ${liProfile.formality_score}/10`);
      console.log(`   Avg length: ${liProfile.avg_message_length} chars`);
      console.log(`   Language: ${liProfile.language} (${liProfile.raw_metrics.language_distribution.hebrew} he / ${liProfile.raw_metrics.language_distribution.english} en)`);
    } else {
      console.log("   No LinkedIn data found in export.");
    }
  } else {
    console.log(`   LinkedIn export not found at: ${linkedinDir}`);
    console.log("   Set LINKEDIN_EXPORT_DIR env or use --linkedin=/path/to/export");
  }

  if (profiles.length === 0) {
    console.log("\nNo data found. Nothing to generate.");
    return;
  }

  // Generate card
  console.log("\n4. Generating style card...");
  const card = generateStyleCard(profiles);

  if (dryRun) {
    console.log("\n--- DRY RUN (not saving) ---\n");
    console.log(card);
    return;
  }

  // Save locally
  const { mkdirSync } = await import("fs");
  mkdirSync(join(homedir(), ".golems-zikaron/style"), { recursive: true });
  writeFileSync(STYLE_DATA_PATH, JSON.stringify(profiles, null, 2));
  writeFileSync(STYLE_CARD_PATH, card);
  console.log(`   Profiles saved: ${STYLE_DATA_PATH}`);
  console.log(`   Style card: ${STYLE_CARD_PATH}`);

  // Save to Supabase
  console.log("\n5. Saving to Supabase...");
  await saveToSupabase(profiles);

  console.log("\n=== Done! ===");
  console.log(`\nView card: cat ${STYLE_CARD_PATH}`);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
