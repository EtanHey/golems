#!/usr/bin/env node
// install-hooks — wire Claude Code hooks from ONE pinned golems tree (GO-5 S14).
//
//   scripts/hooks/install-hooks.sh --host mbp|m1 [--apply] [--update [<sha>]]
//   scripts/hooks/install-hooks.sh --host mbp|m1 --status
//
// Source: a detached, LOCKED worktree `<repo>/.worktrees/hooks-live`. Only
// `--update` moves it (default origin/master), so a `git checkout` in the main
// checkout can never swap a live hook. Every golems hook in the host's manifest
// entry is SYMLINKED from hooks-live into ~/.claude/hooks (copies silently break
// the gates' `../../_shared` imports) and registered in ~/.claude/settings.json.
// `external` manifest entries are owned by another repo: never linked, their
// registration left byte-identical, reported by --status.
//
// Dry-run is the default; --apply writes: hooks-live, the fail-open wrapper
// copy, the links (a real file/dir in the way is renamed to .bak-<stamp>), and
// settings.json (dated .bak first, only when a byte would change).
//
// AIDEV-NOTE: supersedes _shared/install-wired-hook.sh's copy contract. That
// contract existed because symlinks into a WORKING tree got swapped by
// checkouts; hooks-live is not a working tree anyone checks out.
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, statSync, symlinkSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Hooks deleted by E1 (hooks-audit.md, 2026-09-24). Matched as substrings of the
// whole manifest, so no id, link, source or command can smuggle one back.
export const E1_DELETED = [
  "concurrency-budget-gate", "monitor-law-gate", "idle-dwell-gate", "/tmp/.claude_voice_disabled",
  "subagent_start.py", "subagent_stop.py", "post_tool_use_format.py", "cmux_session_start.py",
  "orc-precompact-trigger.py",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER_SRC = path.join(here, "fail-open.py");
const LOCK_REASON = "GO-5 pinned hook source; move only with scripts/hooks/install-hooks.sh --update";

function die(message, code = 1) {
  process.stderr.write(`install-hooks: ${message}\n`);
  process.exit(code);
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function mustGit(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) die(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function parseArgs(argv) {
  const o = { apply: false, status: false, update: null, host: null,
    repo: path.join(homedir(), "Gits/golems"), manifest: path.join(here, "manifest.json") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") o.apply = true;
    else if (a === "--dry-run") o.apply = false;
    else if (a === "--status") o.status = true;
    else if (a === "--update") o.update = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "origin/master";
    else if (["--host", "--repo", "--manifest"].includes(a) && argv[i + 1]) o[a.slice(2)] = argv[++i];
    else die(`unknown or incomplete argument: ${a}`, 64);
  }
  if (!o.host) die("--host <mbp|m1> is required", 64);
  return o;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 17);
}

function context(o) {
  const text = readFileSync(o.manifest, "utf8");
  for (const name of E1_DELETED) {
    if (text.includes(name)) die(`REFUSED: ${name} is E1-deleted; it is never linked or registered`);
  }
  const entries = JSON.parse(text).hosts?.[o.host];
  if (!Array.isArray(entries)) die(`manifest ${o.manifest} has no host "${o.host}"`);
  const hooksDir = path.join(homedir(), ".claude", "hooks");
  const live = path.join(o.repo, ".worktrees", "hooks-live");
  const node = entries.some((e) => e.command?.includes("{node}")) ? pathNode() : "";
  const expand = (s) => s.replaceAll("{hooks}", hooksDir).replaceAll("{live}", live)
    .replaceAll("{node}", node).replaceAll("{python}", "python3");
  const golems = entries.filter((e) => e.kind === "golems").map((e) => ({
    ...e, at: path.join(hooksDir, e.link), to: path.join(live, e.source), cmd: expand(e.command),
  }));
  return { entries, golems, hooksDir, live, settingsPath: path.join(homedir(), ".claude", "settings.json") };
}

// The node on PATH (e.g. a version manager's stable shim), not process.execPath:
// execPath is the versioned realpath, which a node upgrade deletes.
function pathNode() {
  const r = spawnSync("sh", ["-c", "command -v node"], { encoding: "utf8" });
  const found = r.status === 0 ? r.stdout.trim() : "";
  if (!found.startsWith("/")) die("no absolute `node` on PATH; node hooks need one");
  return found;
}

function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) return { text: "", json: {}, canonical: true, mode: 0o600 };
  const text = readFileSync(settingsPath, "utf8");
  const json = JSON.parse(text);
  const mode = statSync(settingsPath).mode & 0o777;
  return { text, json, canonical: `${JSON.stringify(json, null, 2)}\n` === text, mode };
}

