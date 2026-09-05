# Ralph Workflow Context

> Use this context for projects that use Ralph for autonomous task execution.

---

## What is Ralph?

**Ralph** is an external tool that runs Claude in a loop to execute PRD stories. The user runs `ralph` commands from their terminal - it's not Claude's job to run Ralph.

---

## Commands

```bash
ralph [N]              # Run N iterations on PRD
ralph 300              # Run 300 iterations
ralph-init             # Create PRD template
ralph-archive          # Archive completed stories
ralph-status           # Show PRD status
ralph-learnings        # Show learnings.md
```

### App-Specific Commands (Monorepos)

```bash
ralph expo 300         # Run on apps/expo/PRD.md
ralph public 300       # Run on apps/public/PRD.md
ralph admin 300        # Run on apps/admin/PRD.md
```

---

## Critical Rule: After Creating a PRD

**When the `/golem-powers:prd` command creates `PRD.md` and `progress.txt`:**

1. **DO NOT implement the stories**
2. **DO NOT spawn subagents**
3. **Tell the user:** "PRD ready. Run `ralph` to execute."

The user will run Ralph externally - it's not Claude's job to execute the stories.

---

## File Structure

### JSON Mode (Preferred)
```
project/
├── prd-json/
│   ├── index.json           # PRD state
│   └── stories/
│       ├── US-001.json
│       ├── BUG-002.json
│       └── ...
├── progress.txt             # Iteration progress (gitignored)
└── docs.local/
    ├── learnings.md         # Shared learnings
    └── prd-archive/         # Completed stories
```

### Markdown Mode (Legacy)
```
project/
├── PRD.md                   # PRD file (gitignored)
├── progress.txt             # Iteration progress (gitignored)
└── docs.local/
    └── learnings.md
```

---

## Story Types

| Type | Purpose | Example |
|------|---------|---------|
| `US-XXX` | User story / feature | US-001: Add login button |
| `BUG-XXX` | Bug fix | BUG-001: Fix crash on load |
| `V-XXX` | Verification story | V-001: Verify US-001 criteria |
| `TEST-XXX` | E2E test story | TEST-001: Playwright tests for US-001 |
| `MP-XXX` | Master plan / infrastructure | MP-001: Refactor auth system |
| `AUDIT-XXX` | Audit / review | AUDIT-001: Review README accuracy |

---

## Story Chain Pattern

```
BUG-001 (fix) → V-001 (verify) → TEST-001 (e2e if critical)
US-001 (feature) → V-001 (verify)
```

---

## Acceptance Criteria Format (JSON)

```json
{
  "id": "US-001",
  "title": "Add login button to header",
  "type": "feature",
  "priority": "high",
  "status": "pending",
  "acceptanceCriteria": [
    {"text": "Login button visible in header", "checked": false},
    {"text": "Button navigates to /login on click", "checked": false},
    {"text": "Button hidden when user is logged in", "checked": false}
  ],
  "dependencies": [],
  "passes": false
}
```

---

## Adding Stories During Execution

**Use `update.json` pattern** - don't edit `index.json` directly while Ralph is running:

```json
// prd-json/update.json
{
  "newStories": [
    {
      "id": "BUG-002",
      "title": "Fix regression from US-001",
      "type": "bug",
      "priority": "high",
      "acceptanceCriteria": [
        {"text": "Fix the crash", "checked": false}
      ]
    }
  ]
}
```

Ralph will merge `update.json` into `index.json` automatically.

---

## Updating Stories During Execution

```json
// prd-json/update.json
{
  "updateStories": [
    {
      "id": "US-001",
      "status": "blocked",
      "blockedBy": "BUG-002"
    }
  ]
}
```

---

## PRD Files Are Ephemeral

`PRD.md`, `index.json`, and `progress.txt` are **state machines**, not documentation.
They're gitignored. The real audit trail is code commits:

```
feat: US-001 add login button to header
fix: BUG-002 fix crash on empty user state
```

---

## Learnings Pattern

