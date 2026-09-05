# Verify Workflow (Ralph Integration)

Fast verification for Ralph V-* stories. Runs BEFORE Claude to catch obvious issues cheaply.

## Purpose

- Reduce Claude API costs
- Catch bugs before full verification
- Fast feedback loop (seconds, not minutes)

## Quick Start

For quick verification, use the review script:

```bash
./scripts/review.sh
```

Or for minimal output (Ralph integration):

```bash
cr review --prompt-only --type committed
```

## Steps

### Step 1: Run quick verification

```bash
cr review --prompt-only --type committed
```

This outputs minimal, token-efficient results.

### Step 2: Parse results

Check for:
- **CRITICAL** or **HIGH** severity → FAIL, fix required
- **MEDIUM** severity → Review, may need fix
- **LOW** or clean → PASS, proceed to Claude verification

### Step 3: Decision

**If issues found:**
```
CodeRabbit found issues:
- [CRITICAL] SQL injection in user input handler
- [MEDIUM] Unused variable 'temp'

Fix these before Claude verification.
```

**If clean:**
```
CodeRabbit pre-check passed. Proceeding to full verification.
```

## For Ralph V-* Stories

Add to acceptance criteria:
```json
{"text": "CodeRabbit pre-check passes (cr review --prompt-only)", "checked": false}
```

## Output Format for Agents

When using `--prompt-only`, output is structured for AI parsing:
- One issue per line
- Severity prefix
- File:line reference
- Brief description

Example:
```
[HIGH] src/auth.ts:45 - Potential SQL injection
[MEDIUM] src/utils.ts:12 - Unused import
[LOW] src/index.ts:3 - Consider using const
```

## Related Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/review.sh` | Full review with Markdown output |
| `./scripts/security.sh` | Security-focused scan |
| `./scripts/pr-ready.sh` | Comprehensive PR check |