// Replace each golems hook's command in place (same event + matcher), drop
// stale duplicates of it, append a new matcher group if none matched.
function desiredHooks(current, golems) {
  const hooks = structuredClone(current ?? {});
  for (const e of golems) {
    const want = { type: "command", command: e.cmd, ...(e.timeout ? { timeout: e.timeout } : {}) };
    let placed = false;
    const groups = hooks[e.event] ?? [];
    for (const g of groups) {
      g.hooks = g.hooks.flatMap((h) => {
        if (!String(h.command ?? "").includes(e.match)) return [h];
        if (!placed && (g.matcher ?? null) === (e.matcher ?? null)) {
          placed = true;
          return [want];
        }
        return [];
      });
    }
    hooks[e.event] = groups.filter((g) => g.hooks.length > 0);
    if (!placed) hooks[e.event].push({ ...(e.matcher ? { matcher: e.matcher } : {}), hooks: [want] });
  }
  return hooks;
}

function linkState(at, to) {
  let st;
  try {
    st = lstatSync(at);
  } catch {
    return "missing";
  }
  if (!st.isSymbolicLink()) return "copy(not link)";
  if (!existsSync(at)) return "dangling";
  return readlinkSync(at) === to ? "ok" : `foreign(${readlinkSync(at)})`;
}

function pinLive(o, live) {
  const current = existsSync(live) ? git(live, "rev-parse", "HEAD") : null;
  if (current && !o.update) {
    if (o.apply) relock(o.repo, live);
    return `hooks-live: keep ${current}`;
  }
  if (o.apply) mustGit(o.repo, "fetch", "-q", "origin", "master");
  const sha = git(o.repo, "rev-parse", "--verify", `${o.update ?? "origin/master"}^{commit}`);
  if (!sha) die(`cannot resolve ${o.update ?? "origin/master"} in ${o.repo}`);
  if (!o.apply) return current ? `hooks-live: move ${current} -> ${sha}` : `hooks-live: create at ${sha}`;
  if (!current) {
    mustGit(o.repo, "worktree", "add", "-q", "--detach", live, sha);
  } else if (current !== sha) {
    if (git(live, "status", "--porcelain")) die(`${live} has local changes; refusing to move it`);
    mustGit(live, "checkout", "-q", "--detach", sha);
  }
  relock(o.repo, live);
  return `hooks-live: pinned at ${sha}`;
}

function relock(repo, live) {
  spawnSync("git", ["worktree", "unlock", live], { cwd: repo });
  mustGit(repo, "worktree", "lock", "--reason", LOCK_REASON, live);
}

