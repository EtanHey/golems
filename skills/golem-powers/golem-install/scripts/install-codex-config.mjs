#!/usr/bin/env bun
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const AGENT_FILES = ["recon.toml", "packet.toml"];

// Find the checkout or complete standalone bundle; never substitute a stale literal.
async function render(sourceDir, text) {
  let root = resolve(sourceDir);
  while (!existsSync(join(root, "scripts/model-roles.mjs"))) {
    const parent = dirname(root);
    if (parent === root) throw new Error("Missing model-role resolver; use a complete golems checkout or bundle");
    root = parent;
  }
  const { resolveModelRole } = await import(pathToFileURL(join(root, "scripts/model-roles.mjs")).href);
  return text.replace(/\{\{([\w.-]+)\}\}/g, (_, role) => {
    // JSON string encoding is also valid inside a TOML basic string.
    return JSON.stringify(resolveModelRole(role, root)).slice(1, -1);
  });
}

// Locate whole TOML statements, ignoring header/key lookalikes inside multiline
// strings and arrays. Bun's parser validates both input and final output.
function statements(text) {
  const out = []; let start = 0, quote = "", depth = 0, comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) { if (c !== "\n") continue; comment = false; }
    else if (quote) {
      if (quote[0] === '"' && c === "\\") { i++; continue; }
      if (text.startsWith(quote, i)) { i += quote.length - 1; quote = ""; }
      continue;
    } else if (c === "#") { comment = true; continue; }
    else if (c === '"' || c === "'") {
      quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c; i += quote.length - 1; continue;
    } else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    if (c === "\n" && depth === 0) { out.push({ start, end: i + 1, text: text.slice(start, i + 1) }); start = i + 1; }
  }
  if (start < text.length) out.push({ start, end: text.length, text: text.slice(start) });
  return out;
}

export function mergeCodexConfig(existing, fragment) {
  const defaults = Bun.TOML.parse(fragment);
  if (typeof defaults.model !== "string" || typeof defaults.agents?.default_subagent_model !== "string") throw new Error("Missing rendered model defaults");
  if (!existing.trim()) return fragment;
  const parsed = Bun.TOML.parse(existing);
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const edits = []; let section = "root", header = null, rootFound = false, childFound = false;
  for (const s of statements(existing)) {
    if (/^\s*\[/.test(s.text)) {
      section = /^\s*\[\s*(?:agents|"agents"|'agents')\s*\]\s*(?:#.*)?(?:\r?\n)?$/.test(s.text) ? "agents" : "other";
      if (section === "agents") header = s;
    } else {
      const key = section === "root" ? "model" : section === "agents" ? "default_subagent_model" : null;
      if (key && new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`).test(s.text)) {
        const value = key === "model" ? defaults.model : defaults.agents.default_subagent_model;
        edits.push({ start: s.start, end: s.end, text: `${key} = ${JSON.stringify(value)}${s.text.endsWith("\n") ? newline : ""}` });
        if (key === "model") rootFound = true; else childFound = true;
      }
    }
  }
  if (!header && parsed.agents && !Array.isArray(parsed.agents)) throw new Error("Refusing root dotted agents key or inline agents table");
  if (!rootFound) edits.push({ start: 0, end: 0, text: `model = ${JSON.stringify(defaults.model)}${newline}` });
  if (!childFound) {
    const text = `default_subagent_model = ${JSON.stringify(defaults.agents.default_subagent_model)}${newline}`;
    const at = header ? header.end : existing.length;
    edits.push({ start: at, end: at, text: header ? `${header.text.endsWith("\n") ? "" : newline}${text}` : `${newline}[agents]${newline}${text}` });
  }
  let merged = existing;
  for (const e of edits.sort((a, b) => b.start - a.start)) merged = merged.slice(0, e.start) + e.text + merged.slice(e.end);
  Bun.TOML.parse(merged);
  return merged;
}

async function replaceWithBackup(path, content) {
  const exists = existsSync(path);
  const old = exists ? await readFile(path) : null;
  if (old?.equals(Buffer.from(content))) return;
  const mode = exists ? (await stat(path)).mode & 0o777 : 0o600;
  if (exists) {
    const backup = `${path}.golems-backup-${createHash("sha256").update(old).digest("hex")}`;
    try { await copyFile(path, backup, constants.COPYFILE_EXCL); await chmod(backup, mode); }
    catch (e) { if (e.code !== "EEXIST" || !(await readFile(backup)).equals(old)) throw e; }
  }
  const stage = `${path}.golems-new-${randomUUID()}`;
  try { await writeFile(stage, content, { flag: "wx", mode }); await chmod(stage, mode); await rename(stage, path); }
  finally { await rm(stage, { force: true }); }
}

export async function installCodexConfig({ sourceDir, codexHome }) {
  // Read/render every source and validate before touching any destination.
  const fragment = await render(sourceDir, await readFile(join(sourceDir, "config.toml"), "utf8"));
  const agents = await Promise.all(AGENT_FILES.map(async name => {
    const text = await render(sourceDir, await readFile(join(sourceDir, "agents", name), "utf8")); Bun.TOML.parse(text); return [name, text];
  }));
  const configPath = join(codexHome, "config.toml");
  const existing = existsSync(configPath) ? await readFile(configPath, "utf8") : "";
  const merged = mergeCodexConfig(existing, fragment);
  await mkdir(codexHome, { recursive: true });
  await replaceWithBackup(configPath, merged);
  await mkdir(join(codexHome, "agents"), { recursive: true });
  for (const [name, text] of agents) await replaceWithBackup(join(codexHome, "agents", name), text);
}

export function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--source-dir", "--codex-home"].includes(argv[i]) || argv[i + 1] === undefined) throw new Error("Usage: install-codex-config.mjs [--source-dir PATH] [--codex-home PATH]");
    args.set(argv[i], argv[i + 1]);
  }
  return args;
}
if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = resolve(args.get("--source-dir") ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../../config/codex"));
  installCodexConfig({ sourceDir, codexHome: resolve(args.get("--codex-home") ?? join(homedir(), ".codex")) }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
