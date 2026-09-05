# Secrets Audit Workflow

Scan for hardcoded secrets, API keys, and sensitive data.

## Quick Start

Run the secrets script directly:

```bash
./scripts/secrets.sh
```

This outputs a Markdown report with secret detection results and remediation steps.

## When to Use

- Before any commit
- Before making repo public
- Security audits
- After adding third-party integrations

## Steps

### Step 1: Run secrets scan

**Using the script (recommended):**
```bash
./scripts/secrets.sh
```

**Manual alternative:**
```bash
cr review --prompt-only | grep -iE "secret|api.?key|token|password|credential|private.?key|auth|bearer|jwt"
```

### Step 2: Manual pattern check

Also grep the codebase directly:

```bash
# API keys
grep -rn "sk-\|pk_\|api_key\|apikey\|API_KEY" --include="*.ts" --include="*.tsx" --include="*.js" .

# Passwords
grep -rn "password\s*=\s*[\"']" --include="*.ts" --include="*.tsx" --include="*.js" .

# Private keys
grep -rn "BEGIN.*PRIVATE KEY" .

# Common env vars hardcoded
grep -rn "process\.env\." --include="*.ts" | grep -v "\.env"
```

### Step 3: Check for common patterns

| Pattern | Risk Level | Example |
|---------|------------|---------|
| `sk-ant-*` | CRITICAL | Anthropic API key |
| `sk-*` (32+ chars) | CRITICAL | OpenAI API key |
| `ghp_*` | CRITICAL | GitHub PAT |
| `xoxb-*` | CRITICAL | Slack bot token |
| `pk_live_*` | CRITICAL | Stripe live key |
| `password = "..."` | HIGH | Hardcoded password |
| `Bearer ...` | HIGH | Hardcoded auth token |

### Step 4: Proper secret handling

**Bad:**
```ts
const apiKey = "sk-ant-abc123...";
```

**Good:**
```ts
const apiKey = process.env.ANTHROPIC_API_KEY;
```

**Best (1Password):**
```bash
# .env.template
ANTHROPIC_API_KEY=op://Private/anthropic/API_KEY/password

# Run with
op run --env-file=.env.template -- npm run dev
```

### Step 5: If secrets found

1. **Rotate immediately** - Consider the key compromised
2. Remove from code
3. Add to `.env` or 1Password
4. Update `.gitignore` if needed
5. Check git history: `git log -p --all -S "the-secret"`

## Pre-commit Integration

Add to pre-commit hook to catch before commit:
```bash
./scripts/secrets.sh | grep -q "🚨" && echo "BLOCKED: Potential secret detected" && exit 1
```
