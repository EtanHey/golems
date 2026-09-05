#!/usr/bin/env node
/**
 * Fail if skill instruction prose tells an agent to call a cmuxlayer tool that
 * no longer exists.
 *
 * The term list is DERIVED, never hand-maintained. Twice the hand list was the
 * broken instrument: first a `\b` anchor that could not fire before
 * `mcp__cmuxlayer__…`, then a missing term (`send_command`) that no anchor fix
 * could have surfaced. So:
 *
 *   cut set = (tools registered at the last pre-cut cmuxlayer release)
 *           - (tools registered on the live surface today)
 *
 * Both sides come out of the cmuxlayer sources. Run with --refresh to
 * re-derive them into cmuxlayer-tool-surface.json; the committed snapshot is
 * what CI reads so this stays runnable without a cmuxlayer checkout.
 *
 * Matching is token-exact, not substring and not \b: a line's identifier
 * tokens must EQUAL the cut term or END WITH `__<term>` (the MCP-qualified
 * form). That catches `mcp__cmuxlayer__send_to_agent` while refusing to match
 * `send_to` inside it, and refuses `interactive` for `interact` or
 * `user_killed` for `kill` — the two failure modes a substring scan has.
 *
 * Four derived terms are ordinary English words (`kill`, `notify`, `interact`,
 * `broadcast`). For those the bare token proves nothing, so they are required
 * to appear MCP-qualified. The rule is the term's shape — no underscore means
 * it is a plain word — not a per-term opinion, so a future cut that removes
 * another one-word tool is handled without editing this file.
 *
 *   node scripts/check-cut-tool-references.mjs            # check
 *   node scripts/check-cut-tool-references.mjs --refresh  # re-derive the sets
 *   node scripts/check-cut-tool-references.mjs --list     # print the term list
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(REPO, "scripts", "cmuxlayer-tool-surface.json");
const ALLOWLIST = join(REPO, "scripts", "cut-tool-allowlist.json");
const SCAN_ROOT = join(REPO, "skills", "golem-powers");

// The last cmuxlayer release before the 2026-08-13 v0.4.35 tool cut.
const PRE_CUT_REF = "v0.4.34";

function deriveFromCmuxlayer() {
  const src = process.env.CMUXLAYER_REPO ||
    join(dirname(REPO), "cmuxlayer");
  const git = (...args) =>
    execFileSync("git", ["-C", src, ...args], { encoding: "utf8" });

  // Historic surface: every name passed to server.tool() at the pre-cut tag.
  const historic = [
    ...git("show", `${PRE_CUT_REF}:src/server.ts`)
      .matchAll(/server\.tool\(\s*\n?\s*"([a-z_][a-z0-9_]*)"/g),
  ].map((m) => m[1]);

  // Live surface: cmuxlayer's own registry constant at HEAD.
  const palette = git("show", "HEAD:src/palette.ts");
  const block = palette.match(
    /REGISTERED_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  if (!block) throw new Error("REGISTERED_TOOL_NAMES not found in palette.ts");
  const live = [...block[1].matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]);

  const liveSet = new Set(live);
  const cut = [...new Set(historic)].filter((t) => !liveSet.has(t)).sort();
  return {
    derived_from: {
      repo: "<CMUXLAYER_REPO_ROOT>",
      pre_cut_ref: PRE_CUT_REF,
      head: git("rev-parse", "HEAD").trim(),
    },
    live: [...liveSet].sort(),
    historic: [...new Set(historic)].sort(),
    cut,
  };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".md")) out.push(p);
  }
  return out;
}

if (process.argv.includes("--refresh")) {
  const snap = deriveFromCmuxlayer();
  writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2) + "\n");
  console.log(
    `refreshed ${relative(REPO, SNAPSHOT)}: ${snap.historic.length} historic - ` +
      `${snap.live.length} live = ${snap.cut.length} cut`,
  );
  process.exit(0);
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
if (process.argv.includes("--list")) {
  console.log(snap.cut.join("\n"));
  process.exit(0);
}

const allow = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
const allowedDirs = allow.excluded_dirs;
// Keyed by content marker, not line number: edits above a line must not
// silently re-open an audited exclusion or falsely fail an unchanged one.
const markersByFile = new Map(
  allow.exclusions.map((e) => [e.file, e.markers]),
);
const isAllowed = (rel, text) =>
  (markersByFile.get(rel) || []).some((m) => text.includes(m));
const markerCount = allow.exclusions.reduce((n, e) => n + e.markers.length, 0);
const cut = new Set(snap.cut);

const hits = [];
for (const file of walk(SCAN_ROOT)) {
  const rel = relative(REPO, file);
  if (allowedDirs.some((d) => rel.startsWith(d))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const tokens = line.match(/[A-Za-z0-9_]+/g) || [];
    const found = [...new Set(tokens.flatMap((tok) =>
      [...cut].filter((t) =>
        // One-word tools are ordinary English; demand the qualified form.
        t.includes("_") ? tok === t || tok.endsWith(`__${t}`) : tok.endsWith(`__${t}`)
      )
    ))];
    if (found.length && !isAllowed(rel, line)) {
      hits.push({ rel, line: i + 1, terms: found, text: line.trim() });
    }
  });
}

console.log(
  `cut-tool term list: ${snap.cut.length} terms, derived as ` +
    `${snap.historic.length} historic (${snap.derived_from.pre_cut_ref}) - ` +
    `${snap.live.length} live`,
);
console.log(`scanned ${walk(SCAN_ROOT).length} .md files under skills/golem-powers`);
console.log(
  `allowlisted: ${markerCount} markers across ${allow.exclusions.length} files, ` +
    `${allowedDirs.length} dirs — every entry carries a reason`,
);

if (hits.length === 0) {
  console.log("OK 0 unallowlisted cut-tool references");
  process.exit(0);
}
for (const h of hits) {
  console.log(`${h.rel}:${h.line}: [${h.terms.join(",")}] ${h.text}`);
}
console.log(`FAIL ${hits.length} unallowlisted cut-tool reference(s)`);
process.exit(1);
