# Review Workflow

Standard code review with CodeRabbit.

## Quick Start

Run the review script directly:

```bash
./scripts/review.sh
```

This outputs a Markdown-formatted review with quick action links.

## Steps

### Step 1: Determine what to review

```bash
# Check git status
git status --short
```

Options:
- `--type all` (default) - All changes since last push
- `--type committed` - Only committed changes
- `--type uncommitted` - Only staged/unstaged changes

### Step 2: Run review

**Using the script (recommended):**
```bash
./scripts/review.sh
```

**Manual alternative:**
```bash
cr review --plain           # For humans
cr review --prompt-only     # For AI agents
cr review --plain --base main  # Against specific branch
```

### Step 3: Interpret results

CodeRabbit returns:
- **Critical issues** - Must fix (security, bugs)
- **Suggestions** - Should consider (style, performance)
- **Nitpicks** - Optional (formatting, naming)

### Step 4: Apply fixes

For each critical/suggestion:
1. Read the recommendation
2. Apply the fix
3. Re-run `./scripts/review.sh` to verify

## Related Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/security.sh` | Security-focused scan |
| `./scripts/secrets.sh` | Secret detection |
| `./scripts/accessibility.sh` | A11y audit |
| `./scripts/pr-ready.sh` | Full PR check |

## Common Flags (manual mode)

| Flag | Description |
|------|-------------|
| `--plain` | Detailed human output |
| `--prompt-only` | Minimal AI-friendly output |
| `--type <t>` | all, committed, uncommitted |
| `--base <branch>` | Compare against branch |
| `--config <file>` | Use custom config |
