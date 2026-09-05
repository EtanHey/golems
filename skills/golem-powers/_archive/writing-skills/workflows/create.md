---
name: create
description: Create Worktree
---

# Create a New Golem-Powers Skill

Step-by-step workflow for creating a new executable skill.

## Prerequisites

- Decide on skill name (lowercase, hyphenated: `my-skill`)
- Decide on execution pattern (bash or typescript)
- Know what the skill should do

---

## Option A: Use the Template Generator (Recommended)

### Step 1: Run the Generator

```bash
bash ~/.claude/commands/golem-powers/writing-skills/scripts/create-skill.sh \
  --name=YOUR_SKILL_NAME \
  --type=bash|typescript
```

### Step 2: Edit SKILL.md

Open `~/.claude/commands/golem-powers/YOUR_SKILL_NAME/SKILL.md`:

1. Update `description:` in frontmatter - this is shown in skill discovery
2. Update the documentation to explain what your skill does
3. Document any requirements or dependencies

### Step 3: Implement the Script

**For Bash skills:**
- Edit `scripts/default.sh`
- Output Markdown to stdout
- Use exit codes (0 = success, non-zero = failure)

**For TypeScript skills:**
- Edit `src/index.ts`
- Implement actions in the switch statement
- Add dependencies to `package.json` if needed
- Run `bun install` after adding dependencies

### Step 4: Test

```bash
# Bash
bash ~/.claude/commands/golem-powers/YOUR_SKILL_NAME/scripts/default.sh

# TypeScript
bash ~/.claude/commands/golem-powers/YOUR_SKILL_NAME/scripts/run.sh --action=default
```

### Step 5: Verify with Audit Workflow

Run the [audit workflow](audit.md) to verify structure is correct.

---

## Option B: Manual Creation

### Step 1: Create Directory Structure

```bash
mkdir -p ~/.claude/commands/golem-powers/YOUR_SKILL_NAME/scripts
```

### Step 2: Create SKILL.md

```markdown
---
name: your-skill-name
description: When to use this skill
execute: scripts/default.sh
---

# Your Skill Name

Documentation here...
```

### Step 3: Create Script

Create `scripts/default.sh` (or `scripts/run.sh` for TypeScript):

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "## Your Skill"
echo ""
echo "Output here..."
```

### Step 4: Make Executable

```bash
chmod +x ~/.claude/commands/golem-powers/YOUR_SKILL_NAME/scripts/*.sh
```

### Step 5: Test and Verify

Same as Option A, steps 4-5.

---

## Final Step (MANDATORY): REGISTER the skill — committed ≠ installed

**A new skill committed to the repo is INVISIBLE to every agent until it is
registered.** A golem-powers skill only becomes invocable as `/<name>` once it is
symlinked into BOTH `~/.claude/skills/<name>` (CC 2.1.91+ reads slash-commands
here) AND `~/.claude/commands/<name>` (legacy watch dir). Merging the PR does NOT
do this.

```bash
# Canonical: re-run golem-install — it auto-discovers EVERY golem-powers/*/ dir
# and symlinks each into both locations. Re-running it registers your new skill.
#   (see the golem-install skill: `for skill_dir in "$SKILLS_DIR"/*/; do ln -sf …`)
# Or symlink the one new skill manually, matching that pattern:
ln -sf ~/Gits/golems/skills/golem-powers/YOUR_SKILL ~/.claude/skills/YOUR_SKILL
ln -sf ~/Gits/golems/skills/golem-powers/YOUR_SKILL ~/.claude/commands/YOUR_SKILL
```

**Then VERIFY it actually registered** — don't assert it's available:
`ls ~/.claude/skills/YOUR_SKILL/SKILL.md` resolves, and the skill appears in the
available-skills list / a fresh agent can invoke `/YOUR_SKILL`. The chain is
**committed → merged → installed → invocable**; a skill is not "done" until you've
seen it register. (Real failure, 2026-05-30: `/weave` was built, committed, and
merged but never registered — no agent had it until the symlinks were created.)

## Checklist

Before considering the skill complete:

- [ ] SKILL.md has valid YAML frontmatter
- [ ] `execute:` field points to correct script
- [ ] Script is executable (`chmod +x`)
- [ ] Script outputs valid Markdown
- [ ] Script uses proper exit codes
- [ ] Documentation explains what the skill does
- [ ] Shell scripts pass `shellcheck`
- [ ] **REGISTERED — symlinked into `~/.claude/skills/` + `~/.claude/commands/` (run golem-install) AND verified it appears in the skill list** (committed ≠ installed)
