#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const canonicalPath = (candidate) => { try { return realpathSync(candidate); } catch { return path.resolve(candidate); } };
export const CANON_START = "<!-- FLEET_CANON_START -->";
export const CANON_END = "<!-- FLEET_CANON_END -->";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const defaultCanonPath = path.join(repoRoot, "standards", "fleet-canon.md");
const defaultInstalledPath = path.join(homedir(), "Gits", "CLAUDE.md");

function expandHome(input) {
  if (!input || input === "~") return input ? homedir() : input;
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}

function normalizeBlock(block) {
  return `${block.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim()}\n`;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function extractCanonBlockRange(text, options = {}) {
  const { requireEnd = true } = options;
  const start = text.indexOf(CANON_START);
  if (start === -1) {
    const end = text.indexOf(CANON_END);
    if (end !== -1) {
      throw new Error(`canon block ends with ${CANON_END} but is missing ${CANON_START}`);
    }
    return null;
  }

  const end = text.indexOf(CANON_END, start + CANON_START.length);
  if (end === -1) {
    if (!requireEnd) return null;
    throw new Error(`canon block starts with ${CANON_START} but is missing ${CANON_END}`);
  }

  const endPosition = end + CANON_END.length;
  return { start, end: endPosition, block: text.slice(start, endPosition) };
}

export function extractCanonBlock(text) {
  const range = extractCanonBlockRange(text, { requireEnd: true });
  if (range == null) return null;
  return normalizeBlock(range.block);
}

export function extractContractSections(block) {
  const sections = [];
  for (const line of block.split(/\n/)) {
    const match = line.match(/^\s*\d+\.\s+\*\*([^*]+)\*\*/);
    if (match) sections.push(match[1].trim());
  }
  return sections;
}

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

function summarizeBlock(filePath, block) {
  return {
    path: filePath,
    hash: sha256(block),
    sections: extractContractSections(block),
  };
}

function sectionDiff(sourceSections, installedSections) {
  const sourceSet = new Set(sourceSections);
  const installedSet = new Set(installedSections);
  return {
    missingSections: sourceSections.filter((section) => !installedSet.has(section)),
    extraSections: installedSections.filter((section) => !sourceSet.has(section)),
  };
}

function compareCanonDrift(options = {}) {
  const canonPath = path.resolve(expandHome(options.canonPath ?? defaultCanonPath));
  const installedPath = path.resolve(expandHome(options.installedPath ?? defaultInstalledPath));

  const canonText = readTextIfExists(canonPath);
  if (canonText == null) {
    throw new Error(`canon source missing: ${canonPath}`);
  }

  const sourceBlock = extractCanonBlock(canonText);
  if (sourceBlock == null) {
    throw new Error(`canon source missing block markers: ${CANON_START} / ${CANON_END}`);
  }

  const source = summarizeBlock(canonPath, sourceBlock);
  const installedText = readTextIfExists(installedPath);
  const installedBlock = installedText == null ? null : extractCanonBlock(installedText);

  if (installedBlock == null) {
    return {
      status: "not-installed",
      ok: true,
      exitCode: 0,
      source,
      installed: {
        path: installedPath,
        hash: null,
        sections: [],
      },
      drift: {
        hashMismatch: false,
        missingSections: [],
        extraSections: [],
      },
    };
  }

  const installed = summarizeBlock(installedPath, installedBlock);
  const hashMismatch = source.hash !== installed.hash;
  const sectionChanges = sectionDiff(source.sections, installed.sections);
  const hasSectionDrift =
    sectionChanges.missingSections.length > 0 || sectionChanges.extraSections.length > 0;
  const status = hashMismatch || hasSectionDrift ? "drift" : "in-sync";

  return {
    status,
    ok: status === "in-sync",
    exitCode: status === "drift" && options.check ? 1 : 0,
    source,
    installed,
    drift: {
      hashMismatch,
      ...sectionChanges,
    },
  };
}

const routingHome = "routing lives in /agent-routing; models in standards/model-roles.json";

export function scanRouting(text, filePath, offset = 0) {
  const normalized = canonicalPath(filePath).replaceAll("\\", "/");
  if (/\/skills\/golem-powers\/agent-routing\//.test(normalized) ||
      /\/standards\/model-roles[^/]*\.json$/.test(normalized)) return [];
  const hits = new Map();
  const add = (index) => {
    const line = text.slice(0, index).split("\n").length + offset;
    hits.set(line, { path: filePath, line, message: `${filePath}:${line}: ${routingHome}` });
  };
  const models = /\b(?:Opus|Sonnet|Haiku|Fable|Sol|Luna|Terra|Daybreak)\b|\bgpt-\d|\bclaude-(?:opus|sonnet|haiku|fable)\b|\bBlue\b(?=[^\n.;]*\bmodel\b)|\bmodel\b[^\n.;]*\bBlue\b/gi;
  for (const match of text.matchAll(models)) add(match.index);
  // Semicolons, sentence ends and blank lines bound a clause; line wrapping does not.
  for (const clause of text.matchAll(/[^;.!?\n]+(?:\n(?![ \t]*\n)[^;.!?\n]+)*/g)) {
    const actor = /\b(?:Claude|Codex|Cursor|Gemini|Opus|Daybreak|Blue)\b/i.exec(clause[0]);
    if (actor && /\b(?:implements|reviews|implementer|reviewer)\b/i.test(clause[0])) {
      add(clause.index + actor.index);
    }
  }
  return [...hits.values()].sort((a, b) => a.line - b.line);
}

export function lintCanonDrift(options = {}) {
  const result = compareCanonDrift(options);
  const hits = [];
  if (options.check) {
    for (const filePath of [result.source.path, result.installed.path]) {
      const text = readTextIfExists(filePath);
      if (text == null) continue;
      const range = extractCanonBlockRange(text);
      if (range) hits.push(...scanRouting(range.block, filePath, text.slice(0, range.start).split("\n").length - 1));
    }
  }
  for (const input of options.routingScan ?? []) {
    const filePath = path.resolve(expandHome(input));
    hits.push(...scanRouting(readFileSync(filePath, "utf8"), filePath));
  }
  result.routing = { hits, count: hits.length };
  if (hits.length) Object.assign(result, { status: "routing-drift", ok: false, exitCode: 1 });
  return result;
}

function installCanonDrift(options = {}) {
  const canonPath = path.resolve(expandHome(options.canonPath ?? defaultCanonPath));
  const installedPath = path.resolve(expandHome(options.installedPath ?? defaultInstalledPath));

  const canonText = readTextIfExists(canonPath);
  if (canonText == null) {
    throw new Error(`canon source missing: ${canonPath}`);
  }
  const sourceRange = extractCanonBlockRange(canonText);
  if (sourceRange == null) {
    throw new Error(`canon source missing block markers: ${CANON_START} / ${CANON_END}`);
  }
  const sourceBlock = sourceRange.block;

  const installedText = readTextIfExists(installedPath);
  if (installedText == null) {
    throw new Error(`installed file missing: ${installedPath}`);
  }
  const installedRange = extractCanonBlockRange(installedText);
  if (installedRange == null) {
    throw new Error(`installed file missing canon block markers: ${CANON_START} / ${CANON_END}`);
  }

  const nextInstalledText =
    `${installedText.slice(0, installedRange.start)}${sourceBlock}${installedText.slice(installedRange.end)}`;

  if (nextInstalledText !== installedText) {
    writeFileSync(installedPath, nextInstalledText);
  }

  const result = lintCanonDrift({ canonPath, installedPath, check: true });
  if (result.status !== "in-sync") {
    throw new Error(`installed block not in-sync after --install: ${installedPath}`);
  }
  return result;
}

function readOption(args, index) {
  const arg = args[index];
  const equals = arg.indexOf("=");
  if (equals !== -1) {
    return { value: arg.slice(equals + 1), consumed: 1 };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${arg} requires a value`);
  }
  return { value, consumed: 2 };
}

function parseArgs(args) {
  const options = { check: false };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === "--check") {
      options.check = true;
      i += 1;
      continue;
    }
    if (arg === "--canon" || arg.startsWith("--canon=")) {
      const parsed = readOption(args, i);
      options.canonPath = parsed.value;
      i += parsed.consumed;
      continue;
    }
    if (arg === "--installed" || arg.startsWith("--installed=")) {
      const parsed = readOption(args, i);
      options.installedPath = parsed.value;
      i += parsed.consumed;
      continue;
    }
    if (arg === "--routing-scan" || arg.startsWith("--routing-scan=")) {
      const parsed = readOption(args, i);
      (options.routingScan ??= []).push(parsed.value);
      i += parsed.consumed;
      continue;
    }
    if (arg === "--install") {
      options.install = true;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.install
      ? installCanonDrift(options)
      : lintCanonDrift(options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`canon-drift-lint: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url))) {
  main();
}
