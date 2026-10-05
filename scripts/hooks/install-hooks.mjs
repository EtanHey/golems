#!/usr/bin/env node
// install-hooks — wire Claude Code hooks from ONE pinned golems tree (GO-5 S14).
//
//   scripts/hooks/install-hooks.sh --host mbp|m1 [--apply] [--update [<sha>]]
//   scripts/hooks/install-hooks.sh --host mbp|m1 --status
//
// Source: a detached, LOCKED worktree `<repo>/.worktrees/hooks-live`. Only
// `--update` moves it (default origin/master), so a `git checkout` in the main
// checkout can never swap a live hook. Every golems hook in the host's manifest
// entry is read from the selected commit (including dry-run updates), never
// from the invoking checkout. --manifest is an explicit fixture/override path.
// Each golems hook is SYMLINKED from hooks-live into ~/.claude/hooks (copies silently break
// the gates' `../../_shared` imports) and registered in ~/.claude/settings.json.
// `external` entries are owned by another repo and left byte-identical.
// `wrapped-external` entries register a golems wrapper around another repo's
// script, but never link that script into ~/.claude/hooks.
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
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { planCodexHooks, applyCodexHooks, codexStatus, CODEX_TRUST_HINT } from "./codex-hooks-install.mjs";

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
    repo: path.join(homedir(), "Gits/golems"), manifest: null };
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

