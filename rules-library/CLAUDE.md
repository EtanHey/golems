# Rules Library

**Exportable collection of rules and contexts for Claude Code projects.**

## How It Works

1. **Auto-loaded rules** live in each repo's `.claude/rules/` — Claude Code loads them automatically
2. **This library** (`rules-library/`) is the master collection you export FROM
3. To use a rule in another project: copy or symlink the file into that project's `.claude/rules/`

## Directory Structure

```
rules-library/
├── base.md              # Core rules for all projects
├── golem-system.md      # Golem philosophy and architecture
├── golem-ecosystem.md   # Full ecosystem reference
├── skill-index.md       # Available skills (auto-generated)
├── skill-descriptions.md # Skill descriptions
├── skill-authoring.md   # How to write skills
├── tech/                # Technology-specific rules
│   ├── convex.md
│   ├── ink.md           # Ink CLI keyboard/stdin rules
│   ├── nextjs.md
│   ├── react-native.md
│   └── supabase.md
├── workflow/            # Workflow rules
│   ├── interactive.md   # Interactive session rules
│   ├── ralph.md         # Ralph autonomous execution
│   ├── design-system.md # Component guidelines
│   ├── pr-review.md     # PR review workflow
│   ├── rtl.md           # RTL layout rules
│   └── testing.md       # Testing standards
├── claude-chat/         # Claude.ai project files
└── templates/           # Templates for new rules
```

## Export Example

```bash
# Copy a tech rule to another project:
cp ~/Gits/golems/rules-library/tech/nextjs.md ~/Gits/myproject/.claude/rules/nextjs.md

# Or symlink for auto-updates:
ln -sf ~/Gits/golems/rules-library/tech/nextjs.md ~/Gits/myproject/.claude/rules/nextjs.md
```
