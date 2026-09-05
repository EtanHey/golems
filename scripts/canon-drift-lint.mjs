#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANON_START = "<!-- FLEET_CANON_START -->";
export const CANON_END = "<!-- FLEET_CANON_END -->";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
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

export function extractCanonBlock(text) {
  const start = text.indexOf(CANON_START);
  if (start === -1) return null;

  const end = text.indexOf(CANON_END, start + CANON_START.length);
  if (end === -1) {
    throw new Error(`canon block starts with ${CANON_START} but is missing ${CANON_END}`);
  }

  return normalizeBlock(text.slice(start, end + CANON_END.length));
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

export function lintCanonDrift(options = {}) {
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
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = lintCanonDrift(options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`canon-drift-lint: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
