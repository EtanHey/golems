---
name: repogolem
description: "Launch repoGolem agents in any repo. Triggers: spawn agent, launcher, brainlayerClaude, flags -s/-c/-w/--worker."
---

# repoGolem — Unified Launcher System

> Fleet law: canon #5 owns model policy; canon #6 owns launcher naming, registry override precedence, and skip-perms. This skill keeps invocation mechanics, examples, and troubleshooting.

> Every project has launchers: `{name}Claude`, `{name}Codex`, `{name}Cursor`, `{name}Gemini`, `{name}Kiro`.
> The launcher handles EVERYTHING: cd to repo, MCP wiring, secrets, iTerm profile, badge.
> You NEVER need `source ~/.zshrc && cd $HOME/Gits/X && claude -s`. Just: `brainlayerClaude -s`.

---

## UNIFIED FLAGS (same across ALL CLIs)

| Flag | Short | What It Does | Claude | Codex | Cursor |
|------|-------|-------------|--------|-------|--------|
| Skip permissions | `-s` | Auto-approve tool calls | `--dangerously-skip-permissions` | Compatibility no-op; host config supplies the policy | `--yolo --approve-mcps` |
| Continue/resume | `-c` | Resume last session | `--continue` | Resume the newest usable rollout for the launch cwd | (no-op, not supported) |
| Model override | `-m <model>` | Explicit model selection | Non-Sonnet full panes allowed; Sonnet headless only | Any model string passes through | Refused for interactive agent sessions |
| Reasoning effort | `-E <effort>` | Explicit Codex effort | — | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | — |
| Headless/print | `-p "prompt"` | Scripted one-shot only; NOT agent sessions or verification gates | `--print -p "prompt"` | Headless prompt | `--print --output-format text` |
| Worktree | `-w <abs-path>` | Launch from pre-created git worktree cwd | `cd <path>` | `cd <path>` | `cd <path>` |

**CRITICAL:**
- `-s` = skip permissions. For Codex it is a compatibility no-op; `golem-install` validates `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` in host config. Capital `-S`/`--sonnet` is a separate Claude-only model request and is refused for full panes.
- Model/session policy lives in canon #5. A bare Claude launch pins the current top Opus at 1M; a bare Codex launch pins the current top Sol. Explicit Codex `-m` and `-E` values pass through, including when supplied through cmux `spawn_agent`.
- `-p` is NOT for agent sessions or verification gates. Open scope: it may survive for non-agent scripted one-shots; confirm with Etan before using it in automation.
- Codex resume is fail-closed. `-c` requires at least one usable rollout for the launch cwd and skips malformed newer candidates; a fresh cwd with no usable rollout exits loudly. Bare `resume` picker mode is refused because the launcher cannot recover model/effort before the picker selects a session.
- Codex `-p/--print` cannot be combined with `-c` or explicit `resume`; that combination exits loudly instead of silently starting a fresh headless session. A resumed session restores its recorded model and effort; explicit `-m` and/or `-E` override the recovered field, and when both are explicit the launcher skips rollout-state recovery and lets Codex validate the requested session.
- `-c` on Cursor is a no-op (not supported yet)

---

## LAUNCHER NAME PATTERN

```
{projectName}{CLI}

Examples:
  brainlayerClaude    brainlayerCodex    brainlayerCursor
  golemsClaude        golemsCodex        golemsCursor
  orcClaude           orcCodex           orcCursor
  6pmClaude           6pmCodex           6pmCursor
  dashboardClaude     dashboardCodex     dashboardCursor
```

The name is the project key from `~/.config/ralphtools/registry.json`, lowercased.

### Agent-style projects

Registry entries can include an `agent` field:

```json
{
  "yash": {
    "path": "$HOME/Gits/golems",
    "agent": "yash",
    "clis": ["claude", "codex", "cursor", "gemini", "kiro"]
  }
}
```

