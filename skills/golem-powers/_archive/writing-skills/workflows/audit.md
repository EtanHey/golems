---
name: audit
description: Audit skill structure
---

# Audit Skill Structure

Checklist for verifying a golem-powers skill is correctly structured.

## Required Checks

### 1. Directory Structure

```bash
# Check skill exists
SKILL_PATH="~/.claude/commands/golem-powers/YOUR_SKILL_NAME"
ls -la $SKILL_PATH
```

Expected files:
- [ ] `SKILL.md` exists
- [ ] `scripts/` directory exists
- [ ] At least one script in `scripts/`

### 2. SKILL.md Frontmatter

```bash
head -20 $SKILL_PATH/SKILL.md
```

Check for:
- [ ] YAML frontmatter delimiters (`---`)
- [ ] `name:` field (matches directory name)
- [ ] `description:` field (explains when to use)
- [ ] `execute:` field (path to script) - unless meta-skill

### 3. Script Executability

```bash
ls -la $SKILL_PATH/scripts/
```

Check:
- [ ] Scripts have execute permission (`-rwxr-xr-x`)
- [ ] No Windows line endings (check with `file scripts/*.sh`)

### 4. Script Headers

```bash
head -5 $SKILL_PATH/scripts/*.sh
```

Required:
- [ ] Shebang line: `#!/usr/bin/env bash`
- [ ] Safety flags: `set -euo pipefail`

### 5. Shellcheck

```bash
shellcheck $SKILL_PATH/scripts/*.sh
```

Must pass with no errors.

### 6. Execution Test

```bash
# For bash skills
bash $SKILL_PATH/scripts/default.sh

# For TypeScript skills
bash $SKILL_PATH/scripts/run.sh --action=default
```

Check:
- [ ] Script runs without errors
- [ ] Output is valid Markdown
- [ ] Exit code is 0 on success

---

## TypeScript-Specific Checks

If the skill uses TypeScript/Bun:

### 7. TypeScript Files

- [ ] `src/index.ts` exists
- [ ] `package.json` exists
- [ ] `scripts/run.sh` wraps Bun execution

### 8. Bun Execution

```bash
cd $SKILL_PATH
bun run src/index.ts --action=default
```

- [ ] Runs without TypeScript errors
- [ ] Handles unknown actions gracefully

---

## Optional Checks

### 9. Workflows

If skill has workflows:
- [ ] `workflows/` directory exists
- [ ] Each workflow has YAML frontmatter
- [ ] Workflows are referenced in SKILL.md

### 10. CLAUDE.md

If skill needs environment setup:
- [ ] `CLAUDE.md` explains requirements
- [ ] Dependencies are documented
- [ ] Setup instructions are clear

---

## Quick Audit Script

Run this to check all golem-powers skills:

```bash
for skill in ~/.claude/commands/golem-powers/*/; do
  name=$(basename "$skill")
  echo "## Checking: $name"

  # Check SKILL.md
  if [[ -f "$skill/SKILL.md" ]]; then
    echo "- SKILL.md: OK"
  else
    echo "- SKILL.md: MISSING"
  fi

  # Check execute frontmatter
  if grep -q "^execute:" "$skill/SKILL.md" 2>/dev/null; then
    echo "- execute: OK"
  else
    echo "- execute: MISSING (meta-skill?)"
  fi

  # Check scripts
  if [[ -d "$skill/scripts" ]]; then
    shopt -s nullglob
    script_files=("$skill/scripts/"*.sh)
    script_count=${#script_files[@]}
    shopt -u nullglob
    echo "- scripts: $script_count files"
  else
    echo "- scripts: MISSING"
  fi

  # Shellcheck
  if [[ -d "$skill/scripts" ]]; then
    shopt -s nullglob
    script_files=("$skill/scripts/"*.sh)
    shopt -u nullglob
  else
    script_files=()
  fi
  if [[ ${#script_files[@]} -gt 0 ]] && shellcheck "${script_files[@]}" 2>/dev/null; then
    echo "- shellcheck: PASS"
  else
    echo "- shellcheck: FAIL or no scripts"
  fi

  echo ""
done
```

---

## Common Issues

| Issue | Solution |
|-------|----------|
| `permission denied` | Run `chmod +x scripts/*.sh` |
| `bad interpreter` | Check for Windows line endings (`dos2unix`) |
| `bun: command not found` | Install Bun: `brew install oven-sh/bun/bun` |
| Shellcheck warnings | Fix the specific issues reported |
| No `execute:` field | Add to SKILL.md frontmatter |
