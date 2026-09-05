---
name: prd
status: experimental
description: "Create JSON PRDs for Ralph stories. Triggers: plan feature, create PRD, Ralph stories. NOT running Ralph."
---

# PRD Generator

Create PRDs for autonomous AI implementation via Ralph loop.

---

## The Job

1. Ask 3-5 clarifying questions (use `AskUserQuestion` tool)
2. Find git root: `git rev-parse --show-toplevel`
3. **Discover relevant skills** for this project (see below)
4. Create JSON output:
   - `prd-json/index.json` - Story order (stats computed automatically)
   - `prd-json/stories/{US-XXX}.json` - One file per story
5. Create `prd-json/AGENTS.md` with skills section
6. Create `progress.txt` at git root
7. **STOP and say: "PRD ready. Run Ralph to execute."**

**🛑 DO NOT IMPLEMENT** - Ralph handles that externally.

---

## Skill Discovery (CRITICAL for Ralph)

**Before creating stories, determine which skills are relevant for THIS project:**

### Step 1: Check Project Context

```bash
# What's in this project?
[ -f "convex.json" ] && echo "HAS_CONVEX=true"
[ -f ".linear" ] || grep -q "linear" package.json 2>/dev/null && echo "HAS_LINEAR=true"
[ -d "src/components" ] || [ -d "app" ] && echo "HAS_UI=true"
[ -f "playwright.config.ts" ] && echo "HAS_PLAYWRIGHT=true"
```

### Step 2: Match Skills to Project

**UNIVERSAL (always include):**

| Skill | Why |
|-------|-----|
| `/ralph-commit` | Atomic commits with criterion check |
| `/coderabbit` | Code review before commits (iterate until clean) |
| context7 MCP | Look up library docs when unsure about APIs |
| `gh` / `/pr-loop` | Git operations, PRs, issues |
| `/create-pr` | Push and create PRs |
| Git status/diff + handoff files | Context recovery after long breaks |

**PROJECT-SPECIFIC (include if detected):**

| If Project Has... | Include Skill | Why |
|-------------------|---------------|-----|
| `convex.json` | Convex CLI/docs | Dev server, deploy, functions |
| `.linear` or Linear in deps | `/linear` | Issue tracking |
| UI (`/app`, `/components`) | Browser plugin / Playwright | Browser automation |
| 1Password secrets | `/1password` | Secrets management |
| Complex PRD (10+ stories) | `/prd-manager` | Bulk story operations |
| Needs isolation | Native `git worktree` | Branch isolation |

**DO NOT INCLUDE (meta skills, not for Ralph):**
- `/prd`, `/skills`, `/skill-creator`, `/ralph-install`, `/example-*`

### Step 3: List Available Skills (Reference)

```bash
# See all installed skills
ls -1 ~/.claude/skills/*/SKILL.md 2>/dev/null | while read f; do
  skill=$(dirname "$f" | xargs basename)
  desc=$(awk '/^description:/{gsub(/^description: *"?/, ""); gsub(/"$/, ""); print}' "$f")
  echo "/$skill: $desc"
done
```

### Step 4: Include ONLY Relevant Skills in AGENTS.md

Don't dump all skills - only include ones this project will actually use. Ralph should see a focused list, not 20+ skills.

---

## Story Prefix = Model Selection (CRITICAL)

**Ralph routes stories to AI models based on the prefix.** Wrong prefix = wrong model = failed story.

| Prefix | Model | When to Use |
|--------|-------|-------------|
| `US-` | **Sonnet** | Simple features, UI, CRUD. < 5 criteria, 1-3 files. Clear implementation path. |
| `BUG-` | **Sonnet** | Bug fixes, error handling, regressions. |
| `V-` | **Haiku** | Verification only (checking criteria, no code changes). |
| `TEST-` | **Haiku** | Writing tests only, no production code. |
| `MP-` | **Opus** | Complex infra, algorithms, multi-file refactors, architectural decisions. > 6 criteria, 4+ files. |
| `AUDIT-` | **Opus** | Deep code review, security, architecture. |

**Decision rule:** If any criterion says "approach chosen", "design decision", or requires choosing between strategies — use **MP-**, not US-. Sonnet struggles with open-ended design. When in doubt, use MP-.

**Config:** `~/.config/golems/config.json` → `models` object. Default fallback: opus.

---

## Story Rules

### Sizing (THE NUMBER ONE RULE)
Each story must complete in ONE context window (~10 min of AI work).

