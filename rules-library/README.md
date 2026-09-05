# Claude Contexts System

A modular context system for sharing common CLAUDE.md rules across projects.

---

## Dogfooding Requirement

> **Rule:** Projects that DEFINE contexts MUST also USE them.

The claude-golem repo is the canonical home of the context system. It defines all shared contexts in `contexts/` and MUST reference those same contexts in its own CLAUDE.md.

### Why This Matters

1. **Eat your own cooking** - If we define rules, we should follow them
2. **Catch bugs early** - Using contexts reveals issues before other projects do
3. **Stay honest** - Forces us to write contexts that actually work

### How claude-golem Dogfoods

```markdown
# claude-golem/CLAUDE.md

## SETUP (AI: Read This First)
...

## Contexts
@context: base
@context: skill-index
@context: workflow/interactive
@context: workflow/ralph
```

Any project that contributes to the contexts system MUST use the contexts it defines.

---

## Cross-Project Improvement

When you fix or improve a context, ALL projects using that context benefit automatically.

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    claude-golem repo                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  contexts/                                           │    │
│  │    base.md        ←── Fix discovered in Project A    │    │
│  │    tech/nextjs.md                                    │    │
│  │    workflow/rtl.md                                   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │  Project A   │   │  Project B   │   │  Project C   │
   │ @context:base│   │ @context:base│   │ @context:base│
   │              │   │              │   │              │
   │ Benefits     │   │ Benefits     │   │ Benefits     │
   │ immediately! │   │ immediately! │   │ immediately! │
   └──────────────┘   └──────────────┘   └──────────────┘
```

### Example: Discovering a Gap

```bash
# Working on a project, realize RTL flex rules are incomplete

# 1. Fix it in the shared context
edit ~/.claude/contexts/workflow/rtl.md

# 2. Commit to golems repo
cd ~/Gits/golems
git add contexts/workflow/rtl.md
git commit -m "fix: improve RTL flex container rules"
git push

# 3. All RTL projects benefit from the improvement
```

### One Fix, Many Benefits

| Fix Location | Projects Improved |
|--------------|-------------------|
| `base.md` | ALL projects |
| `tech/nextjs.md` | All Next.js projects |
| `workflow/rtl.md` | All Hebrew/Arabic projects |
| `skill-index.md` | All interactive Claude sessions |

---

## Self-Improvement Loop

The context system has a built-in feedback loop: find gaps → create story → Ralph fixes → all projects benefit.

### The Loop

```
   ┌──────────────────┐
   │  Claude works on │
   │  any project     │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Discovers gap   │
   │  or improvement  │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Ask user about  │     User says "not now"
   │  fixing it       │────────────────────────┐
   └────────┬─────────┘                        │
            │ User approves                    │
            ▼                                  ▼
   ┌──────────────────┐              ┌──────────────────┐
   │  Create PRD      │              │  Log in learnings│
   │  story via /prd  │              │  for later       │
   └────────┬─────────┘              └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │  User runs Ralph │
   │  on claude-golem │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Context fixed,  │
   │  all projects    │
   │  benefit         │
   └──────────────────┘
```

### Using /context-audit to Find Gaps

Run the context audit skill to discover what contexts a project SHOULD have:

```bash
# In any project
/context-audit
```

This produces:

```
=== CONTEXT AUDIT ===

AVAILABLE CONTEXTS:
  base.md
  skill-index.md
  tech/nextjs.md
  ...

DETECTED TECH STACK:
  [x] Next.js (found next in package.json)
  [x] RTL (found Hebrew text)
  [ ] Convex (no convex/ dir)

CURRENT CLAUDE.md CONTEXTS:
  @context: base

GAP SUMMARY:
  Missing: tech/nextjs, workflow/rtl

RECOMMENDED ADDITIONS:
  @context: tech/nextjs
  @context: workflow/rtl
```

### What to Do With Gaps

| Gap Type | Action |
|----------|--------|
| Missing context ref | Add `@context:` line to project CLAUDE.md |
| Context exists but incomplete | Fix context in claude-golem → create story |
| Context doesn't exist | Create new context → use `/prd` for story |
| Project-specific need | Keep in project CLAUDE.md (not shared) |

---

## How It Works

Instead of duplicating rules in every project's CLAUDE.md, reference shared contexts:

```markdown
# Project CLAUDE.md