function install(o) {
  const ctx = context(o);
  const settings = readSettings(ctx.settingsPath);
  if (!settings.canonical) {
    const msg = `${ctx.settingsPath} is not canonical 2-space JSON; rewriting it would change unrelated bytes`;
    if (o.apply) die(`${msg}. Refusing.`);
    console.log(`WARN ${msg}; --apply will refuse.`);
  }
  console.log(pinLive(o, ctx.live));
  for (const e of ctx.golems) {
    if (o.apply && !existsSync(e.to)) die(`source missing in hooks-live: ${e.source} (for ${e.id})`);
    const state = linkState(e.at, e.to);
    console.log(`link ${e.id}: ${state === "ok" ? "ok" : `${state} -> link ${e.at} -> ${e.to}`}`);
  }
  const next = { ...settings.json, hooks: desiredHooks(settings.json.hooks, ctx.golems) };
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const changed = nextText !== settings.text;
  console.log(`settings.json: ${changed ? "would change" : "unchanged"} (${ctx.golems.length} golems hooks)`);
  if (!o.apply) {
    console.log("dry-run: nothing written (pass --apply)");
    return 0;
  }
  mkdirSync(ctx.hooksDir, { recursive: true });
  const wrapper = path.join(ctx.hooksDir, "golems-fail-open.py");
  if (!existsSync(wrapper) || !readFileSync(wrapper).equals(readFileSync(WRAPPER_SRC))) {
    copyFileSync(WRAPPER_SRC, wrapper);
    chmodSync(wrapper, 0o755);
  }
  for (const e of ctx.golems) {
    const state = linkState(e.at, e.to);
    if (state === "ok") continue;
    if (state === "copy(not link)") renameSync(e.at, `${e.at}.bak-${stamp()}`);
    else if (state !== "missing") unlinkSync(e.at);
    mkdirSync(path.dirname(e.at), { recursive: true });
    symlinkSync(e.to, e.at);
  }
  if (changed) {
    if (settings.text) {
      let bak = `${ctx.settingsPath}.bak-${new Date().toISOString().slice(0, 10)}-hooks`;
      if (existsSync(bak)) bak = `${ctx.settingsPath}.bak-${stamp()}-hooks`;
      writeFileSync(bak, settings.text, { mode: settings.mode });
      chmodSync(bak, settings.mode);
      console.log(`backup: ${bak}`);
    }
    // settings.json can hold secrets (env); keep its mode (often 0600) exactly.
    const tmp = `${ctx.settingsPath}.install-hooks-tmp`;
    writeFileSync(tmp, nextText, { mode: settings.mode });
    chmodSync(tmp, settings.mode);
    renameSync(tmp, ctx.settingsPath);
  }
  console.log("applied");
  return 0;
}

function status(o) {
  const ctx = context(o);
  const current = existsSync(ctx.live) ? git(ctx.live, "rev-parse", "HEAD") : null;
  const master = git(o.repo, "rev-parse", "--verify", "origin/master");
  const drift = current && master ? git(o.repo, "rev-list", "--count", `${current}..${master}`) ?? "?" : "?";
  console.log(`hooks-live=${current ?? "absent"} master=${master ?? "unknown"} drift=${drift}`);
  // Only registered hook commands count: a hook name in permissions or env is not a registration.
  const hooks = existsSync(ctx.settingsPath) ? JSON.parse(readFileSync(ctx.settingsPath, "utf8")).hooks ?? {} : {};
  const commands = Object.values(hooks).flat().flatMap((g) => g.hooks ?? []).map((h) => String(h.command ?? ""));
  const text = commands.join("\n");
  let bad = false;
  for (const e of ctx.entries) {
    if (e.kind !== "golems") {
      console.log(`${e.id} external(${text.includes(e.match) ? "registered" : "unregistered"})`);
      continue;
    }
    const g = ctx.golems.find((x) => x.id === e.id);
    let state = linkState(g.at, g.to);
    if (state === "ok" && !commands.includes(g.cmd)) state = "unregistered";
    if (state === "dangling" || state === "copy(not link)") bad = true;
    console.log(`${e.id} ${state}`);
  }
  const wrapper = path.join(ctx.hooksDir, "golems-fail-open.py");
  if (text.includes(wrapper)) {
    const w = !existsSync(wrapper) ? "dangling" : readFileSync(wrapper).equals(readFileSync(WRAPPER_SRC)) ? "ok" : "stale";
    if (w === "dangling") bad = true;
    console.log(`golems-fail-open ${w}`);
  }
  for (const name of E1_DELETED) {
    if (text.includes(name)) {
      bad = true;
      console.log(`E1 ${name} PRESENT in settings.json`);
    }
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = parseArgs(process.argv.slice(2));
  process.exit(o.status ? status(o) : install(o));
}
