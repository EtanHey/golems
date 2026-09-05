# PR-Ready Workflow

Comprehensive pre-PR check. Run before creating a pull request.

## Quick Start

Run the PR-ready script directly:

```bash
./scripts/pr-ready.sh
```

This outputs a comprehensive Markdown report with all checks and a PR checklist.

## Steps

### Step 1: Full review against target branch

**Using the script (recommended):**
```bash
./scripts/pr-ready.sh
```

**Manual alternative:**
```bash
cr review --plain --base main
```

### Step 2: Check all categories

The script automatically runs focused checks for:
- Security issues
- Hardcoded secrets
- Accessibility problems

**Manual alternatives:**
```bash
# Security
./scripts/security.sh

# Secrets
./scripts/secrets.sh

# Accessibility
./scripts/accessibility.sh

# Performance (manual)
cr review --prompt-only | grep -iE "performance|slow|memory|leak|cache"

# Code quality (manual)
cr review --prompt-only | grep -iE "unused|dead|duplicate|complex"
```

### Step 3: Checklist

Before creating PR:

- [ ] CodeRabbit review passes (no CRITICAL/HIGH)
- [ ] Security issues addressed
- [ ] Accessibility checked (if UI changes)
- [ ] No hardcoded secrets
- [ ] Tests pass
- [ ] Types check

### Step 4: Create PR

If all checks pass:
```bash
gh pr create --title "feat: description" --body "..."
```

## Related Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/review.sh` | Standard review |
| `./scripts/security.sh` | Security-focused |
| `./scripts/secrets.sh` | Secret detection |
| `./scripts/accessibility.sh` | A11y audit |