Claude launchers pass this through as `--agent <name>`.
Codex, Cursor, Gemini, and Kiro do not read Claude Agent SDK files directly, so repoGolem reads `~/.claude/agents/<name>.md` and injects it as the launcher's initial prompt.
It preserves the frontmatter `initialPrompt` block when present, strips the rest of the YAML metadata, then appends the Markdown body.
This is intentional: `yashCodex`, `yashCursor`, `yashGemini`, and `yashKiro` should inherit the same agent protocol instead of acting like generic shells in the project directory.

### Plain Codex worker mode

Agent-style `*Codex` launchers keep registry persona injection by default. Opt into
a plain worker with the long-only `--worker` flag or `GOLEM_ROLE=worker`:

```bash
orcCodex --worker -s -w $HOME/Gits/orchestrator.wt/my-lane
GOLEM_ROLE=worker orcCodex -s -w $HOME/Gits/orchestrator.wt/my-lane
```

The generated `*CodexWorker` aliases remain compatible and select the same mode.
Worker mode adds only a one-line role banner before an optional caller prompt; it
does not inject registry agent front-matter or boot-store instructions. Short
`-w` remains the worktree-path flag and always requires an absolute path.

### WARNING — launcher names strip hyphens from repo names

repoGolem launcher names are generated from the registry key, not the raw repo folder name. If a repo name contains hyphens, the launcher drops them:

```text
repo: skill-creator
wrong launcher guess: skill-creatorClaude
actual launcher:      skillcreatorClaude
```

This matters when another tool tries to build a launcher name from `repo` directly. Known live failure: `mcp__cmuxlayer__spawn_agent({repo:"skill-creator", cli:"claude"})` guessed `skill-creatorClaude`, hit `zsh: command not found`, and left the agent stuck at `booting`.

**Before relying on a generated launcher for a new repo, verify the real launcher first:**

```bash
which skillcreatorClaude
which skillcreatorCodex
which skillcreatorCursor
```

If the launcher guess is wrong, use the verified repoGolem launcher manually until cmuxlayer normalizes `repo -> launcher` with the same hyphen-stripping rule.

---

## KEY REGISTERED PROJECTS

| Project | Path | Launchers |
|---------|------|-----------|
| golems | $HOME/Gits/golems | golemsClaude, golemsCodex, golemsCursor |
| brainlayer | $HOME/Gits/brainlayer | brainlayerClaude, brainlayerCodex, brainlayerCursor |
| voicelayer | $HOME/Gits/voicelayer | voicelayerClaude, voicelayerCodex, voicelayerCursor |
| orc (orchestrator) | $ORCHESTRATOR_REPO | orcClaude, orcCodex, orcCursor |
| dashboard | $HOME/Gits/golems-dashboard | dashboardClaude, dashboardCodex, dashboardCursor |
| 6pm | $HOME/Gits/6pm-mini | 6pmClaude, 6pmCodex, 6pmCursor |
| portfolio | $HOME/Gits/etanheyman.com | portfolioClaude, portfolioCodex, portfolioCursor |
| taskowl | $HOME/Gits/taskowl | taskowlClaude, taskowlCodex, taskowlCursor |
| taskowl | $HOME/Gits/TaskOwl-app | taskowlClaude, taskowlCodex, taskowlCursor |
| cmuxlayer | $HOME/Gits/cmuxlayer | cmuxlayerClaude, cmuxlayerCodex, cmuxlayerCursor |
| mcplayer | $HOME/Gits/mcplayer | mcplayerClaude, mcplayerCodex, mcplayerCursor |
| metacomlayer | $HOME/Gits/metacomlayer | metacomlayerClaude, metacomlayerCodex, metacomlayerCursor |
| qwan | $HOME/Gits/qwan-drill | qwanClaude, qwanCodex, qwanCursor |
| coach | $HOME/Gits/golems/packages/coach | coachClaude, coachCodex, coachCursor |
| jobs | $HOME/Gits/golems/packages/jobs | jobsClaude, jobsCodex, jobsCursor |
| content | $HOME/Gits/golems/packages/content | contentClaude, contentCodex, contentCursor |
| services | $HOME/Gits/golems/packages/services | servicesClaude, servicesCodex, servicesCursor |
| skills | $HOME/Gits/golems | skillsClaude, skillsCodex, skillsCursor |
| eval | $ORCHESTRATOR_REPO | evalClaude, evalCodex, evalCursor |
| maintenance | $ORCHESTRATOR_REPO | maintenanceClaude, maintenanceCodex, maintenanceCursor |
| recruiter | $HOME/Gits/recruiterGolem | recruiterClaude, recruiterCodex, recruiterCursor |
| teller | $HOME/Gits/tellerGolem | tellerClaude, tellerCodex, tellerCursor |
| monitor | $HOME/Gits/monitorGolem | monitorClaude, monitorCodex, monitorCursor |
| rudy | $HOME/Gits/rudy-monorepo | rudyClaude, rudyCodex, rudyCursor |
| songscript | $HOME/Gits/songscript | songscriptClaude, songscriptCodex, songscriptCursor |
| union | $HOME/Gits/union | unionClaude, unionCodex, unionCursor |
| ralph | ~/.config/ralph | ralphClaude, ralphCodex, ralphCursor |
| taba | $HOME/Gits/taba | tabaClaude, tabaCodex, tabaCursor |
| project2 | ~/Desktop | project2Claude, project2Codex, project2Cursor |
| maakaf | $HOME/Gits/maakaf_home | maakafClaude, maakafCodex, maakafCursor |

