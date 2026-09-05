# PR Review Workflow

> Check comments BEFORE merging. Every time. No exceptions.

## After Pushing a PR

1. **Wait 2-3 min** for Cursor Bugbot / CodeRabbit to post
2. **Check comments**: `/pr-comments` skill or `gh api repos/{owner}/{repo}/pulls/{n}/comments`
3. **Triage by severity**:
   - HIGH → real bug, fix immediately
   - LOW → style preference, fix only if genuinely better
   - Over-engineering → skip
4. **Fix, commit, push** — then merge

## After Force Push (rebase/linearize)

- Bots re-run on the new diff — re-check comments
- Previous comments may become outdated — verify against new code

## Commands

```bash
# Fetch PR comments
gh api repos/EtanHey/golems/pulls/77/comments --jq '.[].body'

# Quick check if comments exist
gh api repos/EtanHey/golems/pulls/77/comments --jq 'length'
```

## Anti-Patterns

- Merging without checking comments (almost shipped haiku double-counting bug)
- Using `gh pr merge` as first action after push
- Ignoring HIGH severity because "tests pass" — bots catch logic bugs tests don't cover
