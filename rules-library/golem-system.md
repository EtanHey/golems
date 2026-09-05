# Golem System Context

> Understanding the philosophy and architecture of the claude-golem/Ralph ecosystem. This context is for contributors, maintainers, and users who want to understand the "why" behind the system.

---

## What is the Golem?

The "Golem" is the name for our AI-assisted development ecosystem. It consists of:

1. **Ralph** - The autonomous coding loop that executes PRD stories
2. **BrainLayer** (Memory) - The persistent memory layer that indexes conversations for search/retrieval
3. **Skills** - Reusable capabilities that extend Claude's abilities
4. **Contexts** - Modular instruction sets that shape Claude's behavior

The name "Golem" comes from Jewish folklore - a being animated to serve its creator. Like the mythical golem, Ralph is awakened with instructions (PRD) and executes tasks autonomously until complete.

---

## Core Philosophy

### 1. Death and Rebirth

Ralph "dies" after each iteration. Every new iteration is a fresh Claude session with no memory of previous work. This is by design:

- **Prevents drift** - Each iteration follows the current PRD exactly
- **Enables recovery** - Crashed sessions don't corrupt state
- **Forces discipline** - All state must be persisted to files

The PRD (index.json, stories/*.json) and progress.txt are Ralph's "memories" that survive death.

### 2. Single Source of Truth

Everything important lives in files:
- **PRD state** → `prd-json/index.json` and `prd-json/stories/*.json`
- **Progress** → `progress.txt`
- **Learnings** → `docs.local/learnings/`
- **Context** → `CLAUDE.md` + `contexts/`
- **Deferred actions** → `~/.claude/farther-steps.json`

Claude's internal context is ephemeral. Files are permanent.

#### Farther-Steps (Deferred Actions Queue)

When you identify work that needs human review or later sync, add to `~/.claude/farther-steps.json`:

```json
{
  "id": "step-XXX",
  "type": "sync",
  "source": "path/to/source",
  "target": "path/to/target",
  "reason": "Detailed explanation",
  "story": "US-XXX",
  "criteria": "Related criteria",
  "status": "pending",
  "priority": "high|medium|low"
}
```

**Use cases:**
- Syncing files between `~/.claude/` and repo (bidirectional)
- Config changes that need review before applying
- Quality improvements to track even if not used immediately

**CLI:** `scripts/farther-steps.sh [pending|apply|done|skip|clean]`

### 3. Incremental Progress

Ralph completes ONE task per iteration, then commits. This ensures:
- Small, reviewable commits
- Easy rollback if something goes wrong
- Clear audit trail of what changed when

### 4. Human in the Loop

Ralph is powerful but not autonomous. The human:
- Writes PRD stories (what to do)
- Runs Ralph (when to do it)
- Reviews commits (did it work?)
- Unblocks issues (when stuck)

This is intentional - full autonomy is dangerous.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Shell                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ralph [N]                                                   ││
│  │    ↓                                                         ││
│  │  ralph.zsh (orchestrator)                                    ││
│  │    ├── Sources lib/*.zsh modules                             ││
│  │    ├── Reads PRD state                                       ││
│  │    ├── Selects model based on story type                     ││
│  │    └── Spawns Claude with prompt                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Claude CLI (claude -p "...")                                ││
│  │    ├── Receives Ralph Base Prompt + AGENTS.md                ││
│  │    ├── Reads story JSON, works through criteria              ││
│  │    ├── Uses Skills when needed                               ││
│  │    ├── Updates story JSON incrementally                      ││
│  │    └── Commits when done                                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Post-Iteration                                              ││
│  │    ├── Parse Claude output                                   ││
│  │    ├── Check for completion signals                          ││
│  │    ├── Update costs tracking                                 ││
│  │    ├── Send notifications (if configured)                    ││
│  │    └── Loop or exit based on PRD state                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Deep Dive

### Ralph (ralph.zsh + lib/*.zsh)

The orchestration layer. Written in zsh for:
- Fast startup
- Direct shell integration
- Easy debugging

Key modules:
- **ralph-commands.zsh** - Helper commands (ralph-session, jqf)
- **ralph-models.zsh** - Model selection, cost tracking, notifications
- **ralph-registry.zsh** - Project configuration management
- **ralph-secrets.zsh** - 1Password integration
- **ralph-setup.zsh** - Interactive setup wizard
- **ralph-ui.zsh** - Colors, formatting, progress display
- **ralph-watcher.zsh** - File watching, orphan process cleanup
- **ralph-worktrees.zsh** - Git worktree session isolation

### TypeScript Core (bun/core/)

Reusable logic extracted to TypeScript for:
- Type safety
- Unit testing
- Reuse in future web UI

Modules:
- **config.ts** - Configuration loading and defaults
- **models.ts** - Model routing logic
- **costs.ts** - Cost calculation and tracking
- **stories.ts** - PRD/story CRUD operations
- **claude.ts** - Claude CLI spawning and output parsing

### Contexts (contexts/)

Modular instruction sets that shape Claude's behavior:
- **base.md** - Universal rules (all projects)
- **workflow/interactive.md** - Interactive session rules
- **workflow/ralph.md** - Ralph autonomous execution rules
- **tech/*.md** - Technology-specific patterns

Key principle: **One fix, many benefits** - improving a context helps all projects using it.

### Skills (skills/golem-powers/)

Reusable capabilities Claude can invoke:
- **/golem-powers:prd** - Create/manage PRDs
- **/golem-powers:coderabbit** - AI code review
- **/golem-powers:ralph-commit** - Atomic commit with verification
- **/golem-powers:github** - Git and GitHub operations
- **/golem-powers:1password** - Secrets management
- And many more...

Skills are invoked via the `Skill` tool, not by reading files directly.

---

## BrainLayer (Memory System)

[BrainLayer](https://github.com/EtanHey/brainlayer) (formerly "Zikaron", Hebrew for "memory") is the persistent memory layer for Claude Code:

### Current Implementation

1. **CLAUDE.md** - Project-level instructions that persist
2. **contexts/** - Shared knowledge across projects
3. **docs.local/learnings/** - Project-specific discoveries
4. **progress.txt** - Iteration history and notes

### How Learning Works

```
┌──────────────────────┐
│  Claude encounters   │
│  a problem/pattern   │
├──────────────────────┤
│  Solves it           │
├──────────────────────┤
│  Decision Point:     │
│  Is this reusable?   │
├──────────────────────┤
    │          │
    YES        NO
    │          │
    ▼          ▼
┌────────┐  ┌────────┐
│ Update │  │ Keep   │
│context/│  │ local  │
│learning│  │ only   │
└────────┘  └────────┘
```

### Future Vision

The BrainLayer system should evolve to:
- Automatically extract learnings from successful iterations
- Weight learnings by recency and relevance
- Share learnings across projects when appropriate
- Detect and resolve conflicting learnings

---

## Story Types and Model Routing

Ralph uses different models for different story types:

| Prefix | Type | Default Model | Reasoning |
|--------|------|---------------|-----------|
| US-* | User Story | sonnet | Balanced capability/cost |
| V-* | Verification | haiku | Quick checks, low cost |
| TEST-* | E2E Test | haiku | Repetitive, template-based |
| BUG-* | Bug Fix | sonnet | Needs investigation |
| AUDIT-* | Audit | opus | Requires deep analysis |
| MP-* | Master Plan | opus | Architecture decisions |

This routing is configurable via `config.json` or story-level overrides.

---

## The PRD System

PRD (Product Requirements Document) is Ralph's task queue:

### Structure

```
prd-json/
├── index.json           # State: pending, blocked, nextStory, stats
├── stories/
│   ├── US-001.json      # Individual story with criteria
│   ├── V-001.json
│   └── BUG-001.json
└── update.json          # (optional) Queue for adding stories mid-run
```

### Story Lifecycle

```
                    ┌─────────┐
                    │ Created │
                    └────┬────┘
                         │
                         ▼
                    ┌─────────┐
                    │ Pending │◄──────────────────┐
                    └────┬────┘                   │
                         │                        │
                         ▼                        │
                    ┌─────────┐    Blocker      │
           ┌───────►│ Working │───resolved──────┘
           │        └────┬────┘
           │             │
    Retry  │             │ All criteria checked
           │             ▼
           │        ┌─────────┐
           └────────┤ Blocked │
                    └─────────┘
                         │
                         │ Unblocked
                         ▼
                    ┌─────────┐
                    │Complete │
                    └─────────┘
```

### Acceptance Criteria

Each story has acceptance criteria that Ralph checks off:

```json
{
  "acceptanceCriteria": [
    {"text": "Create database migration for users table", "checked": false},
    {"text": "Add TypeScript types for User entity", "checked": false},
    {"text": "Run CodeRabbit review - must pass", "checked": false},
    {"text": "Commit: feat: US-001 add user management", "checked": false}
  ]
}
```

The last two criteria (CodeRabbit + Commit) are **mandatory** for every story.

---

## Key Design Decisions

### Why zsh over Python/Node?

- Zero startup time
- Direct shell integration (git, jq, curl)
- Easy to debug interactively
- No dependency management

### Why JSON PRD over Markdown?

- Machine-readable
- Easy to query with jq
- Supports incremental updates
- Type-safe with TypeScript

### Why One Task Per Iteration?

- Atomic commits
- Easy rollback
- Clear progress tracking
- Prevents runaway sessions

### Why CodeRabbit Before Every Commit?

- Catches issues early
- Consistent code quality
- Documents intentional deviations
- Builds a knowledge base of project patterns

---

## Contributing to the Golem

### When to Update Contexts

- Pattern appears in 3+ projects
- Content is 50+ lines
- Rules are reusable

### When to Create Skills

- Operation is repeatable
- Has clear inputs/outputs
- Benefits from encapsulation

### When to Update Ralph Core

- Affects all projects
- Can't be solved with contexts/skills
- Requires orchestration changes

---

## Anti-Patterns to Avoid

1. **Hardcoding project-specific logic in ralph.zsh** - Use contexts instead
2. **Skipping CodeRabbit** - Tech debt accumulates
3. **Large stories** - Break into smaller pieces
4. **Ignoring blockers** - Fix them or create follow-up stories
5. **Global state in Claude sessions** - It won't survive iteration death

---

## Future Directions

See `docs.local/ralph-ideas.md` for a comprehensive list of improvement ideas, prioritized by effort and impact.