## Contexts
@context: base
@context: tech/nextjs
@context: tech/supabase
@context: workflow/rtl

## Project-Specific Rules
(Only rules unique to THIS project go here)
```

---

## Context Inheritance

```
Full Context = base + tech contexts + workflow contexts + project-specific
```

### Example: Next.js + Supabase + RTL Project

```markdown
## Contexts
@context: base               # Universal rules (~150 lines)
@context: tech/nextjs        # Next.js patterns (~300 lines)
@context: tech/supabase      # Supabase patterns (~150 lines)
@context: workflow/rtl       # RTL guidelines (~100 lines)
@context: workflow/testing   # Testing standards (~100 lines)

## Project-Specific
(~50-100 lines of truly project-specific rules)
```

**Total effective context: ~850 lines**
**Total in project CLAUDE.md: ~50-100 lines + context references**

---

## Available Contexts

### Base (Always Include)
| Context | Description | Lines |
|---------|-------------|-------|
| `base` | Universal rules: scratchpad, AIDEV-NOTE, docs fetching, type safety | ~130 |
| `golem-system` | System philosophy, architecture, BrainLayer memory system | ~350 |

### Workflow Contexts
| Context | Description | Lines |
|---------|-------------|-------|
| `workflow/interactive` | Interactive Claude rules: CLAUDE_COUNTER, git safety | ~60 |
| `workflow/ralph` | Ralph autonomous execution: commit rules, story handling | ~350 |
| `workflow/rtl` | RTL layout rules for Hebrew/Arabic | ~100 |
| `workflow/testing` | Test IDs, state testing, Playwright | ~100 |
| `workflow/design-system` | Component checking, Tailwind v4 | ~100 |

### Tech Contexts
| Context | Description | Lines |
|---------|-------------|-------|
| `tech/nextjs` | Next.js App Router, Server/Client components, next-intl | ~300 |
| `tech/supabase` | Migrations, types, client usage | ~150 |
| `tech/convex` | Schema, queries, mutations, .js error fix | ~100 |
| `tech/react-native` | Expo, NativeWind, navigation | ~150 |

### Voicelayer Rules (path-scoped, incident-born — 2026-06-11 v9 rejection)
| Context | Description | Lines |
|---------|-------------|-------|
| `voicelayer/voicebar-visual-verification` | Snapshot ≠ reality; only real-running-app screenshots count; chrome-headless-shell banned; mocks ≠ structural truth | ~16 |
| `voicelayer/voicebar-layout-law` | Sides = CTAs/timer/waveform, under = menus+teleprompter; 90°-soft not funnel; flush as the camera island | ~16 |
| `voicelayer/voicebar-live-bar-safety` | R-013 never disrupt the resident bar; never touch the disable flag; socket-env isolation; one driver; no unverified ships | ~21 |

---

## How to Reference Contexts

### Standard Syntax (Preferred)

Use `@context:` followed by the context name. Place these in your CLAUDE.md:

```markdown
## Contexts
@context: base
@context: skill-index
@context: tech/nextjs
@context: workflow/rtl
@context: workflow/interactive
```

### With Inline Descriptions

You can add descriptions after the context reference for clarity:

```markdown
## Contexts
@context: base - Universal rules (scratchpad, AIDEV-NOTE, type safety)
@context: skill-index - Available skills reference
@context: tech/nextjs - Next.js App Router patterns
@context: workflow/rtl - RTL layout guidelines
```

### Context Naming

| Pattern | Example | Description |
|---------|---------|-------------|
| Base | `@context: base` | Universal rules for all projects |
| Tech | `@context: tech/nextjs` | Framework/library-specific |
| Workflow | `@context: workflow/rtl` | Process/pattern-specific |

### Legacy Syntax (Deprecated)

These formats still work but are not recommended:

```markdown
<!-- @context: base, tech/nextjs -->       # Comment syntax
- base.md (universal rules)                 # Bullet list
@import ~/.claude/contexts/base.md         # Import syntax
```

---

## Context File Location

```
~/.claude/contexts/
├── base.md                 # Universal rules (all modes)
├── tech/
│   ├── nextjs.md
│   ├── supabase.md
│   ├── convex.md
│   └── react-native.md
├── workflow/
│   ├── interactive.md      # Interactive Claude sessions
│   ├── ralph.md            # Ralph autonomous execution
│   ├── rtl.md
│   ├── testing.md
│   └── design-system.md
└── README.md               # This file
```

---

## Adding a New Context

### When to Create a New Context

Create a new shared context when:
- The same pattern appears in **3+ projects**
- The content is **50+ lines** (worth extracting)
- The rules are **reusable** across different project types

### Step-by-Step Process

1. **Identify the pattern** across multiple CLAUDE.md files
   ```bash
   grep -r "your-pattern" ~/Desktop/Gits/*/CLAUDE.md
   ```

2. **Choose the right directory**
   - `tech/` - Framework/library-specific (nextjs, supabase, convex)
   - `workflow/` - Process/pattern-specific (rtl, testing, design-system)

3. **Create the context file**
   ```bash
   touch ~/.claude/contexts/workflow/your-context.md
   ```

4. **Add the standard header**
   ```markdown
   # Context Name

   > Use this context for [specific use case].

   ---
   ```

5. **Extract and refine content**
   - Consolidate similar rules from multiple projects
   - Add code examples (good AND bad patterns)
   - Keep it DRY - reference other contexts if needed

6. **Update migration script patterns**
   Edit `scripts/context-migrate.zsh` to detect the new context:
   ```bash
   CONTEXT_PATTERNS[workflow/your-context]="pattern1|pattern2|keyword"
   ```

7. **Document in this README**
   Add entry to the appropriate table with description and line count

8. **Test the migration**
   ```bash
   ralph-migrate-contexts /path/to/project
   ```

### Example: Creating a Firebase Context

```bash
# 1. Check if pattern exists in multiple projects
grep -r "firebase|firestore|Cloud Functions" ~/Desktop/Gits/*/CLAUDE.md

