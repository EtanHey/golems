#!/usr/bin/env node
// install-hooks — wire Claude Code hooks from ONE pinned golems tree (GO-5 S14).
//
//   scripts/hooks/install-hooks.sh --host mbp|m1 [--apply] [--update [<sha>]] [--python <abs path>] [--restore-live]
//   scripts/hooks/install-hooks.sh --host mbp|m1 --status [--python <abs path>]
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
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync,
  rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
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
// Protocol 2 = --budget watchdog (#656 R1 F2); an older launcher would read --budget as the hook path.
const supportsFailClosed = (bytes) => /^FAIL_CLOSED_PROTOCOL = 2\b/m.test(bytes.toString());

// AIDEV-NOTE: a fail-closed policy gate's Claude command runs inside a /bin/sh
// guard. The launcher denies every hook failure itself, but nothing in Python
// runs when the pinned interpreter is gone (exit 127) or the launcher copy
// cannot start (exit 1); Claude treats both as non-blocking, i.e. allow. The
// guard passes the launcher's own 0/2 through and turns any other status into
// the launcher's static denial (byte-identical to fail-open.py _block()).
// Codex has the same shape in codex-hooks-install.mjs.
export const REPAIR_REASON = "BLOCKED: policy hook unavailable. FLAG THIS TO THE USER: reinstall hooks from the prompt: `! bash ~/Gits/golems/scripts/hooks/install-hooks.sh --host <host> --update --apply`.";
const DENY_JSON = JSON.stringify({ decision: "block", reason: REPAIR_REASON, hookSpecificOutput: {
  hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REPAIR_REASON } });
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
export function failClosedCommand(run) {
  return `/bin/sh -c ${quote(`out=$(${run}); s=$?; if [ "$s" -eq 0 ] || [ "$s" -eq 2 ]; then [ -z "$out" ] || printf '%s\\n' "$out"; exit "$s"; fi; printf '%s\\n' ${quote(DENY_JSON)}; exit 2`)}`;
}
// The interpreter a registered launcher command runs, guarded or not.
const commandPython = (command) => /(?:^|\s)(\S+)(?: -[A-Za-z]+)* \S*golems-fail-open\.py/
  .exec(String(command).replace(/'|\$\(/g, " "))?.[1] ?? String(command).split(" ")[0];

// AIDEV-NOTE: every hook command carries an ABSOLUTE interpreter, never a bare
// `python3`: launchd and minimal-PATH environments resolve that to macOS
// /usr/bin/python3 (3.9). The floor is 3.11: this installer's Codex config check
// needs tomllib, git-guardian's policy module needs 3.10+, and CI runs the hooks
// on 3.11. Homebrew first (its bin/python3 link survives `brew upgrade`), then
// the PATH python3; resolved on the machine at install time, so hosts may differ.
export const MIN_HOOK_PYTHON = [3, 11];
export const HOOK_PYTHON_CANDIDATES = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"];
// Hook commands are unquoted strings: an interpreter path needs no shell quoting.
const PLAIN_PATH = /^\/[A-Za-z0-9._+\/-]+$/;
const pythonVersions = new Map();
export function pythonVersion(python) {
  if (!PLAIN_PATH.test(python) || !existsSync(python)) return null;
  if (!pythonVersions.has(python)) {
    const r = spawnSync(python, ["-I", "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"],
      { encoding: "utf8", timeout: 10_000 });
    const m = r.status === 0 ? /^(\d+)\.(\d+)\.(\d+)$/.exec(r.stdout.trim()) : null;
    pythonVersions.set(python, m ? m.slice(1).map(Number) : null);
  }
  return pythonVersions.get(python);
}
const [MIN_MAJOR, MIN_MINOR] = MIN_HOOK_PYTHON;
const pythonOk = (v) => Boolean(v) && (v[0] > MIN_MAJOR || (v[0] === MIN_MAJOR && v[1] >= MIN_MINOR));
export function resolveHookPython({ override, candidates = HOOK_PYTHON_CANDIDATES, pathPython } = {}) {
  for (const python of override ? [override] : [...candidates, ...(pathPython ? [pathPython] : [])]) {
    const version = pythonVersion(python);
    if (pythonOk(version)) return { python, version: version.join(".") };
  }
  return null;
}
export function pathPython() {
  const r = spawnSync("sh", ["-c", "command -v python3"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}
// Why a registered interpreter is unacceptable, or null when it is fine.
function pythonProblem(python) {
  if (!path.isAbsolute(python)) return "not an absolute path";
  if (!PLAIN_PATH.test(python)) return "path needs shell quoting";
  if (!existsSync(python)) return "missing";
  const v = pythonVersion(python);
  if (!v) return "version unknown";
  return pythonOk(v) ? null : `${v.join(".")} is below ${MIN_HOOK_PYTHON.join(".")}`;
}

function die(message, code = 1) {
  process.stderr.write(`install-hooks: ${message}\n`);
  process.exit(code);
}

function gitProcess(cwd, args, options = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return spawnSync("git", ["--no-optional-locks", "-C", cwd, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
    "--no-replace-objects", ...args], { encoding: "utf8", ...options, env });
}
function git(cwd, ...args) {
  const r = gitProcess(cwd, args);
  return r.status === 0 ? r.stdout.trim() : null;
}

function mustGit(cwd, ...args) {
  const r = gitProcess(cwd, args);
  if (r.status !== 0) die(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function parseArgs(argv) {
  const o = { apply: false, status: false, update: null, host: null,
    repo: path.join(homedir(), "Gits/golems"), manifest: null, python: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") o.apply = true;
    else if (a === "--dry-run") o.apply = false;
    else if (a === "--status") o.status = true;
    else if (a === "--restore-live") o.restoreLive = true;
    else if (a === "--update") o.update = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "origin/master";
    else if (["--host", "--repo", "--manifest", "--python"].includes(a) && argv[i + 1]) o[a.slice(2)] = argv[++i];
    else die(`unknown or incomplete argument: ${a}`, 64);
  }
  if (!o.host) die("--host <mbp|m1> is required", 64);
  return o;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 17);
}

const NO_PYTHON = `no acceptable hook interpreter (absolute, Python >= ${MIN_HOOK_PYTHON.join(".")}; tried `;
const tried = (o) => (o.python ? [o.python] : [...HOOK_PYTHON_CANDIDATES, "PATH python3"]).join(", ");

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
      // The watchdog budget (timeout - 1 s) must be >= 1 s and under the timeout.
      if (e.command?.includes(" --fail-closed ") && e.timeout < 2) {
        die(`REFUSED: ${host}/${e.id} is fail-closed and needs a timeout >= 2 seconds for its watchdog budget`);
      }
    }
  }
  const entries = hosts?.[o.host];
  if (!Array.isArray(entries)) die(`manifest ${o.manifest ?? sha} has no host "${o.host}"`);
  const hooksDir = path.join(homedir(), ".claude", "hooks");
  const live = path.join(o.repo, ".worktrees", "hooks-live");
  const node = entries.some((e) => e.command?.includes("{node}")) ? pathNode() : "";
  // --python overrides the candidates for this run; it is validated the same way.
  const hookPython = resolveHookPython({ override: o.python, pathPython: pathPython() });
  // Refuse before anything (the Codex config check included) runs an interpreter.
  if (!hookPython && !o.status) die(`${NO_PYTHON}${tried(o)}); refusing installation`);
  const python = hookPython?.python ?? "python3";
  const expand = (s) => s.replaceAll("{home}", homedir()).replaceAll("{hooks}", hooksDir).replaceAll("{live}", live)
    .replaceAll("{node}", node).replaceAll("{python}", python);
  // A harness timeout fails OPEN, so a fail-closed gate's watchdog budget sits
  // 1 s under its manifest timeout (5 s -> 4 s, 10 s -> 9 s; #656 R1 F2).
  const claudeCommand = (e) => (e.command.includes(" --fail-closed ")
    ? failClosedCommand(expand(e.command.replace(" --fail-closed ", ` --fail-closed --budget ${Math.max(1, e.timeout - 1)} `)))
    : expand(e.command));
  const golems = entries.filter((e) => e.kind === "golems").map((e) => ({
    ...e, at: path.join(hooksDir, e.link), to: path.join(live, e.source), cmd: claudeCommand(e),
  }));
  const wrapped = entries.filter((e) => e.kind === "wrapped-external").map((e) => ({ ...e, cmd: expand(e.command) }));
  // A pinned Codex gate (human-confirm) is refused, never registered, until its
  // anchor pin carries an owner fingerprint at the selected sha, as on Claude.
  const codexRefused = (manifest.codex_hosts?.[o.host] ?? []).filter((e) => e.requiresPin && !pinReady(o, sha, e)).map((e) => e.gate);
  // Without an acceptable interpreter (status only), the Codex config probe would
  // run an unvetted python3 and could crash --status; report it unchecked instead.
  const codex = hookPython ? planCodexHooks({ manifest, host: o.host, live, python, refused: codexRefused,
    codexHome: path.resolve(process.env.CODEX_HOME || path.join(homedir(), ".codex")) }) : undefined;
  return { entries, golems, wrapped, hooksDir, live, codex, hookPython, settingsPath: path.join(homedir(), ".claude", "settings.json") };
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

// AIDEV-NOTE: retired golems hooks (#579 precompact-checkpoint, the #576 gap).
// A registration is golems-owned when the path it EXECUTES (the program, or the
// script an interpreter runs) is the installed launcher, lies under hooks-live,
// or goes through a hooks-dir link into hooks-live. A path passed only as data
// never counts (#661 review F1). It is retired when no entry of this host's
// manifest (any kind, externals included) matches it. Only those registrations,
// and only dangling links into hooks-live that no entry links, are removed;
// foreign files, links and anything named *.bak* stay.
const INTERPRETER = /^(python[0-9.]*|node|bun|bash|sh|zsh)$/;
function executedPaths(command) {
  const tokens = String(command ?? "").trim().split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, "")).filter(Boolean);
  if (!tokens.length) return [];
  if (!INTERPRETER.test(path.basename(tokens[0]))) return [tokens[0]];
  const script = tokens.slice(1).find((t) => !t.startsWith("-"));
  return script ? [tokens[0], script] : [tokens[0]];
}
// The executed path, as an owned location: launcher, hooks-live, or a hooks-dir link into it.
function ownedPath(ctx, p) {
  if (p === path.join(ctx.hooksDir, "golems-fail-open.py") || p.startsWith(`${ctx.live}/`)) return true;
  const prefix = `${ctx.hooksDir}/`;
  return p.startsWith(prefix) && intoLive(ctx, path.join(ctx.hooksDir, p.slice(prefix.length).split("/")[0]));
}
function golemsOwned(ctx, command) {
  return executedPaths(command).some((p) => ownedPath(ctx, p));
}
// Lexical: `..` is normalized before the prefix test, so a link that resolves
// outside hooks-live is not golems' (#661 review F3).
function intoLive(ctx, at) {
  try {
    return lstatSync(at).isSymbolicLink() && path.resolve(path.dirname(at), readlinkSync(at)).startsWith(`${ctx.live}/`);
  } catch { return false; }
}
// A readable name: the launcher's target under hooks/, else the executed path under hooks/ or hooks-live.
function retiredName(ctx, command) {
  const tokens = String(command).split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ""));
  const launcher = tokens.indexOf(path.join(ctx.hooksDir, "golems-fail-open.py"));
  const target = launcher >= 0 ? tokens.slice(launcher + 1).find((t) => !t.startsWith("-")) : null;
  const p = target ?? executedPaths(command).find((x) => ownedPath(ctx, x)) ?? tokens.at(-1);
  for (const root of [ctx.hooksDir, ctx.live]) if (p.startsWith(`${root}/`)) return p.slice(root.length + 1);
  return p;
}
const groupsOf = (groups) => (Array.isArray(groups) ? groups : []);
const handlersOf = (group) => (Array.isArray(group?.hooks) ? group.hooks : []);
export function retiredRegistrations(ctx, hooks) {
  const found = [];
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    for (const g of groupsOf(groups)) {
      for (const h of handlersOf(g)) {
        const command = String(h?.command ?? "");
        if (!golemsOwned(ctx, command) || ctx.entries.some((e) => e.match && command.includes(e.match))) continue;
        found.push({ event, command, name: retiredName(ctx, command) });
      }
    }
  }
  return found;
}
// Touch only what the prune empties: a group loses only retired handlers and
// is dropped only if that left it empty; an event likewise. Pre-existing empty
// or malformed foreign entries stay byte-identical (#661 review F2).
function withoutRetired(hooks, retired) {
  const drop = new Set(retired.map((r) => `${r.event}\0${r.command}`));
  for (const event of new Set(retired.map((r) => r.event))) {
    if (!Array.isArray(hooks[event])) continue;
    let emptied = false;
    hooks[event] = hooks[event].flatMap((g) => {
      const kept = handlersOf(g).filter((h) => !drop.has(`${event}\0${String(h?.command ?? "")}`));
      if (kept.length === handlersOf(g).length) return [g];
      if (kept.length) return [{ ...g, hooks: kept }];
      emptied = true;
      return [];
    });
    if (emptied && hooks[event].length === 0) delete hooks[event];
  }
  return hooks;
}
export function danglingGolemsLinks(ctx) {
  if (!existsSync(ctx.hooksDir)) return [];
  const linked = new Set(ctx.entries.filter((e) => e.link).map((e) => e.link));
  return readdirSync(ctx.hooksDir).filter((name) => !linked.has(name) && !/\.bak/.test(name))
    .filter((name) => intoLive(ctx, path.join(ctx.hooksDir, name)) && !existsSync(path.join(ctx.hooksDir, name)));
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

// hooks-live's HEAD only when hooks-live IS a worktree root. rev-parse walks up,
// so a stray non-worktree dir would otherwise report, and --update would then
// move, the main checkout (#488-b N2).
function liveHead(live) {
  if (!existsSync(live)) return null;
  const top = git(live, "rev-parse", "--show-toplevel");
  if (!top || realpathSync(top) !== realpathSync(live)) return null;
  return git(live, "rev-parse", "HEAD");
}

function selectedPin(o, live) {
  const current = liveHead(live);
  if (current && (!o.update || o.status)) return current;
  if (o.apply && !o.status) mustGit(o.repo, "fetch", "-q", "origin", "master");
  const sha = git(o.repo, "rev-parse", "--verify", `${o.status ? "origin/master" : o.update ?? "origin/master"}^{commit}`);
  if (!sha) die(`cannot resolve selected hook pin in ${o.repo}`);
  return sha;
}

function pinLive(o, live, sha, dirs = []) {
  const current = liveHead(live);
  if (current && !o.update) {
    if (o.apply) { purgeBytecode(live, dirs); relock(o.repo, live); }
    return `hooks-live: keep ${current}`;
  }
  if (!o.apply) {
    if (current) return `hooks-live: move ${current} -> ${sha}`;
    return `hooks-live: create at ${sha}${existsSync(live) ? " (a non-worktree dir there would be moved aside)" : ""}`;
  }
  if (!current) {
    if (existsSync(live)) {
      const aside = `${live}.bak-${stamp()}`;
      renameSync(live, aside);
      console.log(`hooks-live: not a worktree; moved aside to ${aside}`);
    }
    // A registration of this path may survive (missing, maybe locked). Unlock
    // only this path (git resolves symlinks) and add over its record; never a
    // repo-wide prune, never another tree's lock (#488 F1, #488-b N3/N4).
    gitProcess(o.repo, ["worktree", "unlock", live]);
    mustGit(o.repo, "worktree", "add", "-q", "-f", "--detach", live, sha);
  } else if (current !== sha) {
    assertLiveClean(live, dirs);
    purgeBytecode(live, dirs);
    mustGit(live, "checkout", "-q", "--detach", sha);
  }
  purgeBytecode(live, dirs);
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
  const r = gitProcess(o.repo, ["show", `${sha}:${e.requiresPin}`], { encoding: null });
  return r.status === 0 && pinnedFingerprints(r.stdout) > 0;
}

// git as --status must run it against hooks-live: repo config cannot answer for
// the worktree (fsmonitor/untracked cache) and replace refs cannot swap objects.
function liveGitProcess(live, args, options = {}) {
  const dir = git(live, "rev-parse", "--absolute-git-dir");
  if (!dir) return { status: 1, stdout: "", stderr: "cannot resolve live git directory" };
  return gitProcess(live, [`--git-dir=${dir}`, `--work-tree=${path.resolve(live)}`, ...args], options);
}
function liveGit(live, ...args) {
  const r = liveGitProcess(live, args);
  return r.status === 0 ? r.stdout.trim() : null;
}
function mustLiveGit(live, ...args) {
  const r = liveGitProcess(live, args);
  if (r.status !== 0) die(`live git ${args.join(" ")} failed: ${r.stderr?.trim()}`);
  return r.stdout.trim();
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
      : liveGitProcess(ctx.live, ["hash-object", "--no-filters", "--stdin-paths"],
        { input: `${regular.join("\n")}\n` });
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
  gitProcess(repo, ["worktree", "unlock", live]);
  mustGit(repo, "worktree", "lock", "--reason", LOCK_REASON, live);
}

// LocalHostNames configured by orchestrator/repogolem/config.yaml. Like
// repogolem-config.ts, read scutil; installation deliberately has no env override.
function machineHost() {
  const r = spawnSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" });
  const name = r.status === 0 ? r.stdout.trim() : "";
  const host = { "MacBook-Pro": "mbp", "Locals-MacBook-Pro": "m1" }[name];
  if (!host) die("machine identity unavailable or unmapped; refusing installation");
  return host;
}
// Only untracked regular bytecode / real cache directories are disposable.
// Never follow symlinks or exempt a tracked edit because of its filename.
function derivedPath(live, rel) {
  const parts = rel.split("/");
  const cache = parts.indexOf("__pycache__");
  if (cache < 0 && !rel.endsWith(".pyc")) return null;
  const limit = cache < 0 ? parts.length : cache + 1;
  let prefix = live;
  for (const part of parts.slice(0, limit)) {
    prefix = path.join(prefix, part);
    try { if (lstatSync(prefix).isSymbolicLink()) return null; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return parts.slice(0, limit).join("/");
}
function liveDirty(live, dirs = []) {
  if (!liveHead(live)) return false;
  const rows = mustLiveGit(live, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=no").split("\0").filter(Boolean);
  const dirty = rows.some((row) => !row.startsWith("?? ") || !derivedPath(live, row.slice(3)));
  const flags = mustLiveGit(live, "ls-files", "-v", "-z");
  const ignoredHooks = mustLiveGit(live, "ls-files", "--others", "--ignored", "--exclude-standard", "-z",
    "--", "scripts/hooks", "skills/golem-powers", ...dirs).split("\0").filter(Boolean);
  return dirty || /(^|\0)[a-zS]/.test(flags) || ignoredHooks.some((rel) => !derivedPath(live, rel));
}
export function assertLiveClean(live, dirs = []) {
  if (liveDirty(live, dirs)) {
    die(`live source is dirty (local changes or hidden index flags); refusing installation. Inspect ${live}, then re-run with --restore-live to reset it to its pin`);
  }
}
// hooks-live is a pinned tree nobody edits. A dirty tree refuses by default
// (it may be tamper evidence); after inspecting it, --restore-live resets local
// damage (deleted/edited tracked files, hidden index flags, planted extras in
// the hook dirs) to its pinned HEAD, so recovery never needs hand-run git (#488-b N1).
function restoreLive(live, dirs = [], pin) {
  const hidden = mustLiveGit(live, "ls-files", "-v", "-z").split("\0").filter((l) => /^(S|[a-z]) /.test(l)).map((l) => l.slice(2));
  if (hidden.length) mustLiveGit(live, "update-index", "--no-assume-unchanged", "--no-skip-worktree", "--", ...hidden);
  mustLiveGit(live, "checkout", "-q", "-f", "--detach", pin);
  mustLiveGit(live, "clean", "-q", "-ffdx", "--", ...new Set(["scripts/hooks", "skills/golem-powers", ".claude/hooks", "hooks", ...dirs]));
}

function bytecodePaths(live, dirs = []) {
  if (!liveHead(live)) return [];
  const files = [mustLiveGit(live, "ls-files", "--others", "--exclude-standard", "-z"),
    mustLiveGit(live, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")];
  const derived = new Set(files.flatMap((s) => s.split("\0").filter(Boolean)).map((rel) => derivedPath(live, rel)).filter(Boolean));
  const walk = (rel) => {
    const at = path.join(live, rel);
    if (!existsSync(at) || !lstatSync(at).isDirectory()) return;
    if (path.basename(rel) === "__pycache__") { derived.add(rel); return; }
    for (const name of readdirSync(at)) walk(path.join(rel, name));
  };
  for (const rel of new Set(["scripts/hooks", "skills/golem-powers", ".claude/hooks", "hooks", ...dirs])) walk(rel);
  return [...derived];
}
function purgeBytecode(live, dirs = []) {
  if (!liveHead(live)) return;
  const derived = bytecodePaths(live, dirs);
  const tracked = mustLiveGit(live, "ls-files", "-z").split("\0").filter(Boolean);
  if ([...derived].some((rel) => tracked.some((file) => file === rel || file.startsWith(rel + "/")))) {
    die("tracked cache content cannot be purged; refusing installation");
  }
  const caches = derived.filter((rel) => path.basename(rel) === "__pycache__");
  if (caches.length) console.log(`hooks-live: clearing ${caches.length} stale __pycache__ dir(s) (hooks run -B)`);
  for (const rel of derived) rmSync(path.join(live, rel), { recursive: true, force: true });
}

function install(o) {
  const machine = o.apply ? machineHost() : o.host;
  if (o.apply && machine !== o.host) die(`machine identity ${machine} does not match requested host ${o.host}; refusing installation`);
  const sha = selectedPin(o, path.join(o.repo, ".worktrees", "hooks-live"));
  // Read/validate the immutable selected manifest before creating or moving the pin.
  const ctx = context(o, sha);
  if (ctx.golems.some((e) => e.command.includes("--fail-closed")) && !supportsFailClosed(readFileSync(WRAPPER_SRC))) {
    die("REFUSED: source launcher lacks fail-closed protocol; update the installer checkout before applying");
  }
  console.log(`hook python: ${ctx.hookPython.python} (${ctx.hookPython.version})`);
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
  // Gate every selected source; missing guards and git errors cannot skip it.
  const gate = path.join(here, "private-regression-gate.py");
  const gateArgs = ["-I", gate, o.repo, sha, ...(machine === "mbp" ? ["--require-private"] : [])];
  console.log(`private regression gate: python3 ${gateArgs.join(" ")}; suites=${o.repo}/docs.local/private-guard-suites`);
  // --restore-live resets only to the RECORDED pin: a HEAD moved away from it
  // (possible tampering) is never adopted or blessed (#656 R1 F1; plain
  // --apply's moved-HEAD acceptance is #665).
  if (o.restoreLive && liveHead(ctx.live)) {
    const recorded = existsSync(pinRecord(ctx)) ? readFileSync(pinRecord(ctx), "utf8").trim() : null;
    const head = liveHead(ctx.live);
    if (head !== recorded) {
      die(`refusing --restore-live: hooks-live HEAD ${head} is not the recorded pin ${recorded ?? "(none recorded)"}; inspect ${ctx.live} (it may have been tampered with)`);
    }
  }
  if (o.restoreLive && liveDirty(ctx.live, importDirs(ctx))) {
    if (o.apply) restoreLive(ctx.live, importDirs(ctx), liveHead(ctx.live));
    console.log(`hooks-live: ${o.apply ? "restored" : "would restore"} local damage to its pinned HEAD (--restore-live)`);
  }
  if (o.apply) {
    assertLiveClean(ctx.live, importDirs(ctx));
    purgeBytecode(ctx.live, importDirs(ctx));
    const env = { ...process.env };
    for (const key of ["PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP"]) delete env[key];
    const resolved = spawnSync("sh", ["-c", "command -v python3"], { env, encoding: "utf8" });
    const python = resolved.stdout?.trim();
    if (resolved.status !== 0 || !python || !path.isAbsolute(python)) die("isolated Python runner unavailable");
    const result = spawnSync(python, gateArgs, { env, stdio: "inherit", timeout: 3_600_000 });
    assertLiveClean(ctx.live, importDirs(ctx));
    purgeBytecode(ctx.live, importDirs(ctx));
    if (result.status !== 0) die("private regression gate refused; hooks-live and host configuration untouched");
  }
  console.log(pinLive(o, ctx.live, sha, importDirs(ctx)));
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
  const retired = retiredRegistrations(ctx, settings.json.hooks);
  const dangling = danglingGolemsLinks(ctx);
  const verb = o.apply ? "removing" : "would remove";
  for (const r of retired) console.log(`${verb} retired registration: ${r.name} (${r.event})`);
  for (const name of dangling) console.log(`${verb} dangling golems link: ${name}`);
  const next = { ...settings.json, hooks: withoutRetired(withoutHooks(desiredHooks(settings.json.hooks, [...ctx.golems, ...ctx.wrapped]), refused), retired) };
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const changed = nextText !== settings.text;
  console.log(`settings.json: ${changed ? "would change" : "unchanged"} (${ctx.golems.length + ctx.wrapped.length} managed hooks)`);
  const caches = !o.apply ? bytecodePaths(ctx.live, importDirs(ctx)).filter((rel) => path.basename(rel) === "__pycache__") : [];
  if (caches.length) console.log(`hooks-live: ${o.apply ? "clearing" : "would clear"} ${caches.length} stale __pycache__ dir(s) (hooks run -B)`);
  for (const gate of ctx.codex?.refused ?? []) {
    console.log(`REFUSED codex ${gate}: its anchor pin has no owner fingerprint at ${sha}; ${o.apply ? "not registered" : "would not be registered"}.`);
  }
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
  for (const name of dangling) unlinkSync(path.join(ctx.hooksDir, name));
  writeFileSync(pinRecord(ctx), `${sha}\n`);
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
  return Object.entries(hooks).flatMap(([event, groups]) => groupsOf(groups).flatMap((group) => handlersOf(group)
    .filter((hook) => String(hook?.command ?? "").includes(e.match))
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
  const current = liveHead(ctx.live);
  const master = git(o.repo, "rev-parse", "--verify", "origin/master");
  const drift = current && master ? git(o.repo, "rev-list", "--count", `${current}..${master}`) ?? "?" : "?";
  const stray = !current && existsSync(ctx.live);
  console.log(`hooks-live=${current ?? (stray ? "NOT-A-WORKTREE" : "absent")} master=${master ?? "unknown"} drift=${drift}`);
  let bad = stray;
  if (ctx.hookPython) console.log(`hook-python=${ctx.hookPython.python} (${ctx.hookPython.version})`);
  else {
    bad = true;
    console.log(`hook-python=NONE: ${NO_PYTHON}${tried(o)})`);
  }
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
    if (!master || gitProcess(o.repo, ["merge-base", "--is-ancestor", current, master]).status !== 0) {
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
  const commands = Object.values(hooks).flatMap(groupsOf).flatMap(handlersOf).map((h) => String(h?.command ?? ""));
  const text = commands.join("\n");
  if (ctx.codex === undefined) {
    bad = true;
    console.log("codex wiring=unchecked (no acceptable hook interpreter to read config.toml)");
  } else if (codexStatus(ctx.codex)) bad = true;
  for (const gate of ctx.codex?.refused ?? []) console.log(`codex ${gate} refused(unpinned)`);
  const wrapper = path.join(ctx.hooksDir, "golems-fail-open.py");
  const source = readFileSync(WRAPPER_SRC);
  const wrapperState = !existsSync(wrapper) ? "dangling" : readFileSync(wrapper).equals(source) ? "ok" : "stale";
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
    const closed = e.command.includes("--fail-closed");
    const closedOk = state === "ok" && wrapperState === "ok" && supportsFailClosed(source);
    if (closed && !closedOk) bad = true;
    console.log(`${e.id} ${state}${closed ? ` fail-closed=${closedOk ? "yes" : "no"}` : ""}`);
    // A registered command's own interpreter, whatever the expected one is.
    if (e.command?.startsWith("{python} ")) {
      for (const { hook } of registrationMatches(hooks, g)) {
        const python = commandPython(hook.command);
        const problem = pythonProblem(python);
        if (!problem) continue;
        bad = true;
        console.log(`${e.id} interpreter BAD: ${python} (${problem})`);
      }
    }
  }
  for (const r of retiredRegistrations(ctx, hooks)) {
    bad = true;
    console.log(`retired-registered: ${r.name} (${r.event})`);
  }
  for (const name of danglingGolemsLinks(ctx)) {
    bad = true;
    console.log(`dangling golems link: ${name}`);
  }
  const active = ctx.golems.filter((g) => !(current && !pinReady(o, current, g)));
  const settingsDrift = [...active, ...ctx.wrapped].filter((e) => !registeredExactly(hooks, e)).length;
  console.log(`settings-drift=${settingsDrift}`);
  if (current && settingsDrift) bad = true;
  if (text.includes(wrapper)) {
    if (wrapperState !== "ok") bad = true;
    console.log(`golems-fail-open ${wrapperState}`);
  }
  for (const name of E1_DELETED) {
    if (text.includes(name)) {
      bad = true;
      console.log(`E1 ${name} PRESENT in settings.json`);
    }
  }
  return bad ? 1 : 0;
}

// realpath: invoked through a symlinked path (~/Gits as a link), the guard must
// still match import.meta.url, which is the real path (#488-b N3).
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  process.exit(o.status ? status(o) : install(o));
}
