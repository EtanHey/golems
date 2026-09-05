# Data Import Workflow

Import data into your Convex database.

---

## Quick Start

Run the import script:

```bash
bash ~/.claude/commands/convex/scripts/import-data.sh --path ./backup.zip
```

This script:
- Verifies you're in a Convex project
- **Prompts for backup confirmation** (safety first!)
- Imports data with clear success/error output

---

## Options

| Flag | Purpose |
|------|---------|
| `--path <file>` | Input file path (required) |
| `--prod` | Import to production deployment |
| `--replace` | Replace existing data (otherwise appends) |
| `--force` | Skip confirmation prompts |
| `-h, --help` | Show all options |

### Examples

```bash
# Standard import (appends to existing data)
bash ~/.claude/commands/convex/scripts/import-data.sh --path ./backup.zip

# Replace all existing data (dangerous!)
bash ~/.claude/commands/convex/scripts/import-data.sh --path ./backup.zip --replace

# Import to production
bash ~/.claude/commands/convex/scripts/import-data.sh --path ./backup.zip --prod

# Skip prompts (for automation)
bash ~/.claude/commands/convex/scripts/import-data.sh --path ./backup.zip --force
```

---

## Import Modes

| Mode | Behavior |
|------|----------|
| Default (append) | Adds new documents, fails on ID conflicts |
| `--replace` | **Deletes all existing data** in imported tables, then imports |

**Warning:** `--replace` is destructive. Always backup first!

---

## Safety Checklist

Before importing:

1. **Create a backup:**
   ```bash
   bash ~/.claude/commands/convex/scripts/export-data.sh
   ```

2. **Verify the import file** contains what you expect

3. **Double-check target deployment** (dev vs prod)

The script will prompt for these confirmations unless `--force` is used.

---

## Troubleshooting

**"Schema validation failed" error?**
- Imported data must match your current schema
- Check field types match: `convex/schema.ts`

**"Document already exists" error?**
- Document IDs conflict with existing data
- Use `--replace` to overwrite (dangerous!)
- Or modify IDs in the import file

**"Not logged in" error?**
```bash
npx convex login
```
