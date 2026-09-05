---
name: review-router
description: "Dynamic code review routing with automatic fallback chain when primary reviewer is unavailable. Routes to CodeRabbit, Macroscope, requesting-code-review, or Cursor CLI. Triggers on: 'review-router', 'route review', 'reviewer unavailable'. NOT for: general code review workflow (use /code-review), receiving review feedback (use /superpowers:receiving-code-review)."
---

# Review Router

**Routes reviews to available tools with automatic fallback.** The overnight sprint had
CodeRabbit rate-limited and Greptile expired on 4/5 golems PRs. Workers fell back randomly.
This skill defines the deterministic fallback chain.

Note: Greptile was evaluated but excluded — expired tokens are not auto-recoverable overnight.

## Fallback Chain (in order)

1. **CodeRabbit** (`coderabbit:code-reviewer` subagent or `cr review --plain`)
   - Check: `cr --version` succeeds AND no rate limit in last 5 min
   - Timeout: 120 seconds
   - On failure: log "CodeRabbit unavailable: {reason}", fall through

2. **Macroscope** (GitHub App — posts as PR comment)
   - Check: `gh api repos/{owner}/{repo}/installations` includes Macroscope
   - Timeout: 300 seconds (it's slow)
   - On failure: log "Macroscope unavailable", fall through

3. **superpowers:requesting-code-review** (Claude subagent)
   - Check: always available (it's a subagent)
   - Cost: ~50K tokens per review
   - On failure: should not fail, but if it does, fall through

4. **Cursor CLI — Red/Blue Profiles** (external tool — read-only audit mode)
   - Check: `cursor --version` succeeds
   - `<cursor-max-mode-model>` below: substitute Cursor's current Max Mode model ID (verify via `cursor agent --help` or the Cursor changelog — IDs change between versions; the user's preference is Cursor on Auto, but Red/Blue audits historically pin to Max Mode for harsher critique).
   - **Red Team** (security/reliability): `cursor agent --output-format text --model "<cursor-max-mode-model>" "$(cat ~/.claude/commands/code-review/references/red-team-prompt.md | sed 's/{{REPO_CONTEXT}}/...context.../')  DIFF: $(gh pr diff)"`
   - **Blue Team** (quality/architecture): `cursor agent --output-format text --model "<cursor-max-mode-model>" "$(cat ~/.claude/commands/code-review/references/blue-team-prompt.md | sed 's/{{REPO_CONTEXT}}/...context.../')  DIFF: $(gh pr diff)"`
   - Timeout: 180 seconds per profile
   - Run BOTH for comprehensive coverage (replaces single generic prompt)
   - On failure: WARN — all reviewers exhausted, post to collab and wait
   - See `/code-review` workflows: `workflows/red-team.md` and `workflows/blue-team.md`

## All Reviewers Exhausted

If all 4 tiers fail:
1. Log each failure reason
2. Post a BLOCKED message in the collab file
3. Do NOT merge without review — wait for human or tool recovery

## Minimum Review Requirement

**2 independent reviews before merge.** Preferred: 1 red team + 1 blue team.
If only 1 reviewer tool is available, run it with both profiles:
- Pass 1: Red team prompt (security, reliability, crash scenarios)
- Pass 2: Blue team prompt (architecture, quality, test coverage)

Deduplicate findings: red H findings take priority over blue suggestions on the same code.

## H/M/L Classification (from overnight retro)

After collecting review findings, classify each:
- **HIGH/CRITICAL** → Fix immediately, block merge
- **MEDIUM** → Fix before merge if <15 min effort, else document as follow-up
- **LOW** → Merge, create follow-up issue if warranted

## Usage

```
# In /pr-loop, after PR creation:
/review-router

# Standalone:
/review-router --pr 42 --repo golems
```