Store learnings that persist across iterations:

```markdown
# docs.local/learnings.md

## 2025-01-24: RTL Flex Order
In RTL mode, first DOM element appears on RIGHT.
#rtl #css #layout
```

Search learnings before starting work:
```bash
grep -r "#tag" docs.local/learnings/
```

---

## When Running as Ralph

**Execution Mode Detection:**

| Signal | You are... |
|--------|-----------|
| AGENTS.md prompt with story ID | **Ralph** - autonomous PRD execution |
| User conversation, no AGENTS.md | **Interactive Claude** |

**Ralph-Specific Rules:**
1. No CLAUDE_COUNTER - you run once per iteration
2. Commit freely after completing work
3. Re-read CLAUDE.md only every 20+ tool uses
4. Focus on current story's acceptance criteria
5. Update progress and mark criteria as checked
6. Use farther-steps for deferred actions (see below)

### Farther-Steps (Deferred Actions for Ralph)

When you identify work that can't be done now but needs tracking, add to `~/.claude/farther-steps.json`:

```json
{
  "id": "step-XXX",
  "type": "sync",
  "source": "path/to/source",
  "target": "path/to/target",
  "reason": "Detailed explanation of what and why",
  "story": "CURRENT-STORY-ID",
  "criteria": "Which criteria triggered this",
  "status": "pending",
  "priority": "high|medium|low"
}
```

**When to use (Ralph context):**
- Syncing files between `~/.claude/` and repo that need human review
- Config changes discovered but not in current story scope
- Quality improvements that shouldn't block current iteration
- Cross-project learnings that should also go to global `~/.claude/learnings/`

**Unlike learnings:** Farther-steps are *actionable* - they have a source, target, and status. Human reviews and applies them later with `fs pending` / `fs apply`.

---

## Ralph Git Rules

- You MUST commit after completing each story (so CodeRabbit reviews only new code)
- You MUST NOT push to remote (Ralph handles this separately)
- Commit format: `git commit -m "feat: [STORY-ID] description"`
- Ralph is autonomous - each iteration needs its own commit

---

## Blocked Stories

Mark a story as blocked when you CANNOT fix the issue yourself:

```json
{
  "id": "US-001",
  "status": "blocked",
  "blockedBy": "External API unavailable"
}
```

**Valid block reasons:**
- MCP tool failure (Figma permission, API timeout)
- Manual device testing required
- User decision needed (ambiguous requirements)
- External API unavailable
- Dev server fails after trying to start it

**NOT valid block reasons (fix these yourself):**
- Dev server not running (start it!)
- Browser tabs not available (check MCP tools)
- Missing file (create it!)

---

## Available Skills for Ralph

**Read `prd-json/AGENTS.md` for this project's available skills.**

The PRD creator discovers relevant skills and includes them in AGENTS.md with descriptions of when to use each one. Skills vary by project:
- UI projects may have `/golem-powers:brave` for browser automation
- Linear users have `/golem-powers:linear` for issue tracking
- Convex projects have `/golem-powers:convex` for backend operations

**Universal skills (always available):**
- `/golem-powers:ralph-commit` - For "Commit:" criteria
- `/golem-powers:coderabbit` - Code review (iterate until clean)
- `/golem-powers:context7` - Look up library docs when unsure about APIs
- `/golem-powers:github` - Git operations, PRs, issues
- `/golem-powers:create-pr` - Push and create PRs
- `/golem-powers:catchup` - Context recovery after long breaks

**Invoke via `/golem-powers:skill-name` or read `~/.claude/skills/golem-powers/skill-name/SKILL.md`.**

---

## CodeRabbit Integration

**CR reads CLAUDE.md automatically.** Project rules are already there.

### ⚠️ MANDATORY STORY STRUCTURE (EVERY STORY)

**The last two acceptance criteria of EVERY story MUST be, in this exact order:**

1. `"Run CodeRabbit review - must pass (or create BUG if unfixable)"`
2. `"Commit: {type}: {STORY-ID} {description}"`

