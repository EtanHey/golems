# Check Dependencies Workflow

Verify all required CLIs are installed and accessible.

---

## Required Dependencies

Run this script to check all dependencies:

```bash
#!/bin/bash
echo "Checking golems dependencies..."
echo ""

MISSING=()

# Check each required CLI (core)
for cmd in gh op gum fswatch jq git; do
  if command -v $cmd &>/dev/null; then
    VERSION=$($cmd --version 2>&1 | head -1)
    echo "[OK] $cmd: $VERSION"
  else
    echo "[MISSING] $cmd"
    MISSING+=($cmd)
  fi
done

# Check Bun (for TypeScript skills)
if command -v bun &>/dev/null; then
  VERSION=$(bun --version 2>&1 | head -1)
  echo "[OK] bun: $VERSION"
else
  echo "[MISSING] bun (required for TypeScript skills)"
  MISSING+=(bun)
fi

# Check CodeRabbit CLI (for code review skill)
if command -v cr &>/dev/null; then
  VERSION=$(cr --version 2>&1 | head -1)
  echo "[OK] cr: $VERSION"
else
  echo "[MISSING] cr (CodeRabbit CLI, optional for code review)"
  MISSING+=(cr)
fi

echo ""

# Summary
if [ ${#MISSING[@]} -eq 0 ]; then
  echo "All dependencies installed!"
else
  echo "Missing dependencies: ${MISSING[*]}"
  echo ""
  echo "Run the install-deps workflow to install missing tools."
fi
```

---

## Individual Checks

### GitHub CLI (gh)

```bash
gh --version
gh auth status
```

Expected: Version number and authenticated user.

If not authenticated:
```bash
gh auth login
```

### 1Password CLI (op)

```bash
op --version
op account list
```

Expected: Version number and at least one account configured.

If no accounts:
```bash
op signin
```

### Gum (Interactive Prompts)

```bash
gum --version
```

Expected: Version number (e.g., v0.13.0).

### fswatch (File Watching)

```bash
fswatch --version
```

Expected: Version number.

### jq (JSON Processing)

```bash
jq --version
```

Expected: Version number (e.g., jq-1.7).

### Git

```bash
git --version
```

Expected: Version number (e.g., git version 2.43.0).

### Bun (TypeScript Runtime)

```bash
bun --version
```

Expected: Version number (e.g., 1.0.0).

Required for TypeScript-based golem-powers skills.

If not installed:
```bash
brew install oven-sh/bun/bun
```

### CodeRabbit CLI (cr)

```bash
cr --version
```

Expected: Version number.

Optional but recommended for `/coderabbit` skill.

If not installed:
```bash
curl -fsSL https://coderabbit.ai/install.sh | bash
```

---

## Quick Check Script

Copy and run this one-liner:

```bash
for cmd in gh op gum fswatch jq git bun cr; do command -v $cmd &>/dev/null && echo "[OK] $cmd" || echo "[MISSING] $cmd"; done
```

---

## Next Steps

- If any dependencies are missing, proceed to [install-deps](install-deps.md)
- If all dependencies are installed, proceed to [setup-tokens](setup-tokens.md)