**Right-sized:** Add one component, update one action, fix one bug
**Too big (split):** "Build dashboard" → Schema + Queries + UI + Filters

### Ordering (Dependencies First)
1. Schema/database
2. Server actions
3. UI components
4. Verification stories (V-XXX)

### Acceptance Criteria
- Must be verifiable (not vague)
- Include "Typecheck passes"
- Include "Verify in browser" for UI stories

**⚠️ MANDATORY: Last two criteria of EVERY story (in this exact order):**
1. `"Run CodeRabbit review - must pass (or create BUG if unfixable)"`
2. `"Commit: {type}: {STORY-ID} {description}"`

**CodeRabbit ALWAYS comes BEFORE commit. No exceptions.**

### TDD / Test Enforcement (CRITICAL)
**When to add test criteria:**
- **New functions/helpers:** "Add unit test for [function] in tests/"
- **Bug fixes:** "Add regression test to prevent reintroduction"
- **Core logic changes:** "Verify all existing tests pass (X/X)"
- **Refactors that touch tested code:** "Run test suite - must pass with same count"

**Why this matters:**
If a function has tests, and a future story accidentally deletes that function, the tests will fail and block the commit. Tests are your safety net against regressions.

**Example criteria:**
```
"Add unit test for _ralph_new_helper_function"
"Run ./tests/test-ralph.zsh - must pass (49/49)"
"Add regression test: verify X doesn't break when Y"
```

### Commit Convention
Every story ends with a commit criterion. Match type to story:

| Story Type | Commit Type | Example |
|------------|-------------|---------|
| US-XXX (feature) | `feat:` | `feat: US-001 add login button` |
| BUG-XXX (bug fix) | `fix:` | `fix: BUG-001 resolve crash on empty state` |
| V-XXX (verification) | `test:` | `test: V-001 verify login flow` |
| TEST-XXX (e2e tests) | `test:` | `test: TEST-001 playwright tests for auth` |
| MP-XXX (infrastructure) | `refactor:` or `chore:` | `refactor: MP-001 restructure auth module` |
| AUDIT-XXX (audit/review) | `docs:` or `chore:` | `docs: AUDIT-001 update README` |

**Last two criteria (always):**
```
"Run CodeRabbit review - must pass (or create BUG if unfixable)"
"Commit: {type}: {STORY-ID} {description}"
```

**Examples:**
- `"Run CodeRabbit review - must pass (or create BUG if unfixable)"`
- `"Commit: feat: US-034 add user profile page"`
- `"Commit: fix: BUG-012 handle null response from API"`
- `"Commit: test: V-034 verify profile page renders correctly"`
- `"Commit: refactor: MP-002 migrate to modular contexts"`

---

## Conditional Rules

**For RTL projects (Hebrew/Arabic):**
Include RTL checklist in stories: flex order reversal, text-right/items-end, RTL propagation in nested flex containers.

**For modals/dynamic states:**
Each dynamic state = separate story. Don't bundle modal states into one story.

---

## ⚠️ ADDING TO EXISTING PRD (CRITICAL)

**NEVER edit `index.json` directly when adding stories to an existing PRD!**

Use `prd-json/update.json` instead. Ralph auto-merges it on next run.

### To add new stories:
1. Create story files in `prd-json/stories/` (e.g., `US-034.json`)
2. Create `prd-json/update.json`:
```json
{
  "storyOrder": ["...existing IDs...", "US-034", "US-035"],
  "pending": ["...existing pending...", "US-034", "US-035"]
}
```
Note: Do NOT include `stats` - they are computed automatically from arrays.
3. Ralph merges update.json → index.json automatically, then deletes update.json

### Why update.json?
- Prevents merge conflicts
- Clear audit trail
- Multiple agents can queue changes safely

---

## JSON Templates

### index.json
```json
{
  "$schema": "https://ralph.dev/schemas/prd-index.schema.json",
  "generatedAt": "2026-01-19T12:00:00Z",
  "nextStory": "US-001",
  "storyOrder": ["US-001", "US-002", "V-001", "V-002"],
  "pending": ["US-001", "US-002", "V-001", "V-002"],
  "blocked": []
}
```
**Note:** Do NOT include `stats` - the UI computes them from array lengths.

