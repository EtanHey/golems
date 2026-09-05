# Migrate MCP Config Workflow

Imperative instructions for migrating API keys from MCP configs to 1Password.

---

## Quick Scan (Script)

Scan MCP configs for hardcoded secrets:

Run:
```bash
bash ~/.claude/skills/1password/scripts/scan-mcp-secrets.sh
```

Reviews all `.mcp.json` files in common locations.

---

## MCP Config Locations

MCP configs are typically at:
- `~/.config/*/mcp.json`
- `~/.claude/mcp_settings.json`
- Project-level `.mcp.json`
- `~/Library/Application Support/*/mcp.json`

---

## Identify Hardcoded Secrets

### Step 1: Find MCP configs

Run:
```bash
find ~ -name "*.mcp.json" -o -name "mcp.json" -o -name "mcp_settings.json" 2>/dev/null | head -20
```

### Step 2: Check for API keys

Run:
```bash
for f in $(find ~/.config -name "*.json" 2>/dev/null | head -20); do
  if grep -qE "(api[_-]?key|token|secret|password)" "$f" 2>/dev/null; then
    echo "=== $f ==="
    grep -E "(api[_-]?key|token|secret|password)" "$f"
  fi
done
```

### Step 3: Identify services

Common MCP services with API keys:
- Figma: `FIGMA_PERSONAL_ACCESS_TOKEN`
- Linear: `LINEAR_API_KEY`
- Supabase: `SUPABASE_ACCESS_TOKEN`
- Context7: Usually token-based
- Browser-tools: No credentials needed

---

## Migrate to 1Password

### Step 1: For each hardcoded key, create item

Run:
```bash
op item create --category "Password" \
  --title "_global/{service}/API_KEY" \
  --vault "Private" \
  "password={actual-value}"
```

Example:
```bash
# Figma token
op item create --category "Password" \
  --title "_global/figma/PERSONAL_ACCESS_TOKEN" \
  --vault "Private" \
  "password=figd_..."
```

### Step 2: Get op:// reference

Run:
```bash
echo "op://Private/_global/figma/PERSONAL_ACCESS_TOKEN/password"
```

### Step 3: Update MCP config

Replace hardcoded value with op:// reference.

Before:
```json
{
  "figma": {
    "token": "figd_abc123..."
  }
}
```

After:
```json
{
  "figma": {
    "token": "op://Private/_global/figma/PERSONAL_ACCESS_TOKEN/password"
  }
}
```

---

## Using op:// in MCP Configs

### Option 1: Run Claude with op run

Run:
```bash
op run -- claude
```

All `op://` references in env vars are resolved.

### Option 2: Shell wrapper

Add to .zshrc:
```bash
claude() {
  op run -- /usr/local/bin/claude "$@"
}
```

### Option 3: Environment injection

For MCPs that read env vars:
```bash
export FIGMA_PERSONAL_ACCESS_TOKEN="$(op item get '_global/figma/PERSONAL_ACCESS_TOKEN' --vault 'Private' --fields password)"
```

---

## Common MCP Services

### Figma MCP

Key: `FIGMA_PERSONAL_ACCESS_TOKEN`

Create:
```bash
op item create --category "Password" \
  --title "_global/figma/PERSONAL_ACCESS_TOKEN" \
  --vault "Private" \
  "password={token}"
```

### Linear MCP

Key: `LINEAR_API_KEY`

Create:
```bash
op item create --category "Password" \
  --title "_global/linear/API_KEY" \
  --vault "Private" \
  "password={token}"
```

### Supabase MCP

Keys: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

Create:
```bash
op item create --category "Password" \
  --title "_global/supabase/URL" \
  --vault "Private" \
  "password={url}"

op item create --category "Password" \
  --title "_global/supabase/ANON_KEY" \
  --vault "Private" \
  "password={key}"
```

---

## Verify Migration

### Step 1: List created items

Run:
```bash
op item list --vault "Private" | grep "^_global/"
```

### Step 2: Test resolution

Run:
```bash
op inject -i <(echo 'TEST=op://Private/_global/figma/PERSONAL_ACCESS_TOKEN/password') | head -1
```

Verify: Shows actual token value.

### Step 3: Test MCP startup

Run:
```bash
op run -- claude --help
```

Verify: No errors about missing credentials.

---

## Troubleshooting

**op:// not resolved?**
- MCP might not support op:// directly
- Use environment variable injection instead
- Or use op run to wrap the command

**"item not found" error?**
- Check item title matches exactly
- Vault name is case-sensitive
- Use `op item list | grep "term"`

**MCP still using old key?**
- Clear MCP cache if applicable
- Restart Claude/application
- Check config wasn't overwritten

**Biometric timeout during MCP startup?**
- See [troubleshoot.md](troubleshoot.md#biometric-timeout)
- Consider using `op signin --raw` for service tokens
