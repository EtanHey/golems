# Project Setup Header Template

> Copy and customize this template for your project's CLAUDE.md setup section.

---

## Example Usage

Add this section at the TOP of your project's CLAUDE.md:

```markdown
## SETUP (AI: Read This First)

**Purpose:** [What this repo does - 1-2 sentences]

**Quick Start:**
1. [First step to understand the codebase]
2. [Second step]
3. [Any other essential steps]

**Skills Available:** Use `/golem-powers:skills` to see available skills. Key ones for this project:
- `/golem-powers:skill-name` - What it does
- `/golem-powers:another-skill` - What it does

**Self-Improvement Loop:** When working on this repo, you ARE dogfooding the tools you build:
- Skills you create → used by future Claude sessions
- Contexts you write → loaded into future CLAUDE.md files
- Bugs you find → should become PRD stories

**Contexts:** See @context: refs below for inherited rules.
```

---

## Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `[Purpose]` | Brief repo description | "Ralph tooling - autonomous PRD execution" |
| `[Quick Start]` | Essential first steps | "1. Read file tree, 2. Check lib/README.md" |
| `[Skills]` | Project-relevant skills | "/golem-powers:prd, /golem-powers:convex, /golem-powers:coderabbit" |
| `[Self-Improvement]` | If applicable, dogfooding notes | Skills, contexts, or tools you build here |

---

## Why This Header?

1. **Immediate context** - Claude knows what the repo does instantly
2. **Skill discovery** - Points to relevant skills for this project
3. **Self-awareness** - Reminds AI when it's dogfooding its own tools
4. **Layered context** - @context refs explain where rules come from
