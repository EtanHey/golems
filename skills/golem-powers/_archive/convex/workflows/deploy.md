# Deploy Workflow

Deploy your Convex backend to production.

---

## Quick Start

Run the deploy script:

```bash
bash ~/.claude/commands/convex/scripts/deploy.sh
```

This script:
- Verifies you're in a Convex project
- Auto-cleans orphan `.js` files
- Deploys to production

---

## Options

| Flag | Purpose |
|------|---------|
| `--key <key>` | Use provided deploy key |
| `--1p` | Fetch deploy key from 1Password |
| `--dry-run` | Preview without deploying |
| `-h, --help` | Show all options |

### Examples

```bash
# Interactive deployment (will prompt for auth)
bash ~/.claude/commands/convex/scripts/deploy.sh

# With deploy key from 1Password
bash ~/.claude/commands/convex/scripts/deploy.sh --1p

# Preview what would happen
bash ~/.claude/commands/convex/scripts/deploy.sh --dry-run

# With explicit key
bash ~/.claude/commands/convex/scripts/deploy.sh --key "prod:..."
```

---

## Setting Up Deploy Key

For CI/CD or automated deployments:

1. Generate key in Convex dashboard: Settings > Deploy Keys > Generate
2. Store in 1Password:
   ```bash
   op item create --category "API Credential" --title "projectname/convex" --vault "Private" "CONVEX_DEPLOY_KEY=prod:..."
   ```
3. Use `--1p` flag to auto-retrieve

---

## Schema Migration Safety

**Warning:** Schema changes can be destructive.

Before deploying schema changes:

1. Export current data as backup:
   ```bash
   bash ~/.claude/commands/convex/scripts/export-data.sh
   ```

2. Review schema diff:
   ```bash
   git diff convex/schema.ts
   ```

3. Deploy - Convex will prompt for destructive changes.

---

## Troubleshooting

**"Schema validation failed" error?**
- Check `convex/schema.ts` for syntax errors
- Run `npx convex codegen` to see type errors

**"Unauthorized" with deploy key?**
- Verify key is for production: should start with `prod:`
- Regenerate key in dashboard if expired

**"Function not found" after deploy?**
- Ensure function is exported from a file in `convex/` directory
- Check function name matches: `filename:functionName`
