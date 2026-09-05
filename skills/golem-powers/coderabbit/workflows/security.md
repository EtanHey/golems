# Security Review Workflow

Security-focused code review.

## Quick Start

Run the security script directly:

```bash
./scripts/security.sh
```

This outputs a Markdown report with security findings and checklist.

## When to Use

- Before deploying to production
- After adding auth/payment/sensitive features
- Security audit stories

## Steps

### Step 1: Run security-focused review

**Using the script (recommended):**
```bash
./scripts/security.sh
```

**Manual alternative:**
```bash
cr review --plain | grep -iE 'security|inject|xss|csrf|auth|secret|password|token|credential|vulnerab'
```

### Step 2: Security checklist

Check the output for:

| Category | Look For |
|----------|----------|
| Injection | SQL, NoSQL, command injection |
| XSS | Unsanitized user input in HTML |
| Auth | Weak auth, missing checks |
| Secrets | Hardcoded keys, tokens |
| Data | PII exposure, logging sensitive data |
| CSRF | Missing tokens on mutations |

### Step 3: Severity triage

- **CRITICAL** - Exploitable vulnerability → Block merge
- **HIGH** - Security weakness → Must fix
- **MEDIUM** - Best practice violation → Should fix
- **LOW** - Informational → Nice to fix

## Common Security Issues

```
[CRITICAL] Hardcoded API key in source
[HIGH] SQL query built with string concatenation
[HIGH] User input rendered without sanitization
[MEDIUM] Missing rate limiting on auth endpoint
[LOW] Debug logging includes user email
```

## Related Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/secrets.sh` | Dedicated secret detection |
| `./scripts/pr-ready.sh` | Full comprehensive check |