### brainlayer topology — bare-mirror-style hub, main lives elsewhere (2026-06-07 weave E12)

`$HOME/Gits/brainlayer` is the repo HUB, not the canonical main checkout: `main` is
checked out at `$HOME/Gits/brainlayer-prod` (the prod/deploy worktree), and feature
branches live in worktrees under `$HOME/Gits/brainlayer/.worktrees/`. Two rules:

1. **Briefs must PIN the exact worktree path** (`-w $HOME/Gits/brainlayer/.worktrees/<task>`).
   A brief that just says "brainlayer" leaves the worker guessing among three
   checkouts — live failure: worker's `git status` failed despite `.git`
   existing because the brief never pinned a path (bl-orqi-codex#2).
2. **Local merges fail there.** Because `main` is held by `brainlayer-prod`,
   `gh pr merge --delete-branch` from any other checkout dies with
   `'main' is already used by worktree at '…/brainlayer-prod'` — see
   /pr-loop "Worktree-Locked Local Merge" for the remote fallback.

---

## USAGE PATTERNS

### Interactive agent (most common)
```bash
brainlayerClaude -s          # Claude in brainlayer repo, skip-permissions
orcCodex -s                  # Codex in orchestrator repo, skip-permissions
golemsCursor -s              # Cursor in golems repo, skip-permissions
```

### Continue/resume a session
```bash
brainlayerClaude -s -c       # Resume last Claude session in brainlayer
orcClaude --resume            # Session picker for orchestrator
brainlayerCodex -s -c         # Resume newest usable Codex rollout for this cwd
brainlayerCodex -s resume ID  # Resume an explicit Codex session UUID
```

Codex deliberately refuses bare `resume` picker mode, `-c` in a cwd with no usable rollout, and
every resume combined with `-p/--print`. These are fail-closed continuity guards: use `-c` from the
session's cwd or pass its UUID, and send any follow-up prompt after the interactive resume opens.
The fresh-cwd `-c` failure says `Cannot honor Codex resume: no rollout found for selector --last in
${CODEX_HOME:-$HOME/.codex}/sessions.`; bare `resume` says `Cannot honor Codex resume: no session id
or --last selector was provided.` If matching rollouts exist but none carries usable state, it says
`Cannot honor Codex resume: no usable model/effort state found for selector --last.`

### Launch in a worktree
```bash
# Create the worktree FIRST — bare names fail silently. IN-REPO convention (ratified 2026-08-09):
git -C $HOME/Gits/golems worktree add $HOME/Gits/golems/.worktrees/my-task -b feat/my-task origin/master
golemsCodex -s -w $HOME/Gits/golems/.worktrees/my-task

# (legacy sibling $HOME/Gits/<repo>.wt/ paths resolve read-only until 2026-09-30, then die)
```

The launcher consumes `-w/--worktree`, **`cd`s to the literal argument**, and does
not pass `--worktree` to the underlying CLI.

**`-w` contract (gen-12 weave E16):** the path must be a **pre-created absolute
worktree directory** that already exists on disk. The launcher does NOT resolve
bare names, create worktrees, or fall back to the main checkout.

```
WRONG: golemsCodex -s -w weave-edits-a
       → _golem_launch_codex:cd:22: no such file or directory: weave-edits-a
       → 120s boot-timeout waiting for a pane that never started (ea8514a2:[643])
RIGHT: git worktree add … then golemsCodex -s -w $HOME/Gits/golems/.worktrees/weave-edits-a
```

An **absolute path that does not exist yet** dies the same way, one step earlier: when the
repo has a `.mcp.json`, the launcher copies it into the worktree *before* the `cd`
(`golem-dispatch.zsh:486`), so a missing directory aborts at the `cp` and drops you back at
the shell. The pane looks like it simply never booted — silent lane death (2026-08-09).

**`-w` never creates — `spawn_agent` does.** Use `spawn_agent({repo, cli, worktree:true})`
(or `worktree:{name|path|branch|base}`) to create/reuse the worktree at launch; `-w` is
launch-in-an-already-existing-worktree only.

Alternative fix (not shipped here): teach the launcher to resolve/create worktree
paths from bare names — until then, briefs must inline absolute verified paths.

### Scripted one-shot (NOT agent sessions; scope under review)
```bash
brainlayerCursor -s -p "Audit all .py files for stubs"
# → runs cursor agent --yolo --approve-mcps --print --output-format text "prompt"
```

Do not use this form for workers, leads, or verification gates. Those are interactive repoGolem launcher sessions (`brainlayerCursor -s`, then send the prompt). Whether `-p` should remain for non-agent scripted one-shots is an open scope question for Etan; keep the flag documented, but do not apply it to agent sessions.

### Model policy
```bash
orcClaude -s                              # Default: current top Opus at 1M
brainlayerClaude -s -m claude-opus-4-8   # Explicit non-Sonnet full pane
brainlayerClaude -s -S                    # Refused: Sonnet is headless/subagent-only
brainlayerClaude -s -p "one shot" -S     # Allowed headless Sonnet run
brainlayerCodex -s                        # Default: current top Sol
brainlayerCodex -s -m gpt-5.6-luna -E max # Explicit Codex model + effort
```

Launcher enforcement is defined by canon #5. Claude refuses Sonnet-tier models for full panes but accepts explicit non-Sonnet models. Codex passes explicit model and effort values through; its own runtime validates the requested model. `-p` remains scripted one-shot mode, not a worker/lead session or verification gate.

### Via cmux (spawning from orchestrator)
```text
spawn_agent({ repo: "brainlayer", cli: "codex", model: "gpt-5.6-luna", effort: "high", prompt: "Fix the FTS5 sync issue in search.py" })
→ returns agent_id

wait_for({ agent_id, target_state: "ready", timeout_ms: 120000 })
send_to({ agent_id, text: "Keep the fix narrow and cite the changed file", press_enter: true })
```

cmuxlayer PR #396 is merged: an explicit Codex `model` is checked against `codex debug models
--bundled` before a pane is created, then `model` and `effort` are passed to the repoGolem launcher
as `-m` and `-E`. Omit `model` to use the launcher's bare top-Sol pin; include it when the mission
requires a specific supported model. Unsupported models fail before surface creation; if cmuxlayer
prepared a new worktree first, it rolls that worktree back. At read time `spawn_agent.effort` accepts
`medium`, `high`, `xhigh`, and `ultra`; use the launcher directly for supported `low` or `max`.

**NEVER do this:**
```bash
# WRONG — raw CLI, no launcher
send_to({ mode: "surface", surface, text: "source ~/.zshrc && cd $HOME/Gits/brainlayer && codex --dangerously-bypass-approvals-and-sandbox" })
```

---

## WHAT LAUNCHERS HANDLE (so you don't have to)

1. **cd to repo** — changes to the correct directory
2. **MCP wiring** — builds `.mcp.json` from registry, merges with repo's `.mcp.json`
3. **Secrets** — sets up 1Password-backed env vars via `ralph-secrets.zsh`
4. **iTerm profile** — switches to "Golems" profile with correct font
5. **Tab title + badge** — sets emoji + project name (e.g., "🌔 golemsClaude")
6. **BrainLayer project tag** — worktree path becomes the project tag automatically (e.g., `brainlayer-p0-hybrid` → `project:"brainlayer-p0-hybrid"`)

---

## HOW TO ADD A NEW PROJECT

1. Edit `~/.config/ralphtools/registry.json`:
```json
"myproject": {
    "path": "$HOME/Gits/myproject",
    "displayName": "My Project",
    "mcps": [],
    "secrets": {},
    "created": "2026-04-05T00:00:00Z",
    "clis": ["claude", "codex", "cursor"]
}
```

2. Regenerate launchers:
```bash
_ralph_generate_launchers_from_registry
source ~/.config/ralphtools/launchers.zsh
```

3. Verify: `which myprojectClaude` should resolve.

---

## HOW TO ADD A NEW CLI TO ALL PROJECTS

Example: adding `cursor` to all 27 projects (done April 4, 2026):

1. Edit registry.json — add `"cursor"` to each project's `clis` array
2. Regenerate: `_ralph_generate_launchers_from_registry`
3. Source: `source ~/.config/ralphtools/launchers.zsh`
4. Verify: `which brainlayerCursor` for a few projects

---

## CRITICAL GOTCHAS

### `-s` is a LAUNCHER flag, not a Claude CLI flag
`-s` only works with repoGolem launchers (`brainlayerClaude -s`). When using raw `claude --agent`, you MUST spell out `--dangerously-skip-permissions`. Evidence: `claude --agent skill-creator -s` failed; had to use `claude --agent skill-creator --dangerously-skip-permissions`.

### Codex: bare pins Sol; explicit selections are first-class
Canon #5 owns the choice. Use the bare launcher when the current top Sol is intended; use `-m`/`-E`
when the mission names a supported model or effort. cmux `spawn_agent.model` is equivalent for model
selection, while its current effort enum is the four-value subset documented above. Verify effective
values from Codex session metadata rather than the agent's self-description.

### Cursor model: expect default/Auto
User complained when Cursor defaulted to a specific model instead of Auto. Don't override with `--model` for Cursor data-gathering tasks.

### `-p` is NOT for agent sessions
For interactive agents (monitored via cmux), launch WITHOUT `-p`: `brainlayerCursor -s`. Then send prompt separately. This includes verification gates. `-p` remains documented only for possible non-agent scripted one-shots; that scope needs Etan confirmation before automation depends on it.

## TROUBLESHOOTING

| Problem | Fix |
|---------|-----|
| `command not found: brainlayerClaude` | `source ~/.config/ralphtools/launchers.zsh` |
| Launcher doesn't cd to repo | Check `path` in registry.json |
| MCP not available in session | Check `mcps` array in registry.json, regenerate |
| Wrong iTerm badge | Check `emoji` field in registry.json |
| No launcher for a repo | Add to registry.json, regenerate (see above) |
| `--agent` flag with `-s` | `-s` is a launcher flag, NOT a Claude flag. Use `--dangerously-skip-permissions` explicitly |
| `-force` error on Cursor | Use `--force` (double dash), not `-force` |

---

## INTEGRATION

| Skill | How repoGolem Integrates |
|-------|-------------------------|
| `/agent-routing` | Routing says WHO (Cursor/Codex/Claude). repoGolem says HOW to launch them. |
| `/cmux-agents` | `spawn_agent` is the default visible-worker path; repoGolem still defines the launcher names underneath (R10) |
| `/orc` | R10 iron rule: "Use repoGolem launcher functions. ALWAYS. NEVER raw CLI." |
| `/session-handoff` | Agent resume table includes launcher commands for crash recovery |

---

## REGISTRY LOCATION

```
~/.config/ralphtools/registry.json     — project definitions, MCP configs, CLI lists
~/.config/ralphtools/lib/ralph-registry.zsh  — generator (creates launcher functions)
~/.config/ralphtools/launchers.zsh     — auto-generated launcher functions (source this)
```