function context(o, sha) {
  const text = o.manifest ? readFileSync(o.manifest, "utf8") : git(o.repo, "show", `${sha}:scripts/hooks/manifest.json`);
  if (text === null) die(`pinned manifest missing at ${sha}; refusing invoking-checkout fallback`);
  for (const name of E1_DELETED) {
    if (text.includes(name)) die(`REFUSED: ${name} is E1-deleted; it is never linked or registered`);
  }
  const manifest = JSON.parse(text);
  const hosts = manifest.hosts;
  // Validate every host before status, dry-run, or apply can use the manifest.
  // Claude Code reads seconds; millisecond-looking values can stall for hours.
  for (const [host, hooks] of Object.entries(hosts ?? {})) {
    for (const e of hooks) {
      if (e.timeout === undefined && e.event !== "PreToolUse") continue;
      if (!Number.isInteger(e.timeout) || e.timeout < 1 || e.timeout > 120) {
        die(`REFUSED: ${host}/${e.id} timeout must be an integer in 1..120 seconds${e.timeout === undefined ? " (required for PreToolUse)" : `; got ${JSON.stringify(e.timeout)}`}`);
      }
    }
  }
  const entries = hosts?.[o.host];
  if (!Array.isArray(entries)) die(`manifest ${o.manifest ?? sha} has no host "${o.host}"`);
  const hooksDir = path.join(homedir(), ".claude", "hooks");
  const live = path.join(o.repo, ".worktrees", "hooks-live");
  const node = entries.some((e) => e.command?.includes("{node}")) ? pathNode() : "";
  const expand = (s) => s.replaceAll("{home}", homedir()).replaceAll("{hooks}", hooksDir).replaceAll("{live}", live)
    .replaceAll("{node}", node).replaceAll("{python}", "python3");
  const golems = entries.filter((e) => e.kind === "golems").map((e) => ({
    ...e, at: path.join(hooksDir, e.link), to: path.join(live, e.source), cmd: expand(e.command),
  }));
  const wrapped = entries.filter((e) => e.kind === "wrapped-external").map((e) => ({ ...e, cmd: expand(e.command) }));
  const codex = planCodexHooks({ manifest, host: o.host, live, codexHome: path.resolve(process.env.CODEX_HOME || path.join(homedir(), ".codex")) });
  return { entries, golems, wrapped, hooksDir, live, codex, settingsPath: path.join(homedir(), ".claude", "settings.json") };
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

function hookSpec(e) {
  return { type: "command", command: e.cmd, ...(e.timeout ? { timeout: e.timeout } : {}),
    ...(e.async === undefined ? {} : { async: e.async }) };
}

// Replace each managed hook's command in place (same event + matcher), drop
// stale duplicates of it, append a new matcher group if none matched.
function desiredHooks(current, managed) {
  const hooks = structuredClone(current ?? {});
  for (const e of managed) {
    const want = hookSpec(e);
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

// Deregister refused gates: drop every command of theirs from their event.
function withoutHooks(hooks, refused) {
  for (const e of refused) {
    hooks[e.event] = (hooks[e.event] ?? []).map((g) => ({
      ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? "").includes(e.match)) }))
      .filter((g) => g.hooks.length > 0);
    if (hooks[e.event].length === 0) delete hooks[e.event];
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

function selectedPin(o, live) {
  const current = existsSync(live) ? git(live, "rev-parse", "HEAD") : null;
  if (current && (!o.update || o.status)) return current;
  if (o.apply && !o.status) mustGit(o.repo, "fetch", "-q", "origin", "master");
  const sha = git(o.repo, "rev-parse", "--verify", `${o.status ? "origin/master" : o.update ?? "origin/master"}^{commit}`);
  if (!sha) die(`cannot resolve selected hook pin in ${o.repo}`);
  return sha;
}

function pinLive(o, live, sha) {
  const current = existsSync(live) ? git(live, "rev-parse", "HEAD") : null;
  if (current && !o.update) {
    if (o.apply) relock(o.repo, live);
    return `hooks-live: keep ${current}`;
  }
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

// AIDEV-NOTE: never install-and-deny. An entry with `requiresPin` (the
// human-confirm gate's committed anchor fingerprints) is only active when that
// file at the pinned sha holds >=1 fingerprint; otherwise it is unlinked and
// deregistered. Grammar shared with tokens.parse_pins via
// skills/golem-powers/human-confirm-gate/tests/pin-vectors.json.
// Order: gate merges -> owner runs golems-confirm-pin -> pin PR merges -> install.
const PIN_LINE = /^(?:#[\x20-\x7e]*|[0-9a-f]{64}(?: +[A-Za-z0-9._-]+)?)?$/;
export function pinnedFingerprints(raw) {
  if (raw === undefined || raw === null) return 0;
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  if (bytes.some((b) => b !== 0x0a && (b < 0x20 || b > 0x7e))) return 0;
  const lines = bytes.toString("latin1").split("\n");
  if (!lines.every((l) => PIN_LINE.test(l))) return 0;
  return new Set(lines.filter((l) => l && !l.startsWith("#")).map((l) => l.slice(0, 64))).size;
}

function pinReady(o, sha, e) {
  if (!e.requiresPin) return true;
  const r = spawnSync("git", ["show", `${sha}:${e.requiresPin}`], { cwd: o.repo });
  return r.status === 0 && pinnedFingerprints(r.stdout) > 0;
}

// git as --status must run it against hooks-live: repo config cannot answer for
// the worktree (fsmonitor/untracked cache) and replace refs cannot swap objects.
function liveGit(live, ...args) {
  return git(live, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--no-replace-objects", ...args);
}

// Import dirs of every launcher-run Python hook (its source dir, or the dir of
// a single-file source) plus _shared. Hooks run with -B, so nothing in
// hooks-live legitimately writes bytecode there.
function importDirs(ctx) {
  const dirs = new Set(["skills/golem-powers/_shared"]);
  for (const e of ctx.golems.filter((g) => g.command?.includes("golems-fail-open.py"))) {
    dirs.add(e.source.endsWith(".py") ? path.posix.dirname(e.source) : e.source);
  }
  return [...dirs];
}

// Stale bytecode caches left in hooks-live by runs before -B; cache only.
function cacheDirs(ctx) {
  const found = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(ctx.live, rel))) {
      const child = path.posix.join(rel, name);
      if (!lstatSync(path.join(ctx.live, child)).isDirectory()) continue;
      if (name === "__pycache__") found.push(child);
      else walk(child);
    }
  };
  for (const dir of importDirs(ctx)) if (existsSync(path.join(ctx.live, dir))) walk(dir);
  return found;
}

// AIDEV-NOTE: porcelain alone trusts the index. Index flags and replace refs
// are reported, and every Python hook's import dirs (see importDirs) are
// compared byte-for-byte with HEAD, so hidden edits and ignored extras
// (compiled modules, caches, shadow packages) show.
function treeIntegrity(ctx, head) {
  const problems = [];
  const flags = liveGit(ctx.live, "ls-files", "-v");
  const hidden = flags === null ? null : flags.split("\n").filter((l) => /^(S|[a-z]) /.test(l)).map((l) => l.slice(2));
  if (hidden === null || hidden.length) problems.push(`INDEX FLAGS hide ${hidden === null ? "? (ls-files failed)" : `${hidden.length} path(s): ${hidden.slice(0, 5).join(", ")}`}`);
  const replaced = liveGit(ctx.live, "for-each-ref", "--format=%(refname)", "refs/replace/");
  if (replaced === null || replaced) problems.push(`REPLACE REFS present: ${replaced === null ? "? (for-each-ref failed)" : replaced.split("\n").length}`);
  {
    const id = "hooks";
    const dirs = importDirs(ctx);
    const listing = liveGit(ctx.live, "ls-tree", "-r", "-z", "--full-tree", head, "--", ...dirs);
    if (listing === null) return [...problems, `${id} cannot list HEAD`];
    const tracked = new Map(listing.split("\0").filter(Boolean).map((row) => {
      const [meta, file] = row.split("\t");
      const [mode, , sha] = meta.split(" ");
      return [file, { mode, sha }];
    }));
    const onDisk = [];
    const walk = (rel) => {
      for (const name of readdirSync(path.join(ctx.live, rel))) {
        const child = path.posix.join(rel, name);
        const st = lstatSync(path.join(ctx.live, child));
        if (st.isDirectory()) walk(child);
        else onDisk.push(child);
      }
    };
    for (const dir of dirs) if (existsSync(path.join(ctx.live, dir))) walk(dir);
    const extra = onDisk.filter((f) => !tracked.has(f));
    const missing = [...tracked.keys()].filter((f) => !onDisk.includes(f));
    const regular = onDisk.filter((f) => tracked.has(f) && !lstatSync(path.join(ctx.live, f)).isSymbolicLink());
    const r = regular.length === 0 ? { status: 0, stdout: "" }
      : spawnSync("git", ["-C", ctx.live, "hash-object", "--no-filters", "--stdin-paths"],
        { encoding: "utf8", input: `${regular.join("\n")}\n` });
    const hashes = r.status === 0 ? r.stdout.trim().split("\n") : [];
    const changed = regular.filter((f, i) => hashes[i] !== tracked.get(f).sha || tracked.get(f).mode === "120000");
    changed.push(...onDisk.filter((f) => tracked.has(f) && lstatSync(path.join(ctx.live, f)).isSymbolicLink()
      && tracked.get(f).mode !== "120000"));
    if (r.status !== 0) problems.push(`${id} cannot hash its import dirs`);
    for (const [label, list] of [["differ from HEAD", changed], ["unexpected (untracked or ignored)", extra], ["missing", missing]]) {
      if (list.length) problems.push(`${id} import files ${label}: ${list.length} (${list.slice(0, 5).join(", ")})`);
    }
  }
  return problems;
}

// The recorded pin lets --status notice a hooks-live HEAD moved outside --apply.
const pinRecord = (ctx) => path.join(ctx.hooksDir, "golems-hooks-live.sha");

function relock(repo, live) {
  spawnSync("git", ["worktree", "unlock", live], { cwd: repo });
  mustGit(repo, "worktree", "lock", "--reason", LOCK_REASON, live);
}

function install(o) {
  const sha = selectedPin(o, path.join(o.repo, ".worktrees", "hooks-live"));
  // Read/validate the immutable selected manifest before creating or moving the pin.
  const ctx = context(o, sha);
  const settings = readSettings(ctx.settingsPath);
  // Validate the Codex destination and selected source before either host's
  // config is written. The manifest comes from the selected pin (#505/#577).
  if (ctx.codex) {
    if (!ctx.codex.enabled) die("Codex hooks disabled by existing config; review that setting before installation");
    if (git(o.repo, "show", `${sha}:scripts/hooks/codex-policy-hook.py`) === null) die("Codex adapter absent from selected pin");
  }
  if (!settings.canonical) {
    const msg = `${ctx.settingsPath} is not canonical 2-space JSON; rewriting it would change unrelated bytes`;
    if (o.apply) die(`${msg}. Refusing.`);
    console.log(`WARN ${msg}; --apply will refuse.`);
  }
  console.log(pinLive(o, ctx.live, sha));
  const refused = ctx.golems.filter((g) => !pinReady(o, sha, g));
  for (const e of refused) {
    console.log(`REFUSED ${e.id}: ${e.requiresPin} has no owner fingerprint at ${sha}; ${o.apply ? "unlinked and deregistered" : "would be unlinked and deregistered"}. `
      + "Owner runs scripts/golems-confirm-pin, the fingerprint PR merges, then re-run --update.");
  }
  ctx.golems = ctx.golems.filter((g) => !refused.includes(g));
  for (const e of ctx.golems) {
    if (o.apply && !existsSync(e.to)) die(`source missing in hooks-live: ${e.source} (for ${e.id})`);
    const state = linkState(e.at, e.to);
    console.log(`link ${e.id}: ${state === "ok" ? "ok" : `${state} -> link ${e.at} -> ${e.to}`}`);
  }
  const next = { ...settings.json, hooks: withoutHooks(desiredHooks(settings.json.hooks, [...ctx.golems, ...ctx.wrapped]), refused) };
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const changed = nextText !== settings.text;
  console.log(`settings.json: ${changed ? "would change" : "unchanged"} (${ctx.golems.length + ctx.wrapped.length} managed hooks)`);
  const caches = existsSync(ctx.live) ? cacheDirs(ctx) : [];
  if (caches.length) console.log(`hooks-live: ${o.apply ? "clearing" : "would clear"} ${caches.length} stale __pycache__ dir(s) (hooks run -B)`);
  if (ctx.codex) console.log(`codex hooks.json: ${ctx.codex.old === ctx.codex.next ? "unchanged" : "would change"}; config.toml preserved; trust requires /hooks review`);
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
  for (const e of refused) {
    const state = linkState(e.at, e.to);
    if (state === "copy(not link)") renameSync(e.at, `${e.at}.bak-${stamp()}`);
    else if (state !== "missing") unlinkSync(e.at);
  }
  writeFileSync(pinRecord(ctx), `${sha}\n`);
  for (const cache of cacheDirs(ctx)) rmSync(path.join(ctx.live, cache), { recursive: true, force: true });
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
  if (ctx.codex) {
    ctx.codex.source = existsSync(path.join(ctx.live, "scripts/hooks/codex-policy-hook.py"));
    applyCodexHooks(ctx.codex);
    console.log(CODEX_TRUST_HINT);
  }
  return 0;
}

function registrationMatches(hooks, e) {
  return Object.entries(hooks).flatMap(([event, groups]) => groups.flatMap((group) => (group.hooks ?? [])
    .filter((hook) => String(hook.command ?? "").includes(e.match))
    .map((hook) => ({ event, matcher: group.matcher ?? null, hook }))));
}
function registeredExactly(hooks, e) {
  const matches = registrationMatches(hooks, e);
  return matches.length === 1 && matches[0].event === e.event && matches[0].matcher === (e.matcher ?? null)
    && isDeepStrictEqual(matches[0].hook, hookSpec(e));
}

function status(o) {
  const sha = selectedPin(o, path.join(o.repo, ".worktrees", "hooks-live"));
  const ctx = context(o, sha);
  const current = existsSync(ctx.live) ? git(ctx.live, "rev-parse", "HEAD") : null;
  const master = git(o.repo, "rev-parse", "--verify", "origin/master");
  const drift = current && master ? git(o.repo, "rev-list", "--count", `${current}..${master}`) ?? "?" : "?";
  console.log(`hooks-live=${current ?? "absent"} master=${master ?? "unknown"} drift=${drift}`);
  let bad = false;
  // AIDEV-NOTE: the gate's anchor pin is only as strong as this tree. Detects
  // in-place edits/untracked files, a HEAD off origin/master, and a HEAD moved
  // outside --apply (recorded pin). It cannot see a same-UID edit that is
  // reverted before --status runs.
  if (current) {
    const dirty = liveGit(ctx.live, "status", "--porcelain", "--untracked-files=all");
    if (dirty === null || dirty) {
      bad = true;
      console.log(`hooks-live DIRTY: ${dirty === null ? "git status failed" : `${dirty.split("\n").length} changed/untracked path(s)`}`);
    }
    if (!master || spawnSync("git", ["merge-base", "--is-ancestor", current, master], { cwd: o.repo }).status !== 0) {
      bad = true;
      console.log("hooks-live HEAD is not on origin/master");
    }
    const recorded = existsSync(pinRecord(ctx)) ? readFileSync(pinRecord(ctx), "utf8").trim() : null;
    if (recorded !== current) {
      bad = true;
      console.log(`hooks-live HEAD ${recorded ? `!= recorded pin ${recorded}` : "has no recorded pin (re-run --apply)"}`);
    }
    for (const problem of treeIntegrity(ctx, current)) {
      bad = true;
      console.log(`hooks-live ${problem}`);
    }
  }
  const helper = path.join(ctx.live, "scripts/hooks/heavy-suite.py");
  console.log(`heavy-suite ${existsSync(helper) && statSync(helper).isFile() ? `available ${helper}` : "missing (suites run unqueued)"}`);
  // Only registered hook commands count: a hook name in permissions or env is not a registration.
  const hooks = existsSync(ctx.settingsPath) ? JSON.parse(readFileSync(ctx.settingsPath, "utf8")).hooks ?? {} : {};
  const commands = Object.values(hooks).flat().flatMap((g) => g.hooks ?? []).map((h) => String(h.command ?? ""));
  const text = commands.join("\n");
  if (codexStatus(ctx.codex)) bad = true;
  for (const e of ctx.entries) {
    if (e.kind === "wrapped-external") {
      const expected = ctx.wrapped.find((x) => x.id === e.id);
      const ok = registeredExactly(hooks, expected);
      if (!ok) bad = true;
      console.log(`${e.id} ${ok ? "ok" : "drifted"}`);
      continue;
    }
    if (e.kind !== "golems") {
      console.log(`${e.id} external(${text.includes(e.match) ? "registered" : "unregistered"})`);
      continue;
    }
    const g = ctx.golems.find((x) => x.id === e.id);
    let state = linkState(g.at, g.to);
    if (current && !pinReady(o, current, g)) {
      // A refused (unpinned) gate is deliberately unregistered: not drift.
      const active = state !== "missing" || registrationMatches(hooks, g).length > 0;
      if (active) bad = true;
      state = active ? "refused(unpinned) but STILL ACTIVE" : "refused(unpinned)";
    } else if (state === "ok" && !registeredExactly(hooks, g)) {
      state = registrationMatches(hooks, g).length ? "drifted" : "unregistered";
      bad = true;
    }
    if (state === "dangling" || state === "copy(not link)") bad = true;
    console.log(`${e.id} ${state}`);
  }
  const active = ctx.golems.filter((g) => !(current && !pinReady(o, current, g)));
  const settingsDrift = [...active, ...ctx.wrapped].filter((e) => !registeredExactly(hooks, e)).length;
  console.log(`settings-drift=${settingsDrift}`);
  if (current && settingsDrift) bad = true;
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
