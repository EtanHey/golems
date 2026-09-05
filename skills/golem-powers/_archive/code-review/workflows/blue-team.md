# Blue Team Review Workflow

Quality review focused on architecture, maintainability, testing, and UX.

## Prerequisites

- `cursor` CLI installed and authenticated
- Git repo with changes to review (uncommitted diff or PR)
- Access to `references/blue-team-prompt.md`

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

```bash
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
SKILL_DIR=~/Gits/golems/skills/golem-powers/code-review

# Read the prompt template
PROMPT=$(cat "$SKILL_DIR/references/blue-team-prompt.md")

# Inject repo context (looked up from the map below)
REPO_CTX="<repo context for $REPO_NAME from the map>"
PROMPT="${PROMPT//\{\{REPO_CONTEXT\}\}/$REPO_CTX}"

# Run with Cursor
cursor agent --output-format text --model "gpt-5.2-codex-xhigh" \
  "$PROMPT

## Code to Review

\`\`\`diff
$DIFF
\`\`\`"
```

### 5. Parse Output

The prompt produces category-grouped findings. Triage:

- **Architecture / Types:** Address before merge. Structural issues compound.
- **Testing:** Add tests in same PR if scope allows.
- **Performance:** Fix if the path is hot. Otherwise track.
- **UX:** Fix user-facing issues before merge. Internal tooling can wait.
- **Documentation / DRY:** Quick wins in same PR. Large refactors get their own PR.

### 6. Report

Save structured output:

```bash
# Save to docs.local/audits/ for traceability
cursor agent --output-format text --model "gpt-5.2-codex-xhigh" "$PROMPT ..." \
  > "docs.local/audits/blue-team-$(date +%Y-%m-%d)-$(git rev-parse --short HEAD).md"
```

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

## Combining with Red Team

For comprehensive coverage, run both reviews:

```bash
# Red team (security/reliability)
cursor agent --output-format text --model "gpt-5.2-codex-xhigh" "$RED_PROMPT" > red-findings.md

# Blue team (quality/architecture)
cursor agent --output-format text --model "gpt-5.2-codex-xhigh" "$BLUE_PROMPT" > blue-findings.md
```

Merge findings, deduplicate. Red team H findings override Blue team suggestions on the same code.
