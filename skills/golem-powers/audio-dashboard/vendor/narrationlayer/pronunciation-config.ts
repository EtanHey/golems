// AIDEV-NOTE: This vendored config loader lands vendor-side first; upstream
// NarrationLayer synchronization is still owed and must preserve its contract.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TermRule } from "./text-normalize.js";

export interface PronunciationLoadOptions {
  defaultPath?: string;
  env?: Record<string, string | undefined>;
}

const DEFAULT_PRONUNCIATION_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "pronunciation.yaml",
);

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function stripInlineComment(value: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function cleanScalar(rawValue: string, sourcePath: string, lineNumber: number): string {
  const value = rawValue.trim();
  if (!value) throw new Error(`${sourcePath}:${lineNumber}: pronunciation entry must have a value`);

  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw new Error(`${sourcePath}:${lineNumber}: unterminated double-quoted scalar`);
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${sourcePath}:${lineNumber}: invalid double-quoted scalar`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error(`${sourcePath}:${lineNumber}: unterminated single-quoted scalar`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.endsWith('"') || value.endsWith("'")) {
    throw new Error(`${sourcePath}:${lineNumber}: unmatched quote in scalar`);
  }
  return value;
}

function sortedRules(rules: Iterable<TermRule>): TermRule[] {
  return [...rules].sort((left, right) => right.term.length - left.term.length);
}

/**
 * Parse the two-level mapping shape shared with VoiceLayer's pronunciation file:
 *
 * section:
 *   term: "pronunciation"
 */
export function parsePronunciationYaml(content: string, sourcePath = "pronunciation.yaml"): TermRule[] {
  const rules = new Map<string, TermRule>();
  let section: string | null = null;

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (rawLine.includes("\t")) {
      throw new Error(`${sourcePath}:${lineNumber}: tabs are not supported in pronunciation config`);
    }
    const uncommented = stripInlineComment(rawLine);
    if (!uncommented.trim()) continue;

    if (!uncommented.startsWith(" ")) {
      const sectionMatch = uncommented.match(/^([^:#][^:]*):\s*$/);
      if (!sectionMatch) {
        throw new Error(`${sourcePath}:${lineNumber}: expected a top-level section such as "acronyms:"`);
      }
      section = cleanScalar(sectionMatch[1], sourcePath, lineNumber);
      continue;
    }

    if (!section || !/^ {2}\S/.test(uncommented)) {
      throw new Error(`${sourcePath}:${lineNumber}: expected a two-space-indented term inside a section`);
    }
    const entryMatch = uncommented.match(/^ {2}([^:]+):\s*(.+)$/);
    if (!entryMatch) {
      throw new Error(`${sourcePath}:${lineNumber}: expected term: "pronunciation"`);
    }

    const term = cleanScalar(entryMatch[1], sourcePath, lineNumber);
    const spoken = cleanScalar(entryMatch[2], sourcePath, lineNumber);
    if (!term) throw new Error(`${sourcePath}:${lineNumber}: pronunciation term must not be empty`);
    rules.set(term.toLocaleLowerCase("en-US"), { term, spoken });
  }

  if (rules.size === 0) {
    throw new Error(`${sourcePath}: pronunciation config contains no entries`);
  }
  return sortedRules(rules.values());
}

export function loadPronunciationRules(options: PronunciationLoadOptions = {}): TermRule[] {
  const environment = options.env ?? process.env;
  const paths = [path.resolve(expandHome(options.defaultPath ?? DEFAULT_PRONUNCIATION_PATH))];
  const overlayValue = environment.NARRATIONLAYER_PRONUNCIATION_FILE;
  if (overlayValue !== undefined) {
    const configuredPaths = overlayValue
      .split(path.delimiter)
      .map((value) => value.trim())
      .filter(Boolean);
    if (configuredPaths.length === 0) {
      throw new Error("NARRATIONLAYER_PRONUNCIATION_FILE must contain at least one path");
    }
    for (const configuredPath of configuredPaths) {
      paths.push(path.resolve(expandHome(configuredPath)));
    }
  }

  const merged = new Map<string, TermRule>();
  for (const configPath of paths) {
    if (!existsSync(configPath)) {
      throw new Error(`pronunciation config not found: ${configPath}`);
    }
    const content = readFileSync(configPath, "utf8");
    for (const rule of parsePronunciationYaml(content, configPath)) {
      merged.set(rule.term.toLocaleLowerCase("en-US"), rule);
    }
  }
  return sortedRules(merged.values());
}
