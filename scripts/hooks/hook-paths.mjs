// Repo paths the hook installer loads. Pure: shared by install-hooks.mjs (drift) and the ratchet's guarded set
// (scripts/ratchet/guarded-set.mjs), so both always agree on what a "hook-loaded" path is.
import path from "node:path";

export function hookDriftPaths(manifest) {
  // The launcher and Codex adapter live in scripts/hooks; Python hooks and
  // stop telemetry import shared modules whose paths aren't manifest entries.
  const dirs = new Set(["scripts/hooks/", "skills/golem-powers/_shared/"]);
  for (const entries of Object.values(manifest.hosts ?? {})) {
    for (const e of entries) {
      if (e.kind !== "golems" || !e.source) continue;
      // Single-file hooks can import siblings from their skill root (for
      // example git-guardian/hooks/pre_tool_use.py loads ../git_safety.py).
      const skill = e.source.match(/^skills\/golem-powers\/[^/]+/);
      dirs.add((skill?.[0] ?? (path.posix.extname(e.source) ? path.posix.dirname(e.source) : e.source)) + "/");
    }
  }
  for (const entries of Object.values(manifest.codex_hosts ?? {})) {
    for (const e of entries) {
      if (e.source) dirs.add(path.posix.dirname(e.source) + "/");
    }
  }
  return [...dirs];
}
