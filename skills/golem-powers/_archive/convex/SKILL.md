---
name: convex
description: "Manage Convex backend operations including dev server lifecycle, cloud deployments, function execution, schema management, and data import/export. Wraps the npx convex CLI with project-specific configuration. Includes workflows for starting local dev, deploying to production, running one-off functions, exporting/importing data snapshots, and managing environment variables. Use when starting a Convex dev server, deploying backend changes, running mutations or queries, managing Convex schema, or debugging Convex function errors. Triggers on 'convex', 'backend deploy', 'run function', 'schema change', 'convex dev'. NOT for: Supabase or Firebase operations (use respective tools), frontend-only React work, or general database queries."
paths:
  - "convex/**/*.ts"
  - "convex/**/*.tsx"
  - "convex.json"
---

# Convex Operations

> Backend skill wrapping `npx convex` CLI. Routes to workflows for specific operations.

## Project Detection

Run first to verify you're in a Convex project:
```bash
[ -d "convex" ] && echo "Convex project detected" || echo "ERROR: No convex/ directory found"
```

If no `convex/` directory: Run `npx convex init` to initialize.

---

## Quick Actions

| What you want to do | Workflow |
|---------------------|----------|
| Start dev server | [workflows/dev.md](workflows/dev.md) |
| Deploy to production | [workflows/deploy.md](workflows/deploy.md) |
| Run a Convex function | [workflows/run-function.md](workflows/run-function.md) |
| Export data | [workflows/data-export.md](workflows/data-export.md) |
| Import data | [workflows/data-import.md](workflows/data-import.md) |
| Inspect/validate schema | [workflows/schema.md](workflows/schema.md) |
| Delete user and all data | [workflows/user-deletion.md](workflows/user-deletion.md) |
| Fix errors | [workflows/troubleshooting.md](workflows/troubleshooting.md) |

---

## Available Scripts

Execute directly - they handle errors and edge cases:

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/dev.sh` | Start dev server with auto-cleanup | `bash ~/.claude/commands/convex/scripts/dev.sh [--deployment <name>]` |
| `scripts/deploy.sh` | Deploy to production | `bash ~/.claude/commands/convex/scripts/deploy.sh [--1p] [--dry-run]` |
| `scripts/run-function.sh` | Execute queries/mutations/actions | `bash ~/.claude/commands/convex/scripts/run-function.sh api:funcName [--args '{}']` |
| `scripts/export-data.sh` | Export database backup | `bash ~/.claude/commands/convex/scripts/export-data.sh [--path <file>]` |
| `scripts/import-data.sh` | Import data (with safety prompts) | `bash ~/.claude/commands/convex/scripts/import-data.sh --path <file.zip>` |

---

## Common Commands Reference

```bash
# Development
npx convex dev                    # Start dev server with hot reload

# Deployment
npx convex deploy                 # Deploy to production

# Functions
npx convex run api:functionName   # Run a function
npx convex run api:func --arg '{"key":"value"}'  # With arguments

# Data
npx convex export --path ./backup.zip   # Export all data
npx convex import --path ./backup.zip   # Import data

# Environment
npx convex env list               # List env vars
npx convex env set KEY=value      # Set env var
npx convex env get KEY            # Get env var

# Other
npx convex dashboard              # Open dashboard in browser
npx convex codegen                # Regenerate types
npx convex logs --name prod       # View production logs
```

---

## Safety Rules

1. **Always check project** - Verify `convex/` directory exists before running commands
2. **Deploy key for CI** - Production deploys need `CONVEX_DEPLOY_KEY` (see deploy workflow)
3. **Backup before import** - Always export before importing data
4. **Review schema changes** - Schema migrations can be destructive

---

## 🚨 CRITICAL: Auto-Clean Before Any Convex Command

**ALWAYS prefix Convex commands with this cleanup:**

```bash
rm -f convex/*.js 2>/dev/null; npx convex dev
```

### The "Two output files" Error

If you see:
```
✘ [ERROR] Two output files share the same path but have different contents: out/auth.js
```

**Cause:** Orphan `.js` files in `convex/` folder (from git worktrees, crashes, or manual operations).

**Fix:** `rm -f convex/*.js` then retry.

**Prevention:** Always use the cleanup prefix. Only `.ts` files belong in convex/.

See [workflows/troubleshooting.md](workflows/troubleshooting.md) for details.
