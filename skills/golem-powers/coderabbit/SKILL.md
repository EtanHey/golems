---
name: coderabbit
description: "Review changes and handle CodeRabbit/Greptile/Bugbot/GitHub feedback. Triggers: review, comments, security."
execute: scripts/review.sh
---

# CodeRabbit - AI Code Review

Fast AI code reviews via CodeRabbit CLI. Free for open source.

## Repositories

Works in any git repo. Free tier covers open source repos. For private repos, ensure CodeRabbit is configured in the repo settings.

## Quick Commands

```bash
coderabbit review --agent   # Codex/AI-agent local review output
cr review --plain           # Human-readable review
cr review --prompt-only     # Minimal-token prompt output for specific workflows
cr review --type uncommitted # Only unstaged changes
cr review --base main       # Compare against main branch
```

## Local Review Gate (Codex)

In Codex environments, use `coderabbit review --agent` (not `--plain`) for the local review gate.

Bound the local CLI wait: hard timeout at about 3 minutes. If the CLI hangs while writing comments, hits a rate limit, or reports review-limit exhaustion mid-loop, kill/stop it, record the limitation, and proceed through commit/push on fresh local test evidence. Do not block the PR loop indefinitely on a local CLI hang. After the PR exists, request `@coderabbitai review` and read the resulting bot status/comments before merge.

## Workflows

| Workflow | Use Case |
|----------|----------|
| [review](workflows/review.md) | Standard code review |
| [verify](workflows/verify.md) | Quick verification for Ralph V-* stories |
| [security](workflows/security.md) | Security-focused review |
| [accessibility](workflows/accessibility.md) | A11y audit for UI changes |
| [secrets](workflows/secrets.md) | Scan for hardcoded secrets/keys |
| [pr-ready](workflows/pr-ready.md) | Pre-PR comprehensive check |
| [red-team](workflows/red-team.md) | Adversarial security/reliability review profile |
| [blue-team](workflows/blue-team.md) | Architecture/quality/maintainability review profile |

## Output Modes

| Flag | Best For | Token Usage |
|------|----------|-------------|
| `--agent` | Codex/AI agents running a local gate | Medium |
| `--plain` | Humans reading in terminal | High |
| `--prompt-only` | AI agents (Ralph, Claude) | Low |
| (default) | Interactive TUI | N/A |

## Integration with Ralph

For V-* verification stories, CodeRabbit runs FIRST as a fast pre-check:

1. `cr review --prompt-only --type committed` - Quick scan
2. If issues found → Fix before Claude verification
3. If clean → Proceed to full Claude verification

This reduces Claude API costs and catches obvious issues fast.

## Receiving Review Feedback

Technical evaluation, not emotional performance. Verify before implementing.
Push back when a suggestion is wrong for this codebase.

Response pattern:

1. Read the complete feedback before reacting.
2. Understand the requested change; restate it or ask if unclear.
3. Verify the finding against codebase reality.
4. Evaluate whether it is technically sound for this stack and user decision.
5. Respond with a technical acknowledgment or reasoned pushback.
6. Implement one item at a time and test each fix.

Forbidden responses:

- "You're absolutely right!"
- "Great point!"
- "Thanks for catching that!"

Instead, state the technical requirement, ask a clarifying question, or fix it
silently.

| Comment type | Action |
|---|---|
| Real bug / Security | Fix immediately |
| Important improvement | Fix before proceeding |
| Style preference | Fix if genuinely better; skip if bikeshed |
| Over-engineering | Skip with reasoning |
| False positive | Skip with reasoning |

Implementation order for multi-item feedback:

1. Clarify anything unclear first.
2. Fix blocking breakage or security issues.
3. Apply simple fixes.
4. Apply complex refactors or logic changes.
5. Test each fix individually and verify no regressions.

Max 3 review-fix rounds for nitpicks. Push back when the suggestion breaks
existing behavior, lacks context, violates YAGNI, conflicts with user-stated
architecture, or is technically incorrect. If you were wrong, say
"Checked X and you're correct. Fixing." Then fix it.

## Evaluator Agent (Weighted Quality Gate)

For high-stakes changes, pair CodeRabbit with the **evaluator agent** (`claude --agent evaluator`) for deeper qualitative scoring:

1. CodeRabbit catches structural issues (bugs, security, style)
2. Evaluator scores on 4 weighted criteria: Functionality (20%), Craft (20%), Design (30%), Originality (30%)
3. Score >= 7.0 required to proceed to merge

The evaluator is deliberately adversarial -- it compensates for LLM optimism bias in code review. See `$ORCHESTRATOR_REPO/standards/evaluator-grading.md` for the full grading rubric.

**When to add the evaluator gate:**
- Architecture changes or new module introductions
- Agent-generated code (autonomous work products)
- Changes touching >5 files or crossing module boundaries

## Configuration

Optional `.coderabbit.yaml` in repo root for custom rules:

```yaml
reviews:
  language: en
  path_filters:
    - "!**/*.test.ts"
    - "!**/node_modules/**"
```

## Disposition gate — no silent skip, every CRITICAL dispositioned (gen-18 Track 6 D5)

Two false-green failure modes the review flow must never hit:

1. **Silent-skip** — when the CodeRabbit CLI is rate-limited / times out / is unavailable,
   do NOT move on as if "no findings". Record `Status: SKIPPED — <reason>` and **fall back
   to the red-team / blue-team prompt review** (`references/red-team-prompt.md`,
   `references/blue-team-prompt.md`). A skip without a reason is a violation.
2. **Undisposed CRITICAL** — every CRITICAL finding must carry an explicit
   `FIXED` / `WAIVED` / `ACCEPTED` disposition **before push**. A CRITICAL with no
   disposition silently ships.

Gate it mechanically with a review-disposition log:

```bash
python3 checks/disposition_lint_cli.py review-disposition-log.md   # exit 1 on any gap
python3 -m pytest checks/tests/                                     # RED→GREEN gate (8 cases)
```

A disposition log is a `Status:` line plus one line per finding
(`- CRITICAL: <desc> — FIXED (rationale)`). The RED fixture (a bare `SKIPPED` + an
undisposed CRITICAL) trips both rules; the GREEN fixture is clean. See
`checks/disposition_lint.py`.

## Requirements

- CodeRabbit CLI installed: `curl -fsSL https://cli.coderabbit.ai/install.sh | sh`
- Authenticated: `cr auth login`
- Must run from git repository root
