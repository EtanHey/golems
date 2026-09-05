# Data Export Workflow

Export data from your Convex database.

---

## Quick Start

Run the export script:

```bash
bash ~/.claude/commands/convex/scripts/export-data.sh
```

This script:
- Verifies you're in a Convex project
- Creates a timestamped backup file automatically
- Confirms if overwriting existing file

---

## Options

| Flag | Purpose |
|------|---------|
| `--path <file>` | Custom output path (default: `convex-backup-TIMESTAMP.zip`) |
| `--prod` | Export from production deployment |
| `-h, --help` | Show all options |

### Examples

```bash
# Auto-named backup with timestamp
bash ~/.claude/commands/convex/scripts/export-data.sh

# Custom filename
bash ~/.claude/commands/convex/scripts/export-data.sh --path ./my-backup.zip

# Export production data
bash ~/.claude/commands/convex/scripts/export-data.sh --prod
```

---

## What Gets Exported

- All tables and their documents
- File storage metadata
- **Does NOT export** actual files in storage

---

## Inspect Exported Data

After exporting:

```bash
# Unzip
unzip ./convex-backup-*.zip -d ./backup-contents

# View tables
ls ./backup-contents/

# View table data (requires jq)
cat ./backup-contents/messages.json | jq '.' | head -50
```

---

## Troubleshooting

**"Not logged in" error?**
```bash
npx convex login
```

**"Permission denied" on path?**
- Check write permissions on target directory
- Use absolute path if relative path fails

**Export is empty?**
- Verify you're exporting from correct deployment (dev vs prod)
- Check if database has data: `npx convex dashboard`
