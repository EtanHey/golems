# Base Context - Universal Rules

> Universal rules for all projects. Key rules are auto-loaded via `.claude/rules/golems-base.md`. This file is the full reference.

---

## Maintaining CLAUDE.md

**When you discover important files, patterns, or learnings:**

1. **Update the file tree** in CLAUDE.md if new directories/files are created
2. **Add learnings** to `docs.local/learnings/` (gitignored) or project CLAUDE.md
3. **Update rules-library** if pattern applies across projects, then export to `.claude/rules/`
4. **Every subdirectory** with code should have a README.md explaining its contents

**Key locations to keep updated:**
- Project CLAUDE.md - file tree, project-specific rules
- `rules-library/base.md` - universal patterns (applies to all projects)
- `rules-library/workflow/*.md` - workflow-specific patterns
- `rules-library/tech/*.md` - technology-specific patterns

---

## Telegram Notifications

**When you finish a significant task, notify the user via Telegram:**

```bash
curl -s -X POST http://localhost:3847/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"Task Complete","body":"Brief description of what was done","priority":"default"}'
```

### When to Notify:
- After completing a requested task
- After making significant changes
- When waiting for user input on a decision
- When encountering a blocker

### Keep it Brief:
- Title: 2-4 words (e.g., "PR Created", "Bug Fixed", "Need Input")
- Body: 1 sentence max

---

## Scratchpad Usage

- **File:** `claude.scratchpad.md` (git-ignored)
- **Use for:** bulk operations, complex tasks, planning, temporary notes, long terminal commands
- Always check existence before writing (use Read first)
- Clear after task completion

### When to Use Scratchpad:
- Tracking multiple related changes (like bulk replacements)
- Creating audit trails for complex operations
- Storing temporary notes that need to persist across messages
- Planning multi-step operations before execution
- **Long terminal commands**: Write to scratchpad to avoid line wrapping issues during copy/paste

---

## AIDEV-NOTE Guidelines

Use `AIDEV-NOTE:`, `AIDEV-TODO:`, or `AIDEV-QUESTION:` (all-caps prefix) for comments aimed at AI and developers.

### When to Add AIDEV Notes:
- Code that is too complex
- Very important functionality
- Confusing logic
- Potential bugs or edge cases
- Workarounds or temporary solutions

### Best Practices:
- **Before scanning files**: Grep for existing `AIDEV-*` anchors in relevant subdirectories
- **Update relevant anchors** when modifying associated code
- **Never remove** AIDEV-NOTEs without explicit human instruction
- Keep notes concise and specific

```typescript
// AIDEV-NOTE: This function handles X because of Y constraint
// AIDEV-TODO: Refactor when Z is implemented
// AIDEV-QUESTION: Should we handle edge case W?
```

---

## SVG and Icon Guidelines

- **NEVER make SVGs** - use `lucide-react` (web) or `lucide-react-native` (mobile) INSTEAD
- Only create custom SVGs if you are 100% SURE you need to
- **NEVER use**: MaterialCommunityIcons, @expo/vector-icons, or other icon libraries

---

## Formatting Rules

- **NEVER format the whole project** unless explicitly asked
- Do not make changes that are solely formatting changes
- Only format code you are actively modifying

---

## Documentation Fetching Rules

**Always fetch real documentation - never rely on memory or approximations**

### When to Fetch Docs:
- Before using any function/method you're not 100% certain about
- When implementing features with external dependencies
- When debugging issues that might involve library behavior
- When the user mentions a specific library version
- Whenever you would otherwise guess at syntax or parameters
- Before implementing authentication flows or API integrations

### How to Fetch:
1. Use WebSearch to find official docs
2. Use WebFetch on specific pages for details
3. Look for exact function signatures and type definitions
4. Check for version-specific behavior

### Important:
- Always fetch docs for the specific version in package.json
- Never synthesize or guess API signatures
- Check GitHub repo for recent releases if docs seem outdated

---

## Thinking Before Doing

This section overrides all tendencies toward premature solutions. When presented with any task or question:

### 1. Understand First, Solve Second
- What's the actual problem being solved? The stated problem often isn't the real problem
- What's the broader context? How does this fit into the larger system?
- What constraints exist? Technical, business, time, or user constraints all matter
- What has been tried before? Check the codebase for existing patterns
- **It's okay to say**: "Before I suggest a solution, can you help me understand..."

### 2. Explore the Problem Space
- Think about multiple approaches before choosing one
- Consider what could go wrong with each approach
- Look for existing patterns in THIS codebase (not just general best practices)
- Ask yourself: Is there a simpler solution I'm missing?
- **Avoid**: Immediately suggesting npm packages without checking what's already in use

### 3. Practice Intellectual Honesty
- If something seems off or risky, say so and explore why
- If you're unsure, admit it and investigate rather than guessing
- If the request might have unintended consequences, discuss them
- Share your thought process - the reasoning is often more valuable than the conclusion
- **Remember**: It's better to ask a clarifying question than to build the wrong thing

### 4. Stay Curious and Iterative
- Why does this particular solution matter to the user?
- What can you learn about the domain from this problem?
- What edge cases should we consider?
- How might this connect to other parts of the system?

### Common Anti-Patterns to Avoid:
- Jumping straight to code without understanding requirements
- Suggesting the first solution that comes to mind
- Adding dependencies without checking what's already available
- Assuming you understand the full context from a brief description
- Optimizing for brevity over thoroughness in your thinking

---

## Spawning Other Claudes

**Don't spawn raw `claude` CLI from within Claude sessions.**
- They hang around and cause process mess
- Use proper scripts (night-shift.ts, ralph.zsh) that handle lifecycle

**Worktree setup for spawned Claudes:**
- Link node_modules: `ln -s ../node_modules node_modules`
- Copy .env: `cp ../.env .env`
- Verify branch: `git branch` (must NOT be master/main)

---

## JQ Escaping Bug Workaround (Claude Code Bash Tool)

Claude Code's Bash tool corrupts jq commands containing `!=` and `|`. **Always use double quotes with escaped inner quotes:**

```bash
# CORRECT:
jq ".pending | map(select(. != \"FOO\"))" file.json

# WRONG (breaks with \!= error):
jq '.pending | map(select(. != "FOO"))' file.json
```

**User helper:** `jqf` (in lib/ralph-commands.zsh) writes filter to temp file:
```bash
jqf '.pending | map(select(. != "FOO"))' file.json -i
```

---

## TypeScript/JavaScript Type Safety

**CRITICAL: NEVER USE NON-NULL ASSERTIONS WITHOUT VALIDATION**

### Environment Variables:
```typescript
// NEVER DO THIS
const apiKey = process.env.API_KEY!;

// ALWAYS DO THIS
const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error('API_KEY environment variable is required');
}
```

### Optional Values:
```typescript
// NEVER DO THIS
const userId = user?.id!;

// ALWAYS DO THIS
const userId = user?.id;
if (!userId) {
  throw new Error('User ID is required');
}
```

### Key Principles:
- Always validate external data (environment variables, API responses, user input)
- Use TypeScript's strict mode and never bypass it with assertions
- Prefer explicit error handling over assumptions
- Write defensive code that fails fast with clear error messages