**CodeRabbit ALWAYS comes BEFORE commit. No exceptions.**

### 🔄 CR Iteration Rule (CRITICAL)

**For "Run CodeRabbit review" criteria, iterate until clean:**

```
┌─────────────────────────────────────────────┐
│  cr review --prompt-only --type uncommitted │
└─────────────────┬───────────────────────────┘
                  │
          ┌───────▼───────┐
          │ Issues found? │
          └───────┬───────┘
                  │
      ┌───────────┴───────────┐
      │                       │
      ▼                       ▼
   [YES]                    [NO]
      │                       │
      ▼                       ▼
┌─────────────┐        ┌──────────────┐
│ Fix issues  │        │ ✅ Proceed   │
│ or document │        │ to commit    │
│ intentional │        └──────────────┘
└──────┬──────┘
       │
       └──────► Loop back to CR review
```

**Rules:**
1. Run CR before every commit
2. Fix all valid issues before proceeding
3. If intentional design → Add to CLAUDE.md's "CodeRabbit Context" section, then proceed
4. **Never skip CR or commit with unresolved issues**
5. Maximum 3 iterations - if still failing after 3 rounds, create BUG story for remaining issues

### Handling CR Findings

| CR Says | You Do |
|---------|--------|
| Valid best practice | Fix it, run CR again |
| Intentional design | Add to CLAUDE.md's "CodeRabbit Context" section, proceed |
| Can't fix now | Create BUG story via update.json |
| Wrong/outdated | Log to `docs.local/learnings/coderabbit-feedback.csv` |

### CSV Learnings Format

For batch import to CR web UI:
```csv
file_path,learning,created_by,date
"ralph.zsh","Single-file design is intentional","ralph","2025-01-24"
```

### Two Ways to Teach CR

1. **CLAUDE.md** (immediate) - CR reads on every review
2. **CSV import** (batch) - Upload to app.coderabbit.ai/learnings

---

## Test Failure Handling

When tests fail during pre-commit or story work:

### 1. Determine Relevance to Current Story

Ask: **"Is this test failure related to my current story's work?"**

### 2a. NOT Related to Current Story

If the failure is unrelated (pre-existing issue, flaky test, unrelated code):

1. **Create a BUG story** via `update.json`:
   ```json
   {
     "newStories": [{
       "id": "BUG-XXX",
       "title": "Fix failing test: [test name]",
       "type": "bug",
       "priority": "medium",
       "acceptanceCriteria": [
         {"text": "Test [name] passes consistently", "checked": false}
       ]
     }]
   }
   ```

2. **Log to progress.txt** under Learnings:
   ```
   ## Test Failure (unrelated to current work)
   - Test: [test name]
   - Error: [brief error]
   - Created: BUG-XXX to address later
   ```

3. **Continue with current story** (use `--no-verify` if needed, but only after logging)

### 2b. Related to Current Story

If the failure IS related to your current work:

**Is the test outdated?**
- Test assumptions no longer valid due to intentional changes
- Test checks old behavior that was deliberately changed
- → **Update the test** to match new expected behavior

**Is the test correct?**
- Test catches a real bug in your new code
- Test validates behavior that should still work
- → **Fix your code** to make the test pass

### Decision Tree

```
Test fails
    │
    ├─ Related to current story?
    │   ├─ YES → Is test outdated?
    │   │         ├─ YES → Update test
    │   │         └─ NO  → Fix code
    │   │
    │   └─ NO  → Create BUG story + log to progress.txt + continue
    │
    └─ Never ignore silently!
```

---

## Commit Criterion Handling

When you reach a "Commit: ..." acceptance criterion, use the **`/ralph-commit`** skill:

```bash
/ralph-commit --story=US-106 --message="feat: US-106 description"
```

This atomically:
1. Commits (pre-commit hook runs all tests)
2. If tests pass → marks the commit criterion as checked
3. If tests fail → neither happens, criterion stays unchecked

**Never use `--no-verify`** unless failure is documented in progress.txt + BUG story created.