# 2. Create the file
cat > ~/.claude/contexts/tech/firebase.md << 'EOF'
# Firebase Context

> Use this context for Firebase/Firestore projects.

---

## Firestore Security Rules
...

## Cloud Functions Patterns
...
EOF

# 3. Add detection pattern to context-migrate.zsh
# CONTEXT_PATTERNS[tech/firebase]="firebase|firestore|Cloud Functions"

# 4. Test
ralph-migrate-contexts ~/Desktop/Gits/my-firebase-project
```

---

## Context Writing Guidelines

1. **Be specific** - Include exact code examples
2. **Be concise** - Remove redundant explanations
3. **Use headers** - Make sections scannable
4. **Include anti-patterns** - Show what NOT to do
5. **Keep it DRY** - If content exists in another context, reference it

---

## Migration Guide

### From Single CLAUDE.md to Modular Contexts

1. **Identify contexts** that apply to your project
2. **Remove duplicated sections** from project CLAUDE.md
3. **Add context references** at the top
4. **Keep only project-specific rules** inline

### Before Migration
```
project/CLAUDE.md (500 lines)
├── CLAUDE_COUNTER (10 lines)           # → workflow/interactive
├── Git Safety (10 lines)               # → workflow/interactive
├── Thinking Before Doing (50 lines)    # → base
├── next-intl guide (350 lines)         # → tech/nextjs
├── Supabase migrations (50 lines)      # → tech/supabase
└── Project structure (30 lines)        # Keep (project-specific)
```

### After Migration
```
project/CLAUDE.md (50 lines)
├── Context references (5 lines)
├── Project structure (30 lines)        # Project-specific
└── Custom rules (15 lines)             # Project-specific
```

---

## Troubleshooting

### Context Not Applied
- Verify context file exists at `~/.claude/contexts/`
- Check for typos in context reference
- Ensure correct path (e.g., `tech/nextjs` not `nextjs`)

### Conflicting Rules
- Project-specific rules override shared contexts
- More specific contexts override general ones (e.g., `workflow/rtl` overrides `base` for RTL topics)

### Missing Content
- Run migration script to check for content that should be in a shared context
- Consider creating a new workflow context if pattern is used in 3+ projects

---

## Benefits

1. **Reduced duplication** - Write rules once, use everywhere
2. **Consistency** - Same patterns across all projects
3. **Easier updates** - Update one file, all projects benefit
4. **Smaller project files** - CLAUDE.md focused on project-specific content
5. **Clear organization** - Easy to find and understand rules
