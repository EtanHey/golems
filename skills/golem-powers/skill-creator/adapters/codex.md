# Codex — skill-creator Adapter

> How skillCreatorCodex (OpenAI Codex CLI in `$SKILL_CREATOR_ROOT/`) runs the workflows in this skill.

## Launcher

```bash
skillCreatorCodex         # codex
skillCreatorCodex -c      # continue last session
skillCreatorCodex --fast  # gpt-5.3-codex-spark (parallel batched work)
```

cwd is set to `$SKILL_CREATOR_ROOT/` automatically by the repoGolem launcher.

Codex reads `AGENTS.md` (the parallel of CLAUDE.md) on session start. The mining workflow doc lives in `$HOME/.golems/skills/golem-powers/skill-creator/workflows/mine-session.md` and Codex resolves it via the skill registry like Claude does.

## What's different vs Claude

Codex has typed sub-agents, but the invocation surface differs from Claude. Etan's "Spark, normal subagents, informal ones" vocabulary maps to Codex's three-layer system:

| Etan's word | Codex docs term | Where it lives | Invocation |
|---|---|---|---|
| **Normal subagents** | Custom agents (typed TOML) | `~/.codex/agents/<name>.toml` (user-scope) or `.codex/agents/<name>.toml` (project-scope, requires trust) | Reference `name` field in natural-language prompt |
| **Informal ones** | Built-in agents (untyped) | None on disk — ship with Codex (`default`, `worker`, `explorer`) | Reference by built-in name OR describe role inline |
| **Spark** | NOT a subagent type — `gpt-5.3-codex-spark` model + `spawn_agents_on_csv` fanout tool | Model field on any agent; tool callable by parent | Set `model = "gpt-5.3-codex-spark"` on a custom/built-in agent OR call `spawn_agents_on_csv` |

| Concern | Claude | Codex |
|---|---|---|
| Agent definition | `.claude/agents/<name>.md` (Markdown + YAML frontmatter) | `.codex/agents/<name>.toml` or `~/.codex/agents/<name>.toml` (TOML) |
| Invocation | Typed parameter: `Agent(subagent_type="x", ...)` | Untyped: reference agent's `name` field in natural-language prompt |
| Built-in agents | None | Three: `default`, `worker`, `explorer` |
| Discoverability | `ls .claude/agents/` | `ls .codex/agents/` + `cat ~/.codex/config.toml` (built-ins have no files) |
| Parallel fan-out | Multiple `Agent` calls in one message | Multiple named references OR `spawn_agents_on_csv` tool |
| Recursion | Allowed by default | Disallowed by default (`agents.max_depth = 1`) |
| Slash command | n/a for spawning | `/agent` to switch active thread; `/experimental` to toggle subagent surface |

What this means for skill-creator workflows: a workflow that uses a Claude `subagent_type` translates to a Codex custom-agent file plus an in-prose invocation by name. Same isolation guarantees, different surface. The "not navigable like Anthropic" phrasing Etan used means: in Claude you introspect "what subagent types exist?" by reading the directory; in Codex you have to read TOML files AND know about the built-ins separately — there's no `codex agent list` and no `codex spawn <name>` CLI verb.

