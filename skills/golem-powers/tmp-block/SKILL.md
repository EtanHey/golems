---
name: tmp-block
description: "Fail-CLOSED guard denying durable writes to /tmp, /private/tmp, /var/folders, $TMPDIR; enforces <repo>/.worktrees/<name>. Triggers: tmp guard, TMP-BLOCK deny, WORKTREE-CONVENTION deny, bypass ledger. NOT for storage policy."
---

# tmp-block — durable staging only, NEVER /tmp

Hook-carried skill. The enforcing artifact is `hooks/tmp-block-pretooluse.py`
(PreToolUse on `Write|Edit|NotebookEdit|Bash`); this page is its contract and
audit guide.

**Wired location:** an installed **copy** at
`~/.claude/hooks/tmp-block/hooks/tmp-block-pretooluse.py` — never a symlink into
a working tree, which would make the live fleet-wide guard whatever branch
happens to be checked out. Install, refresh, and drift-check with
`scripts/install.sh` (`--check` exits 1 when stale). **A merge does not deploy
this hook; re-run the installer.** Details in `hooks/INSTALL.md`.

## Scope

A PreToolUse guard. The deny covers Write/Edit and Bash writes. The worktree location `<repo>/.worktrees/<name>` is the ratified convention.

## Why it exists (S04, weave 2026-06-07 Phase-2 Fix-3)

