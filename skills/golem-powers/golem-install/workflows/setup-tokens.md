# Setup Tokens Workflow

Configure API tokens in 1Password for use with golems.

---

## Prerequisites

- 1Password CLI installed and signed in (`op account list` shows accounts)
- API tokens obtained from respective services

---

## Required Tokens

| Token | Service | Where to get |
|-------|---------|--------------|
| GitHub PAT | GitHub CLI | github.com/settings/tokens |
| Linear API Key | Linear skill | linear.app/settings/api |
| Anthropic API Key | Claude | console.anthropic.com |
| Context7 API Key | Context7 skill | context7.com/settings |

---

## Golem-Powers Skills API Keys (Recommended)

Store API keys for golem-powers skills in a single `golems` item with sections:

### Create the golems Item

```bash
op item create --category "API Credential" --vault "Private" --title "golems"
```

### Add Context7 API Key

Get key from: https://context7.com/settings

```bash
op item edit "golems" --vault "Private" "context7.API_KEY[concealed]=ctx7sk_your_key_here"
```

**op:// path:** `op://Private/golems/context7/API_KEY`

Verify:
```bash
op read "op://Private/golems/context7/API_KEY"
```

### Add Linear API Key

Get key from: https://linear.app/settings/api

```bash
op item edit "golems" --vault "Private" "linear.API_KEY[concealed]=lin_api_your_key_here"
```

**op:// path:** `op://Private/golems/linear/API_KEY`

Verify:
```bash
op read "op://Private/golems/linear/API_KEY"
```

### Using Skills with 1Password

Skills automatically read from 1Password when available. You can also inject manually:

```bash
# Run a skill command with injected ENV
CONTEXT7_API_KEY=$(op read "op://Private/golems/context7/API_KEY") \
  npx -y @upstash/context7-mcp@4.0.2 --help
```

---

## Store Tokens in 1Password

### Method 1: Interactive (Recommended)

Use the 1Password skill:
```
/1password add-secret
```

Or manually for each token:

### GitHub Token

1. Get token from: https://github.com/settings/tokens
2. Create a "Fine-grained token" with repo access
3. Store in 1Password:

```bash
op item create \
  --category "API Credential" \
  --title "github-token" \
  --vault "Private" \
  "credential=ghp_your_token_here"
```

Verify:
```bash
op read "op://Private/github-token/credential"
```

### Linear API Key

1. Get token from: https://linear.app/settings/api
2. Create a "Personal API key"
3. Store in 1Password:

```bash
op item create \
  --category "API Credential" \
  --title "linear" \
  --vault "Private" \
  "api-key=lin_api_your_key_here"
```

Verify:
```bash
op read "op://Private/linear/api-key"
```

### Anthropic API Key

1. Get token from: https://console.anthropic.com
2. Create an API key
3. Store in 1Password:

```bash
op item create \
  --category "API Credential" \
  --title "anthropic" \
  --vault "Private" \
  "api-key=sk-ant-your_key_here"
```

Verify:
```bash
op read "op://Private/anthropic/api-key"
```

---

## Verify All Tokens

Run this to check all tokens are accessible:

```bash
#!/bin/bash
echo "Checking API tokens in 1Password..."
echo ""

# GitHub
if op read "op://Private/github-token/credential" &>/dev/null; then
  echo "[OK] GitHub token"
else
  echo "[MISSING] GitHub token"
fi

# Linear (legacy path)
if op read "op://Private/linear/api-key" &>/dev/null; then
  echo "[OK] Linear API key (legacy)"
else
  echo "[SKIP] Linear API key (legacy) - check golems instead"
fi

# Anthropic
if op read "op://Private/anthropic/api-key" &>/dev/null; then
  echo "[OK] Anthropic API key"
else
  echo "[MISSING] Anthropic API key"
fi

echo ""
echo "=== Golem-Powers Skills (golems item) ==="

# Context7 API Key
if op read "op://Private/golems/context7/API_KEY" &>/dev/null; then
  echo "[OK] Context7 API key"
else
  echo "[MISSING] Context7 API key"
fi

# Linear API Key (golem-powers)
if op read "op://Private/golems/linear/API_KEY" &>/dev/null; then
  echo "[OK] Linear API key (golem-powers)"
else
  echo "[MISSING] Linear API key (golem-powers)"
fi
```

---

## Create Config Directory

Ensure the golems config directory exists:

```bash
mkdir -p ~/.config/golems
chmod 700 ~/.config/golems
```

---

## Troubleshooting

### "vault not found"

Check vault name:
```bash
op vault list
```

Use correct vault name (case-sensitive).

### "not signed in"

Sign in to 1Password:
```bash
op signin
```

### Token format errors

- GitHub: Starts with `ghp_` or `github_pat_`
- Linear: Starts with `lin_api_`
- Anthropic: Starts with `sk-ant-`
- Context7: Starts with `ctx7sk_`

---

## CodeRabbit CLI Authentication

CodeRabbit uses browser-based authentication (not an API key):

```bash
cr auth login
```

This opens a browser to authenticate. After signing in, paste the token back to your CLI.

**Verify:**
```bash
cr auth status
```

**Note:** Free tier = 1 review/hour, basic analysis. Paid = learnings + contextual analysis.

---

## Next Steps

After storing all tokens:
1. Proceed to [setup-symlinks](setup-symlinks.md) to enable skills
2. Then [validate](validate.md) to test everything