> **Discoverability footgun (GitHub issue [#18823](https://github.com/openai/codex/issues/18823)):** Codex itself routinely misroutes "create a custom agent" → "let me write a SKILL.md." When asking Codex to author a Codex subagent, be explicit: say "TOML file in `.codex/agents/`" not "agent" — Codex will write a SKILL.md otherwise.

## Workflow invocations

### create-skill

skillCreatorCodex is excellent at implementation work — once the design + evals are scoped (typically by skillCreatorClaude), Codex implements the skill content, writes evals.json, runs the live-eval-runner.sh comparisons, and produces the PR. The Anthropic Agent SDK pricing post-June-15 makes Codex the natural default for heavy implementation work.

### live-eval

Codex CAN dispatch a live-eval via a custom subagent. Two options:

1. **Custom dispatcher subagent** at `.codex/agents/live-eval-dispatcher.toml`. Codex spawns it by name; the subagent thread runs the paired test sessions and writes captured output to JSON. Parent stays clean.
2. **Test subject** — Codex can be the agent under test in a live-eval dispatched by Claude (or by another Codex parent). Either way, Codex receives the prompt and produces output the harness captures.

Codex can also fan out N test variants in parallel using `spawn_agents_on_csv` — one CSV row per variant, the parent collects results.

### ab-compare

Same shape as live-eval — Codex can be the dispatcher (via a custom subagent that runs paired with-skill / without-skill sessions) or a subject. The `spawn_agents_on_csv` tool is a natural fit for batched A/B runs across many fixtures.

### mine-session (Codex path)

Two valid patterns. Pick based on whether the dedicated `session_miner` custom agent is installed.

**Pattern A — custom subagent (preferred):**

If `$SKILL_CREATOR_ROOT/.codex/agents/session-miner.toml` is in place (installed by `scripts/install.sh`), skillCreatorCodex spawns the agent by name in prose:

> *"session_miner, mine `<jsonl_path>` to `<out_path>` with label `<label>`."*

The subagent thread runs the parser, verifies sections, runs gap-check grep, appends a HONESTY DISCLAIMER if claims fail, and reports `TASK_DONE` to the parent. The parent context never absorbs the JSONL — child thread is isolated.

**Pattern B — direct parser invocation (fallback):**

If the custom agent isn't installed yet, skillCreatorCodex runs the parser directly via Bash:

```bash
python3 $SKILL_CREATOR_ROOT/scripts/session-miner.py \
  --src <absolute path to JSONL> \
  --out <absolute output md path> \
  --label <short-label>
```

Then Codex MUST:

1. **Read the output** with its own Read tool — don't trust the exit code alone.
2. **Verify the 10 sections rendered** (`grep -c "^## " <out>` should return 10 or 11).
3. **Run the gap check** if the parent's brief made specific claims:
   ```bash
   grep -c "PR #199\|59d24b4\|<other tokens>" <src.jsonl>
   ```
   If zero hits for claimed work, append a HONESTY DISCLAIMER + GAP REPORT section. Template: `$ORCHESTRATOR_ROOT/docs.local/handoffs/2026-05-15-eod-mine/voicelayer-session-mine.md`.
4. **Report back:** `TASK_DONE session-mine <label> <out_path> <line_count>` + `GAPS: <none | list>`.

**Pattern B is the safe default** until the custom agent ships. Pattern A is the goal — switch defaults once `session-miner.toml` is in place. See `$SKILL_CREATOR_ROOT/docs.local/research/2026-05-15-codex-subagents.md` Part 3.3 for the TOML contents.

### Parallel mining waves (Codex)

Two valid patterns, pick by batch size:

**Small batch (≤4 sessions) — name-fan-out:**

> *"In parallel: session_miner mine orc.jsonl → orc-mine.md. session_miner mine voicelayer.jsonl → voicelayer-mine.md. session_miner mine brainlayer.jsonl → brainlayer-mine.md."*

Codex spawns one thread per named reference, capped at `agents.max_threads` (default 6; Etan's `~/.codex/config.toml` setting is 4).

**Large batch (5+ sessions) — `spawn_agents_on_csv`:**

Build `mining-batch.csv` with columns `jsonl_path`, `out_path`, `label`. Then prompt Codex:

> *"Run spawn_agents_on_csv on mining-batch.csv. Instruction template: 'session_miner, mine {jsonl_path} to {out_path} with label {label}'. max_concurrency 4."*

Codex fans out one worker per row, merges results to a final CSV.

**Sequential parser-shell fallback** (Pattern B above) is still valid for one-off mining, especially before the custom agent is installed:

```bash
python3 $SKILL_CREATOR_ROOT/scripts/session-miner.py --src <jsonl1> --out <out1> --label orc &
python3 $SKILL_CREATOR_ROOT/scripts/session-miner.py --src <jsonl2> --out <out2> --label voicelayer &
wait
```

## Hard rules (Codex-specific)

- Read every output file — Codex equivalent of /never-fabricate.
- For PRs: follow `AGENTS.md` rules. Don't push without explicit instruction.
- Codex's strength is mechanical implementation; for architectural calls, hand back to skillCreatorClaude.
- The Spark model (`gpt-5.3-codex-spark`, ChatGPT Pro tier, accessed via `skillCreatorCodex --fast`) is a small fast variant of gpt-5.3-codex (>1000 tok/s). **Not a subagent type** — it's a model you can set on ANY custom or built-in subagent via `model = "gpt-5.3-codex-spark"`. Pair Spark with `spawn_agents_on_csv` for high-throughput batched mining.

## Cost calibration

| Workflow | Typical cost | Notes |
|---|---|---|
| Create-skill implementation | "$0" (within OpenAI Plus/Pro sub) | Codex bills against existing sub; effectively free relative to Anthropic |
| Mine-session (per JSONL) | "$0" + ~30s | Parser does the work; Codex just reports |
| EOD mining wave | "$0" | Strong fit for Codex — mechanical, parallelizable |

Use Codex for the implementation half of skill work and the parallel mining half. Reserve Claude for architectural reasoning and live A/B dispatching.
