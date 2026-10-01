#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const POLICY_FILE = "scripts/ci/telegram-retirement-allowlist.json";
const TERMS = "telegram|grammy|telegraf|t\\.me/|bot_token";
const matcher = new RegExp(TERMS, "i");
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function checkRetirement(root) {
  const policy = JSON.parse(readFileSync(join(root, POLICY_FILE), "utf8"));
  if (policy.version !== 1 || !policy.policyReason?.trim() || !policy.files || Array.isArray(policy.files)) {
    throw new Error("Invalid reviewed exception policy");
  }
  const rules = new Map(Object.entries(policy.files).map(([file, entry]) => {
    if (isAbsolute(file) || file.split("/").includes("..") || !entry.reason?.trim() || !entry.patterns?.length ||
        !entry.patterns.every(pattern => typeof pattern === "string" && pattern.startsWith("^") && pattern.endsWith("$"))) {
      throw new Error(`Invalid anchored exception for ${file}`);
    }
    return [file, entry.patterns.map(pattern => new RegExp(pattern, "i"))];
  }));
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const offLimits = files.filter(file => file.split("/").some(part => /^jev/i.test(part)));
  const privatePaths = new Set(offLimits);
  const violations = [];
  // Names only: never read or print protected corpus/source content.
  if (offLimits.length) {
    const result = spawnSync("git", ["--literal-pathspecs", "-C", root, "grep", "-I", "-i", "-l", "-E", TERMS, "--", ...offLimits], { encoding: "utf8" });
    if (result.status !== 0 && result.status !== 1) throw new Error("Protected-path census failed");
    for (const file of result.stdout.trim().split("\n").filter(Boolean)) violations.push({ file, line: null });
  }
  const matchingPaths = new Set();
  let matchingLines = 0;
  for (const file of files) {
    // The exact policy path is declarative exception data validated above.
    // It necessarily names retired terms; all other files use full-line rules.
    if (file === POLICY_FILE || privatePaths.has(file)) continue;
    const path = join(root, file);
    const bytes = lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    if (bytes.includes(0)) continue; // Same binary exclusion as git grep -I.
    bytes.toString("utf8").split(/\r?\n/).forEach((line, index) => {
      if (!matcher.test(line)) return;
      matchingPaths.add(file);
      matchingLines++;
      if (!(rules.get(file) || []).some(pattern => pattern.test(line))) violations.push({ file, line: index + 1 });
    });
  }
  return { violations, paths: matchingPaths.size, matchingLines };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--root")) throw new Error("Expected --root <checkout>");
    const result = checkRetirement(args.length ? resolve(args[1]) : defaultRoot);
    for (const hit of result.violations) console.log(`${hit.file}${hit.line === null ? "" : ":" + hit.line}: unapproved residue (content withheld)`);
    console.log(`retirement-check: ${result.violations.length ? "FAIL" : "PASS"} paths=${result.paths} matching-lines=${result.matchingLines} policy-data=1 violations=${result.violations.length}`);
    process.exitCode = result.violations.length ? 1 : 0;
  } catch {
    console.error("retirement-check: ERROR invalid census or anchored exception policy");
    process.exitCode = 1;
  }
}