### Story JSON (prd-json/stories/US-XXX.json)
```json
{
  "id": "US-001",
  "title": "[Story Title]",
  "description": "[What and why]",
  "acceptanceCriteria": [
    {"text": "[Specific criterion]", "checked": false},
    {"text": "Typecheck passes", "checked": false},
    {"text": "Verify in browser", "checked": false},
    {"text": "Run CodeRabbit review - must pass (or create BUG if unfixable)", "checked": false},
    {"text": "Commit: feat: US-001 [description]", "checked": false}
  ],
  "passes": false,
  "blockedBy": null
}
```

---

## Output

Create at repository root:
- `prd-json/index.json`
- `prd-json/stories/*.json`
- `prd-json/AGENTS.md` - Instructions for AI agents (see template below)
- `progress.txt`

### AGENTS.md Template

**IMPORTANT:** Run skill discovery first and include ACTUAL descriptions in AGENTS.md:

```bash
# Generate skills table for AGENTS.md
echo "| Skill | When to Use |"
echo "|-------|-------------|"
ls -1 ~/.claude/skills/*/SKILL.md 2>/dev/null | while read f; do
  skill=$(dirname "$f" | xargs basename)
  desc=$(awk '/^description:/{gsub(/^description: *"?/, ""); gsub(/"$/, ""); print}' "$f")
  echo "| \`/$skill\` | $desc |"
done

# Get project contexts from registry
project_key="$(basename $(pwd))"  # or the registered project name
jq -r --arg p "$project_key" '.projects[$p].contexts // [] | .[]' ~/.config/golems/registry.json 2>/dev/null
```

```markdown
# AI Agent Instructions for PRD

## 🚀 Available Skills

**Invoke skills via `/skill-name` - read the description to know WHEN to use each:**

<!-- PASTE OUTPUT FROM SKILL DISCOVERY HERE -->
| Skill | When to Use |
|-------|-------------|
| `/ralph-commit` | Atomic commit + criterion check for Ralph stories. Use for "Commit:" criteria. |
| `/coderabbit` | Runs AI code reviews. Use when reviewing changes, preparing PRs, or checking code quality. |
| `/prd-manager` | Manage PRD stories - add, update, bulk operations. |
| Git status/diff + handoff files | Recover context by reading changed files and recent handoffs. |

## 📦 Project Contexts

**Ralph loads these contexts automatically from the registry:**

<!-- List contexts from: jq '.projects["<project>"].contexts[]' ~/.config/golems/registry.json -->
- `base` - Universal rules (scratchpad, AIDEV-NOTE, type safety)
- `skill-index` - Available skills reference
- `workflow/interactive` - CLAUDE_COUNTER, git safety

These contexts provide project-specific rules and patterns. If you need additional contexts, update the project's `contexts` array in `~/.config/golems/registry.json`.

## 🔄 CodeRabbit Iteration Rule

**For "Run CodeRabbit review" criteria, iterate until clean:**

1. Run: `cr review --prompt-only --type uncommitted`
2. If issues found → Fix them
3. Run CR again
4. Repeat until: "No issues found" or only intentional patterns remain
5. If intentional pattern → Add to CLAUDE.md's CodeRabbit Context section

**Never skip CR or commit with unresolved issues.**

## ⚠️ NEVER EDIT index.json DIRECTLY

To add/modify stories, use `update.json`:

1. Create story files in `stories/`
2. Write changes to `update.json` (not index.json!)
3. Ralph merges automatically on next run

## Example update.json
\`\`\`json
{
  "storyOrder": ["existing...", "NEW-001"],
  "pending": ["existing...", "NEW-001"]
}
\`\`\`
Note: Do NOT include `stats` - computed automatically.

## Story ID Rules
- Check `archive/` for used IDs before creating new ones
- Use next available number (e.g., if US-033 exists, use US-034)
```

**Then say:**
> ✅ PRD saved to `prd-json/` with X stories + X verification stories.
> Run Ralph to execute. I will not implement - that's Ralph's job.

---

## Checklist

- [ ] Ran skill discovery - identified relevant skills for project
- [ ] prd-json/ created at repo root
- [ ] index.json has storyOrder, pending, blocked (NO stats - computed automatically)
- [ ] AGENTS.md created with skills section + update.json instructions
- [ ] Each story has its own JSON file
- [ ] Stories ordered by dependency
- [ ] All criteria are verifiable
- [ ] Every story has "Typecheck passes"
- [ ] UI stories have "Verify in browser"
- [ ] Verification stories (V-XXX) for each US-XXX
- [ ] Every story ends with CodeRabbit + Commit criteria
- [ ] RTL rules included (if applicable) — flex order, text-right, items-end, nested RTL
- [ ] Modal rules followed (if applicable) — each state = separate story
