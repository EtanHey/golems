---
name: yash
description: "Push dependency bugs upstream. Triggers: dependency bug, workaround, monkey-patch, fork/fix. NOT app bugs."
---

# /yash — Push Through, Don't Work Around

> "Yash" (יש) = "there is" / "push through" — when there's a bug in a dependency, there IS a fix. Go get it.

## The Rule

**When you encounter a bug in a dependency, your DEFAULT response is to fix it upstream — not work around it.**

The workaround is the easy path. It's also technical debt that compounds:
- Workarounds break on upgrades
- Other users hit the same bug
- The root cause stays unfixed forever
- Your codebase accumulates mystery patches

## Decision Tree

```
Hit a dependency bug
  │
  ├── Is this a known issue with an open PR?
  │     └── YES → Review the PR, test it, comment "+1 tested on [your env]"
  │               Use patch-package to apply the PR's diff locally
  │
  ├── Is this a clear bug with no existing fix?
  │     └── YES → Fork, fix, PR upstream
  │               Use patch-package as a temporary bridge
  │
  ├── Is this a design limitation, not a bug?
  │     └── YES → Open an issue describing the use case
  │               Workaround is acceptable here (document WHY)
  │
  └── Is the project abandoned (no commits in 6+ months)?
        └── YES → Fork permanently, publish under @golems scope
                  OR find an actively maintained alternative
```

## The Yash Protocol

### Step 1: Diagnose — Is This Really a Dependency Bug?

Before blaming the library:
1. Check YOUR usage against the docs (are you using the API correctly?)
2. Check the issue tracker — has someone reported this?
3. Read the relevant source code in `node_modules/` or the repo
4. Reproduce the bug in isolation (minimal repro)

**If it's YOUR bug, fix YOUR code.** Yash only applies to genuine dependency bugs.

### Step 2: Fork and Fix

```bash
# Fork via GitHub
gh repo fork <owner>/<repo> --clone

# Create a fix branch
cd <repo>
git checkout -b fix/<description>

# Fix the bug
# Write a test that fails before your fix and passes after
# Commit with a clear message referencing the issue

# Push and create PR
git push -u origin fix/<description>
gh pr create --title "fix: <description>" --body "Fixes #<issue>

## What
<one-line description of the bug>

## Why
<what breaks for users, with minimal repro>

## How
<what the fix does and why this approach>

## Test
<how to verify the fix>"
```

### Step 3: Bridge with patch-package

While waiting for the PR to merge:

```bash
# Install patch-package if not already present
bun add -D patch-package

# Make your fix directly in node_modules/<package>
# Then create the patch
npx patch-package <package-name>

# This creates patches/<package-name>+<version>.patch
# Commit the patch file
git add patches/
git commit -m "fix: patch <package> for <bug> (upstream PR: <url>)"
```

Add to package.json:
```json
{
  "scripts": {
    "postinstall": "patch-package"
  }
}
```

### Step 4: Track the Upstream PR

```bash
# Store in BrainLayer for tracking
brain_store(
  content: "Upstream PR: <url>. Bug: <description>. Local patch: patches/<name>+<version>.patch. Remove patch when PR merges and package updates.",
  tags: ["yash", "upstream-pr", "<package-name>"],
  importance: 6
)
```

When the upstream PR merges:
1. Update the dependency: `bun update <package>`
2. Remove the patch file
3. Verify the fix works without the patch
4. Commit: `chore: remove <package> patch — upstream fix merged (<PR url>)`

### Step 5: Celebrate

You just made open source better. Every user of that library benefits from your fix.

## When Workarounds ARE Acceptable

Not every dependency issue deserves a PR. Workarounds are fine when:

| Scenario | Why workaround is OK |
|----------|---------------------|
| Design limitation, not a bug | The library works as intended |
| One-line config fix | Not worth a fork for a config issue |
| You need the fix in <1 hour | PR the fix AND apply the workaround |
| Abandoned project | Fork permanently instead |

**Even when you workaround, document it:**
```typescript
// WORKAROUND: <library> doesn't support X (see <issue-url>)
// Remove when <library> v<next> ships with fix
// Upstream issue: <url>
```

## Anti-Patterns (What NOT To Do)

| Anti-Pattern | Why It's Bad | Yash Alternative |
|-------------|-------------|------------------|
| Silence the error | Hides the bug from everyone | Fix the root cause |
| Copy-paste the source file | Diverges on every update | Fork + patch-package |
| "It works on my machine" | Others will hit it | Reproduce + PR |
| Wait for someone else to fix | Could wait forever | Be the someone |
| Downgrade to older version | Misses security fixes | Fix forward |

## Integration with Other Skills

- **`/pr-loop`** — Use for the upstream PR lifecycle (branch → test → PR → review → merge)
- **`/coderabbit`** — Red team your fix before submitting upstream
- **Research tools** — Research the library's contribution guidelines first
- **`/pr-loop` step 5** — Atomic commits: one for the patch-package bridge, one for the upstream PR

## Quick Reference

```bash
# Check if a package has known issues
gh issue list -R <owner>/<repo> --search "<your bug>"

# Fork and clone in one command
gh repo fork <owner>/<repo> --clone --remote

# Create patch from node_modules changes
npx patch-package <package-name>

# Track upstream PR status
gh pr view <PR-url> --json state,reviews,mergedAt
```
