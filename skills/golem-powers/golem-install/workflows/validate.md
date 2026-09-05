# Validate Installation Workflow

Verify the full golems installation works end-to-end.

---

## Quick Validation

Run this comprehensive check:

```bash
#!/bin/bash
echo "Validating golems installation..."
echo ""

PASS=0
FAIL=0
WARN=0

check() {
  if eval "$2" &>/dev/null; then
    echo "[PASS] $1"
    ((PASS++))
  else
    echo "[FAIL] $1"
    ((FAIL++))
  fi
}

check_warn() {
  if eval "$2" &>/dev/null; then
    echo "[PASS] $1"
    ((PASS++))
  else
    echo "[WARN] $1 (optional)"
    ((WARN++))
  fi
}

# Core Dependencies
echo "=== Core Dependencies ==="
check "gh installed" "command -v gh"
check "op installed" "command -v op"
check "gum installed" "command -v gum"
check "fswatch installed" "command -v fswatch"
check "jq installed" "command -v jq"
check "git installed" "command -v git"
echo ""

# TypeScript Skills Dependencies
echo "=== TypeScript Skills Dependencies ==="
check "bun installed" "command -v bun"
check_warn "cr (CodeRabbit) installed" "command -v cr"
echo ""

# Codex -s is a compatibility no-op; these defaults are required fleet-wide.
echo "=== Codex Safety Defaults ==="
check "Codex approval_policy is never" "awk '/^[[:space:]]*\\[/{exit} /^[[:space:]]*approval_policy[[:space:]]*=[[:space:]]*\"never\"[[:space:]]*$/ {found=1} END{exit !found}' ~/.codex/config.toml"
check "Codex sandbox_mode is danger-full-access" "awk '/^[[:space:]]*\\[/{exit} /^[[:space:]]*sandbox_mode[[:space:]]*=[[:space:]]*\"danger-full-access\"[[:space:]]*$/ {found=1} END{exit !found}' ~/.codex/config.toml"
echo ""

# 1Password
echo "=== 1Password ==="
check "op signed in" "op account list"
check_warn "GitHub token exists" "op read 'op://Private/github-token/credential'"
echo ""

# Golem-Powers API Keys (golems item)
echo "=== Golem-Powers API Keys ==="
check_warn "Context7 API key" "op read 'op://Private/golems/context7/API_KEY'"
check_warn "Linear API key" "op read 'op://Private/golems/linear/API_KEY'"
echo ""

# Directories
echo "=== Directories ==="
check "~/.config/golems exists" "test -d ~/.config/golems"
check "~/.claude/skills exists" "test -d ~/.claude/skills"
echo ""

# Individual Skill Symlinks in ~/.claude/skills/
echo "=== Skill Symlinks ==="
check "1password skill symlink" "test -L ~/.claude/skills/1password"
check "pr-loop skill symlink" "test -L ~/.claude/skills/pr-loop"
check "golem-install skill symlink" "test -L ~/.claude/skills/golem-install"
echo ""

# Summary
echo "=== Summary ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Warnings: $WARN"

if [ $FAIL -eq 0 ]; then
  echo ""
  echo "Installation validated successfully!"
  if [ $WARN -gt 0 ]; then
    echo "(Some optional components are missing - see warnings above)"
  fi
else
  echo ""
  echo "Some checks failed. Review and fix issues above."
fi
```

---

## Individual Validations

### 1. Test Core CLIs

```bash
gh --version
op --version
gum --version
fswatch --version
jq --version
git --version
```

### 2. Test Bun (TypeScript Runtime)

```bash
bun --version
```

Expected: Version number (e.g., 1.0.0).

### 3. Test CodeRabbit CLI (Optional)

```bash
cr --version
```

Expected: Version number.

### 4. Test 1Password Access

```bash
op account list
op vault list
```

Expected: Shows account and vaults.

### 5. Test Golem-Powers API Keys

```bash
# Context7 API Key
op read "op://Private/golems/context7/API_KEY"

# Linear API Key
op read "op://Private/golems/linear/API_KEY"
```

Expected: Returns the API key value (starts with ctx7sk_ for Context7, lin_api_ for Linear).

### 6. Test Skill Symlinks

```bash
# Check individual skill symlinks exist
ls -la ~/.claude/skills/ | grep "^l"

# Test a skill file is readable
cat ~/.claude/skills/pr-loop/SKILL.md | head -5
```

Expected: Shows individual skill symlinks in ~/.claude/skills/, each pointing to golems/skills/golem-powers/.

### 7. Test Interactive Tools

```bash
# Quick gum test
echo "test" | gum filter

# Should show interactive filter
```

---

## Test Ralph (if installed)

```bash
# Source ralph
source ~/.config/golems/ralph.zsh

# Check ralph is available
type ralph

# Show help
ralph --help
```

---

## Common Issues

### "Not signed in" for op

```bash
op signin
```

### API key not found

Check the golems item exists:
```bash
op item get "golems" --vault "Private"
```

If missing, create it:
```bash
op item create --category "API Credential" --vault "Private" --title "golems"
```

### Symlink points to wrong location

```bash
# Check where a skill symlink points
readlink -f ~/.claude/skills/pr-loop

# Re-run the setup-symlinks workflow to fix all symlinks
```

### Skills not loading in Claude

1. Restart Claude Code
2. Check skill format (needs frontmatter with name/description)
3. Verify file permissions

---

## Post-Validation

Once all checks pass:

1. **Restart Claude Code** to load skills
2. **Test a skill**: Type `/pr-loop` or `/1password` in Claude
3. **Ready to use**: All skills available as individual commands

---

## Success Criteria

All these should be true:
- [ ] All 8 CLIs installed (gh, op, gum, fswatch, jq, git, bun, cr)
- [ ] 1Password signed in with vault access
- [ ] Context7 and Linear API keys stored in golems item
- [ ] ~/.config/golems/ exists
- [ ] Individual skill symlinks created in ~/.claude/skills/
- [ ] Skill commands work in Claude Code (e.g., `/pr-loop`, `/1password`)
