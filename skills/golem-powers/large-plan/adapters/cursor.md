# Cursor CLI — large-plan Adapter

> Platform-specific syntax for large-plan research and audit phases with Cursor.

## Research Phase

`@codebase` gives Cursor whole-repo semantic context — best for codebase-wide research phases:

```bash
cursor agent --model "gpt-5.3-codex-xhigh" "
@codebase Analyze <topic> across the codebase. Write findings to <plan-dir>/phase-N/findings.md.
<output_contract>
Include: current state, patterns found, gaps, recommendations, file:line references.
</output_contract>
"
```

## Phase Audit (Before Push)

```bash
# Text output mode — read-only, no file edits
cursor agent --output-format text --model "gpt-5.3-codex-xhigh" "
@codebase Audit files changed in phase N (git diff master..HEAD).
Report: file path, line number, severity (HIGH/MEDIUM/LOW), issue description.
" > /tmp/phase-<N>-audit.md
```

## Worktree Setup (Manual)

Same as Codex — no native worktree support:

```bash
git worktree add -b feature/phase-<N>-<name> ../wt-phase-<N> master
ln -s ../$(basename $PWD)/node_modules ../wt-phase-<N>/node_modules
cd ../wt-phase-<N>
cursor agent "phase prompt"
```

## PR Review (Bugbot)

After pushing a phase PR, trigger review as a PR comment:

```
@cursor @bugbot review
```

Re-review after fixes: `@cursor @bugbot re-review`

## Always Verify Cursor Findings

Cursor can report gitignored or untracked files as "committed":

```bash
# Is this file actually git-tracked?
git ls-files -- <path>           # empty = not tracked

# Was this secret ever committed?
git log --all -- <path>          # empty = never in history
```

## Limitations

- No subagent spawning
- No session resume
- No MCP access — write findings to markdown files
- No CronCreate / /loop
- Findings need manual git verification before acting on them