A worker ran `Write(/tmp/orqi-tts-answer-msg.md)`; the era's /tmp guard
**half-fired (validated then allowed)** — a hook validation error let the
durable write through, and Etan caught it live ("Wait, why are we writing
those things in temp?"). Class evidence: ≥24 /tmp anti-pattern findings,
4 proven costs in 24h (reboot-wiped leak worksheet, a harness fix stranded in
a prunable /tmp worktree, Etan's own terminal burned by a /tmp-worktree-held
branch). Adversary verdict: KEEP, with the deny extended to the
**canonicalized path-CLASS** and to **Bash writes**, "else it's one directory
away from useless."

## The contract — two-valued (Etan, by voice, 2026-08-17)

> *"none of y'all would be able to write to temp, but also not ask me so we
> don't get agent stuck."*

**Provably outside the temp class -> ALLOW. Everything else -> DENY, with a
reason the agent can act on. This hook NEVER emits a PreToolUse prompt.**

A prompt suspends the pane until a human answers it, and a headless Codex or
Cursor worker has no human in its pane at all — 2026-08-14/17 lost hours to
`~/Documents` probes stranding panes overnight. A deny comes back as a readable
error the agent reroutes around by itself, so the residual failure mode is the
recoverable one.

| Surface | Behavior |
|---|---|
| `Write`/`Edit`/`NotebookEdit` into the class | DENY + redirect to the repo / `docs.local/` |
| Bash output redirect (`>`, `>>`, `&>`), incl. heredoc+redirect | DENY |
| Bash `tee` / `tee -a` into the class | DENY |
| `git worktree add` into the class | DENY + redirect to `<repo>/.worktrees/` |
| `git worktree add` outside any `.worktrees/` parent | DENY + the exact fixed command (Rule 2) |
| `git worktree add` whose target can't be resolved | **DENY**, naming the exact resolution failure (golems#676's requirement, minus the prompt) |
| Any target the hook cannot read statically | **DENY** — rewrite it with a literal path, or a variable whose value has a literal head |
| Reads/deletes (`ls`, `cat`, `grep`, `rm`, `worktree list`) | NEVER denied |
| Any hook/validation error (incl. unwritable ledger) | **DENY — fail CLOSED** (the S04 half-fire class) |
| `CLAUDE_WORKER` | does NOT exempt (S04's violator was a worker) |
| The harness session scratchpad | **ALLOW** — the one sanctioned temp location (below) |

**Path-CLASS (canonicalized via realpath):** `/tmp`, `/private/tmp`,
`/var/folders`, `/private/var/folders`, the live `$TMPDIR` value, and literal
`$TMPDIR` tokens in Bash commands. The macOS `/tmp → /private/tmp` symlink is
not a route-around.

### The one exception — the harness session scratchpad (2026-08-17)

Claude Code's own system prompt hands every session a scratchpad and instructs
it, verbatim: *"IMPORTANT: Always use this scratchpad directory for temporary
files instead of `/tmp` or other system temp directories"*. The path it supplies
is inside the class this guard denies:

```
/private/tmp/claude-<uid>/<repo-slug>/<session-uuid>/scratchpad/…
```

So the harness said "put temp files here" and the guard said no. Observed live
2026-08-17: brainlayerClaude took two consecutive denials arming a monitor, and
skillcreatorClaude hit the same wall writing a test fixture the same day. Every
agent walks into it, because they are **following instructions correctly** —
the same failure shape as the "always notify on commits" flood.

**Etan's ruling, 2026-08-17: allowlist the harness session scratchpad, keep
denying every other temp path.** It is session-scoped and nothing durable
belongs there, so allowing it costs nothing Rule 1 was protecting.

The exception is structural and narrow — never a hardcoded uid or session id,
and **not** a widening of the temp path-class. The whole
`claude-<uid>/<slug>/<session-uuid>/scratchpad` chain must sit directly under a
temp root, and **every component is matched exactly**: `claude-<digits>` (not
any directory), a slug, a session UUID, and `scratchpad` (not `scratchpad-evil`
or `myscratchpad`). The #727 review found both of those relaxations surviving
the suite, so all three are now pinned by deny-side tests that redden the
mutation.

It applies to every Rule 1 write surface — `Write`/`Edit`, redirects, appends,
`tee`, heredocs — not to redirects only. Still denied:
`/private/tmp/scratchpad/x.txt` (no session chain),
`/private/tmp/claude-501/x.txt` (no scratchpad component), every `$(mktemp)`
form (a bare temp path with no chain at all), `/tmp/foo.txt`.

**`..` traversal is defended by the callers, not by the shape match.** The
path is canonicalized *before* the shape is consulted: `in_temp_class`
normalizes each candidate (normpath **and** realpath) and only then asks
whether it is scratchpad-shaped, so `…/scratchpad/../../../../leak.txt`
arrives as `/private/tmp/leak.txt` and denies; `_literal_prefix_class` rejects
a literal `..` component outright before building a probe. The normalization
inside the shape check itself is defense-in-depth for a direct caller — the
#727 review's mutation M5 removed it and opened no hole.

`scratchpad` is its own prefix-class verdict, decided independently of the
`repo`/`outside`/`temp` proofs below.

## Rule 2 — the worktree location convention (2026-08-09)

**Ratified by Etan by voice, 2026-08-09:** the fleet worktree location is the
in-repo **`<repo>/.worktrees/<name>`**.

The gap this closes is Etan's own catch, verbatim: *"I thought the guard's job
was to guard it, so it actually goes the right way."* Rule 1's deny message
**advised** `<repo>/.worktrees/` — but nothing **enforced** it, so
`git worktree add $HOME/Gits/foo.wt/bar` (durable, not temp) sailed straight
through and **18 sibling `*.wt` directories** accumulated under `$HOME/Gits/`.

| Resolved target | Decision |
|---|---|
| has a `.worktrees` ancestor component | allow |
| resolves anywhere else | **DENY**, naming the convention + `git -C <repo> worktree add <repo>/.worktrees/<name>` |
| cannot be resolved (`$UNSET`, `$(…)`, relative after `cd`/`git -C`) | **DENY**, naming the resolution failure |

Rule 2 silently allows a target whose literal or already-resolvable, repo-anchored
prefix proves `.worktrees/` containment before an unresolved variable suffix, such
as `git worktree add .worktrees/$wt` or `$HOME/Gits/golems/.worktrees/$wt`. An
unresolvable variable prefix still asks; a literal `..` escape still disqualifies
the proof; and lexical plus realpath containment checks still reject a
`.worktrees` symlink that leaves the repo.

**golems#676 applied.** git-guardian judged the *unexpanded literal* — it
blocked a legitimate cleanup of a `mktemp -d` variable, then blocked the
`gh issue create` that filed the bug because the title carried the pattern as
prose. So Rule 2: expands `~`/`$NAME` from the live environment and judges the
**resolved** path (lexical *and* realpath, so a `.worktrees` symlink pointing
at a sibling is not a route-around); fires only in **command position** (quoted
text and heredoc bodies run nothing); and **names the exact resolution failure
instead of blocking blind** when the target is unknowable. #676's requirement
was the actionable reason, not the prompt — the prompt was dropped on
2026-08-17 and the reason kept.

Migration-window hatch, mirroring Rule 1: `WEAVE_ALLOW_WT_MIGRATION=1` —
allowed AND logged. It is location-scoped only; it never unlocks the temp class
(that still needs `WEAVE_ALLOW_TMP`).

**This is the backstop, not the only fix.** It sees `git worktree add` issued
as a *Bash tool call*. Generators that create worktrees in-process never reach
it — `cmuxlayer/src/worktree.ts:240` builds `join(homeGitsDir, ` `${repo}.wt`
`, spec.name)`, which is where the 18 dirs actually came from, and is fixed in
the cmuxlayer/golems lanes. Likewise a worktree add nested in a quoted payload
(`bash -c "git worktree add …"`, an agent-spawn prompt string) is one token to
this parser and is not caught.

## Escape hatch = bypass-detector seed

Over-broad guards INDUCE route-arounds (adversary Attack 5.4), so
genuinely-ephemeral writes have a sanctioned path:

```bash
WEAVE_ALLOW_TMP=1 <command>              # temp path-class (Rule 1)
WEAVE_ALLOW_WT_MIGRATION=1 <command>     # worktree location (Rule 2)
```

Both are inline-prefix or session-exported, and both are scoped to their own
Bash simple command when used inline.

Every use is **logged** to the durable ledger
`~/.claude/logs/tmp-block-ledger.jsonl` (override: `TMP_BLOCK_LEDGER`). If the
ledger cannot be written, the bypass is DENIED — an unlogged bypass must not
proceed. Audit the ledger during weaves: entries that look durable
(`.md` notes, worksheets, worktrees) are route-arounds to flag.

## The three class proofs (`temp` / `repo` / `outside`)

A target with an unreadable suffix is still judged by its **literal head**,
because every value it can take starts with that head. The head proves one of
three classes: `temp` (deny), `repo` (allow), or — since 2026-08-17 —
`outside`, an absolute head that is provably not temp and belongs to no
repository. `outside` is what makes `> ~/Documents/probe_$$.txt` allow instead
of stranding a pane; without it the guard could prove only two classes and had
to ask about the entire home directory.

The head is read through variables too: `P=~/Documents/x_$$.txt; … > "$P"` is
judged exactly like the same path spelled inline, and `P=/private/tmp/x_$$.txt`
still reaches the hard temp-class deny. A variable with **no** literal head
(`P=$UNSET/x`, `P=$(mktemp)`) proves nothing and is refused. Rule 2 does not
consume `outside`: a worktree target must still prove repo membership.

## Known limits (the detection frontier)

Statically uncaught: inline-interpreter writes (`python3 -c "open('/tmp/…')"`),
`cp`/`mv`/`rsync` into the class, relative paths from a temp cwd.

**The guard is no longer Claude-only (corrected 2026-08-19).** The 2026-08-17
note here said neither Codex nor Cursor had a hook configured and both reached
`/tmp` freely. Measurement says otherwise on both halves; the findings are summarized in
**Cross-agent coverage** below, and the raw probe record is kept out of git in
`docs.local/plan/tmpblock-cross-agent/MEASUREMENTS.md`.

**The literal-head residual (#703, widened 2026-08-17; narrowed 2026-08-20).**
The suffix a head proof cannot read can still affect the final path. A literal
`..` inside a command-substitution body is now disqualifying, just as it is in
the outer target, so `> /durable/head$(printf /../../tmp/leak)` denies while a
non-traversing suffix such as `$(date +%s)` remains allowed. Measured history:

| head | `95964ba4` | now |
|---|---|---|
| repo-contained traversal — `<repo>/docs.local$(printf /../../tmp/x)` | allow | **deny** |
| non-repo traversal — `/workspace/golems$(printf /../../tmp/x)` | **ask** | **deny** |
| non-traversing suffix — `<repo>/docs.local/x-$(date +%s).log` | allow | allow |

The remaining accepted residual is a dynamic suffix whose output cannot be
read and whose command text contains no literal parent traversal. The
discriminator for this closure is the visible `..` component, not
repo-containment or whether a `/` separates the head from the substitution.
Both deny and allow sides are pinned beside each other in
`tests/test_worktree_anchor.py`.

The ledger + a periodic temp-dir scan for agent-shaped artifacts are the
detectors for this whole frontier — detectors trail the evasion frontier by
construction.

## Cross-agent coverage (measured 2026-08-19)

The hook is a Claude-format `PreToolUse` script, and two of the three fleet
harnesses read that format. What differs is the **tool name** each one sends,
which is why "the hook is installed" and "the hook is enforcing" were not the
same sentence.

| Harness | Loads this hook from | Shell arrives as | File write arrives as | Status |
|---|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | `Bash` | `Write`/`Edit`/`NotebookEdit` | enforcing since 2026-06-07 |
| Cursor | `~/.claude/settings.json` — read **unconditionally**, no opt-in | `Shell` | `Write` | `Write` was **already** enforcing; `Shell` was a silent no-op until this change |
| Codex | `~/.codex/hooks.json` or inline `[hooks]` | `Bash` | `apply_patch` | **not installed** — see below |

**Cursor was never unguarded, and never fully guarded.** Its bundle
(2026.08.11-e8db854) carries a literal `claudeUserConfigPath` pointing at
`~/.claude/settings.json`, and maps Claude matchers through
`{Bash: "Shell", Edit: "Write", …}`. A live probe with no local tap got the
verbatim `⛔ TMP-BLOCK` reason back for `Write(/tmp/…)` and the file was never
created — so that half has been enforcing all along. A shell redirect,
arriving as `tool_name: "Shell"`, missed the `tool_name != "Bash"` gate and was
allowed with exit 0. `TOOL_ALIASES` closes that.

**Codex has a real hook surface, and `:workspace` is not a substitute for it.**
`default_permissions = ":workspace"` does **not** deny `/tmp` — Codex prints
its own writable roots at startup, and they are
`workspace-write [workdir, /tmp, $TMPDIR]`. The sandbox does enforce (a write
to `~/Documents` under `codex sandbox` returns `Operation not permitted`), so
`/tmp` is granted on purpose, not by omission. Two surfaces can close it:

- **the hook** — `~/.codex/hooks.json`, `matcher: "Bash|apply_patch"`, enabled
  by default; this guard now speaks its dialect
  (`hookSpecificOutput.permissionDecision`) and handles its `apply_patch`
  envelope.
- **the sandbox** — `[sandbox_workspace_write] exclude_slash_tmp` /
  `exclude_tmpdir_env_var`, or a `[permissions]` profile with a `deny` on the
  `slash_tmp` / `tmpdir` special paths. This is *stronger* than the hook: it
  catches `python3 -c`, `cp`, `mv` and relative-from-temp-cwd — the entire
  detection frontier above — because it is a kernel-level sandbox rather than a
  static parse.

**Codex is deliberately NOT wired by this change.** Two things must be verified
live first, and Codex was usage-limited until 2026-08-20 06:32:

1. Whether Codex honours a refusal delivered as **exit 2 with JSON on stdout**.
   The documented deny shape is emitted, but the exit-code contract is not
   documented and was not measured.
2. That the hook's **trust review** has been completed. Codex skips a
   non-managed hook until its exact definition is reviewed and trusted via
   `/hooks`. An untrusted hook does not fail loudly — it silently does not run,
   which is the one failure mode this guard must never ship.

Until both are measured, Codex coverage is a **documented, unenforced** rule:
the fleet law is in the Codex instruction surface, and no claim of Codex
enforcement belongs in a report. OpenAI's own docs say it plainly — *"Treat
tool hooks as a useful guardrail, not a complete enforcement boundary."*

## Install & evals

- Install: `hooks/INSTALL.md` (symlink + settings.json PreToolUse entry).
- Evals: `hooks/tests/test_tmp_block.py` (**280 cases**, incl. the verbatim S04
  replay), `tests/test_worktree_anchor.py` (**78 cases**, static anchor and
  literal-head unit coverage), and `hooks/tests/test_cross_agent.py`
  (**26 cases**, the measured Cursor and Codex payload shapes and the refusal
  dialect) — **384 together**. Rule 1: RED against the prior guard stack
  (15/17 pass-through), GREEN. Rule 2: RED 12 failing / 51 passing against the
  advise-only guard (every enforcement case exited 0 with `{}`; the
  `.worktrees/` and prose cases were already silent), GREEN.
  Run both: `python3 -m pytest hooks/tests/ tests/ -q`.
