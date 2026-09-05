# Cursor CLI — commit Adapter

> Capability gaps for Cursor running the commit skill.

## What Cursor CAN Do

```bash
# Stage + commit (basic flow)
git add src/my-file.ts
git commit -m "feat: description

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Pre-commit hooks run automatically — git triggers them regardless of CLI.

## Critical Gaps

| Gap | Impact | Workaround |
|-----|--------|-----------|
| No `cr review` pre-check | Commits without CodeRabbit screening | Install `cr` CLI in env; run `cr review --plain` as shell cmd |
| No Ralph mode | Can't mark story criteria atomically | Script story JSON update separately after commit succeeds |
| No skill invocation | Can't call `/commit` | Reproduce the steps manually in the prompt |

## CodeRabbit via Shell (if cr installed)

```bash
# Check if cr is available, run review before commit
which cr && cr review --plain || echo "cr not installed — skipping pre-review"

# Commit only if review passes
cr review --plain && git commit -m "feat: description"
```

## Cursor's Audit Advantage

Before committing, use Cursor's `@codebase` indexing for a pre-commit audit:

```bash
cursor agent --output-format text "Audit staged changes for bugs, type safety, security. @codebase"
```

This is not a `cr review` replacement — it's a Cursor-specific supplement.

## Ralph Mode Alternative (manual)

Cursor cannot do Ralph mode natively. Workaround if needed:

```bash
# 1. Commit
git commit -m "feat: US-106 description"

# 2. If commit succeeds, update story JSON manually
node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('prd-json/US-106.json'));
s.criteria.commit.checked = true;
fs.writeFileSync('prd-json/US-106.json', JSON.stringify(s, null, 2));
"
```

## Recommended Usage

Cursor commit is fine for standard commits (no CR pre-check required). For gated workflows (CodeRabbit or Ralph mode), use Claude.
