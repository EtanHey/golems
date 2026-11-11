# Red Team Review Workflow

Adversarial review focused on security, reliability, and crash scenarios.

## Prerequisites

- T3 dispatch available; follow `/agent-routing` for provider selection
- Git repo with changes to review (uncommitted diff or PR)
- Access to `references/red-team-prompt.md`

## Steps

### 1. Get the Diff

```bash
# For uncommitted changes
DIFF=$(git diff HEAD)

# For last commit
DIFF=$(git diff HEAD~1)

# For a PR
DIFF=$(gh pr diff <PR_NUMBER>)
```

### 2. Detect Repo Tech Stack

```bash
# Auto-detect from project files
STACK="Unknown"
[ -f package.json ] && STACK="Node.js/TypeScript ($(jq -r '.dependencies | keys[:5] | join(", ")' package.json 2>/dev/null || echo 'unknown deps'))"
[ -f Cargo.toml ] && STACK="Rust"
[ -f requirements.txt ] && STACK="Python"
[ -f go.mod ] && STACK="Go"
[ -f Package.swift ] && STACK="Swift"
[ -f build.gradle ] && STACK="JVM (Gradle)"
echo "Detected stack: $STACK"
```

### 3. Resolve Repo Context

Use the repo context map below. Match the current repo name (from `basename $(git rev-parse --show-toplevel)`) against the table. If no match, use Default.

### 4. Build and Run the Prompt

T3 `delegate_task` with `target: {providerInstanceId: "cursor", model: "default"}` (Auto). Write one brief file per child; dispatch `Read and follow <absolute brief path>`. Each brief says `Report to <collab path>, not to the lead thread.` Never use a headless CLI, AutoCursor runner, or background Cursor loop. Never select a named Cursor model; `default` is the T3 Auto sentinel.

Put the relevant prompt template, diff/base/head, report path and read-only constraints in the brief. The lead routes review; workers do not start their own reviewers.

### 5. Parse Output

The prompt produces H/M/L rated findings. Quick triage:

- **H findings:** Block merge. Fix before proceeding.
- **M findings:** Fix in same PR if feasible. Otherwise track as follow-up.
- **L findings:** Address if quick. Otherwise note for future.

### 6. Report

Save structured output:

T3 `delegate_task` with `target: {providerInstanceId: "cursor", model: "default"}` (Auto). Write one brief file per child; dispatch `Read and follow <absolute brief path>`. Each brief says `Report to <collab path>, not to the lead thread.` Never use a headless CLI, AutoCursor runner, or background Cursor loop. Never select a named Cursor model; `default` is the T3 Auto sentinel.

Put the relevant prompt template, diff/base/head, report path and read-only constraints in the brief. The lead routes review; workers do not start their own reviewers.

---

## Repo Context Map

| Repo | Context |
|------|---------|
| golems | Skills/tools monorepo. TypeScript + Bash. Watch for: skill naming conflicts, broken symlinks, missing evals, circular skill references. Build: bun. Test: bun test. |
| brainlayer | SQLite + FTS5 + vector embeddings. Python + TypeScript. Watch for: write contention (single-writer SQLite), WAL corruption, query injection, embedding dimension mismatches. |
| orchestrator | Coordination layer. Markdown + Bash + YAML. Watch for: context blowup in prompts, agent routing errors, stale collab state, hook performance. |
| voicelayer | Swift + TypeScript MCP. Watch for: socket lifecycle, audio format mismatches, TTS/STT timeout handling, daemon process leaks. |
| 6pm-mini | Convex + React Native. Watch for: mutation serialization races, component re-render storms, RTL layout issues (Hebrew), offline state corruption. |
| taskowl | Next.js + Convex + RTL. Watch for: SSR hydration mismatches, Hebrew text alignment, date/timezone handling (Israel TZ), image optimization. |
| Default | General TypeScript/Node.js project. Standard concerns apply. |

---

## Combining with Blue Team

For comprehensive coverage, run both reviews:

T3 `delegate_task` with `target: {providerInstanceId: "cursor", model: "default"}` (Auto). Write one brief file per child; dispatch `Read and follow <absolute brief path>`. Each brief says `Report to <collab path>, not to the lead thread.` Never use a headless CLI, AutoCursor runner, or background Cursor loop. Never select a named Cursor model; `default` is the T3 Auto sentinel.

Put the relevant prompt template, diff/base/head, report path and read-only constraints in the brief. The lead routes review; workers do not start their own reviewers.

Merge findings, deduplicate, prioritize H > M > L.
