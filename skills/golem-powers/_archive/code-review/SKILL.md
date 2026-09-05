---
name: code-review
description: "Full code review lifecycle: requesting reviews (CodeRabbit, Greptile, Bugbot, GitHub PR comments) and receiving feedback (classify issues, implement fixes, push back on wrong suggestions). Use when: creating a PR review, reading review comments, handling reviewer feedback, fixing review items, or deciding whether to accept or reject a suggestion. NOT for: running tests directly or CI/CD pipeline issues (use relevant repo tools)."
---

# Code Review (Request + Receive)

> Technical evaluation, not emotional performance. Verify before implementing. Push back when wrong.

## Requesting Review

### When to Request

**Mandatory:** After completing a feature, before merge to main, after each task in multi-step work.
**Optional:** When stuck (fresh perspective), before refactoring, after fixing complex bug.

### How to Request

```bash
# 1. Get git SHAs
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)

# 2. Use CodeRabbit CLI
cr review --plain

# 3. Or use coderabbit:code-reviewer subagent
Agent(subagent_type="coderabbit:code-reviewer", prompt="Review PR #N")

# 4. Or use Greptile plugin
# list_merge_request_comments, trigger_code_review
```

---

## Receiving Review

### The Response Pattern

```
1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

### Forbidden Responses

**NEVER say:** "You're absolutely right!", "Great point!", "Thanks for catching that!"
**INSTEAD:** Restate the technical requirement, ask clarifying questions, or just fix it silently.

### Classify Each Comment

| Type | Action |
|------|--------|
| **Real bug / Security** | FIX immediately |
| **Important improvement** | Fix before proceeding |
| **Style preference** | Fix if genuinely better, skip if bikeshed |
| **Over-engineering** | SKIP with reasoning |
| **False positive** | SKIP with reasoning |

### Implementation Order (multi-item feedback)

1. **Clarify anything unclear FIRST** — don't implement partial understanding
2. Blocking issues (breaks, security)
3. Simple fixes (typos, imports)
4. Complex fixes (refactoring, logic)
5. Test each fix individually, verify no regressions

Max 3 review-fix rounds — skip persistent nitpicks after that.

### When to Push Back

Push back when:
- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Conflicts with user's architectural decisions

**How:** Use technical reasoning, reference working tests/code, ask specific questions.

**If you were wrong:** "Checked [X] and you're correct. Fixing." State it factually, move on.

### Source-Specific Handling

**From human partner:** Trusted — implement after understanding. Still ask if scope unclear.
**From external reviewers:** Verify against codebase first. Check: technically correct? Breaks things? Works on all platforms? Full context?
**From bots (CodeRabbit, Greptile, Bugbot):** High signal but not infallible. Verify critical findings.

### YAGNI Check

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage
  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Then implement properly
```

### GitHub Thread Replies

Reply in the comment thread, not as top-level PR comment:
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies -f body="Fixed in <commit>"
```

---

## Review Profiles

### Red Team (Adversarial)
Use for security-sensitive changes, auth code, input handling, data mutations.
See [workflows/red-team.md](workflows/red-team.md) and [references/red-team-prompt.md](references/red-team-prompt.md).

### Blue Team (Quality)
Use for architecture changes, new features, refactors, UI work.
See [workflows/blue-team.md](workflows/blue-team.md) and [references/blue-team-prompt.md](references/blue-team-prompt.md).

### Combined (recommended for PRs)
Run both: 1 red + 1 blue = comprehensive coverage. Red team catches what will break. Blue team catches what will rot. Deduplicate findings across both reports — red H findings take priority over blue suggestions on the same code.
