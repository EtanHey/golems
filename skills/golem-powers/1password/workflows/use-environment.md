# Using 1Password Environments

> Workflow for setting up and using 1Password Environments to manage secrets

## Overview

1Password Environments (Beta) is the **preferred method** for managing `.env` files. Unlike CLI-based approaches, Environments are configured entirely through the 1Password desktop app UI, then accessed via mounted named pipes or `op run`.

## Key Insight: UI vs CLI

| Aspect | Environments (Desktop App) | CLI (`op inject`, `op run`) |
|--------|---------------------------|----------------------------|
| **Creation** | UI only (not automatable) | Scriptable |
| **Secret Storage** | Environment in 1Password | Items in vaults |
| **Local Access** | Named pipe mount (never on disk) | Temp file or env vars |
| **Team Sync** | Real-time via 1Password sync | Manual sync needed |
| **Best For** | Local development | CI/CD, scripts |

## Setting Up an Environment (One-Time)

### 1. Enable Developer Features

1. Open **1Password desktop app**
2. Go to **Settings** > **Developer**
3. Enable **Developer Experience**
4. Enable **Integrate with 1Password CLI** (optional, for combined workflows)

### 2. Create Environment

1. In sidebar, click **Developer** > **Environments**
2. Click **New Environment**
3. Name it (e.g., `myproject-dev`, `golems`)
4. Choose which account/vault to store it in

### 3. Add Variables

**Option A: Import from .env file**
- Click **Import** and select your `.env` file
- Variables are imported with their values

**Option B: Manual entry**
- Click **New variable**
- Enter key-value pairs

### 4. Configure Local Mount (Recommended)

1. Go to **Destinations** tab
2. Select **Local .env file**
3. Set the mount path (e.g., `/path/to/project/.env.local`)
4. Click **Mount .env file**
5. Authorize when prompted

**Important**: If you had an existing `.env.local` file tracked in git, delete and commit the deletion first.

### 5. Team Access (Optional)

1. Go to **Access** tab
2. Add team members with permissions:
   - **View only**: Can read secrets
   - **View & Edit**: Can modify variables
   - **Manage access**: Can add/remove team members

## How Mounted Files Work

### Named Pipe Architecture

```
┌─────────────────────┐
│ Your App            │
│ (reads .env.local)  │
└─────────┬───────────┘
          │ read()
          ▼
┌─────────────────────┐
│ Named Pipe          │
│ (not a real file)   │
└─────────┬───────────┘
          │ on-demand
          ▼
┌─────────────────────┐
│ 1Password App       │
│ (serves secrets)    │
└─────────────────────┘
```

**Security benefits:**
- Secrets never written to disk
- Contents exist only during read
- No plaintext file to accidentally commit
- Authorization required on each lock/unlock

### Limitations

| Limitation | Details |
|------------|---------|
| **Platform** | Mac and Linux only (no Windows) |
| **Max files** | 10 mounted .env files per device |
| **Concurrent reads** | May have conflicts with multiple processes |
| **Offline** | Limited to last synced contents |
| **Beta status** | Feature may change |

## Environments vs op inject/run

### When to Use Environments

- **Local development** - daily dev work
- **Multiple developers** - team needs same secrets
- **Sensitive secrets** - never want on disk
- **Frequent changes** - secrets update often

### When to Use CLI (op inject/run)

- **CI/CD pipelines** - automated deployments
- **One-time scripts** - need secrets in scripts
- **Template-based config** - `.yml.tpl` files
- **Service Accounts** - non-interactive access

### Combining Both Approaches

You can use Environments for local dev and CLI for CI/CD:

```bash
# Local: App reads from mounted .env.local (from Environment)
npm run dev

# CI/CD: Use op run with secret references
op run --env-file .env.template -- npm run build
```

**.env.template** (safe to commit):
```
DATABASE_URL=op://myproject/db/connection_string
API_KEY=op://myproject/api/key
```

## Example: golems Configuration

The `golems` config could use Environments:

### Setup

1. Create Environment: `golems` in your 1Password
2. Add variables:
   - `NTFY_TOPIC` - notification topic
   - `ANTHROPIC_API_KEY` - for Claude model calls
   - `LINEAR_API_KEY` - if using Linear integration
3. Mount to: `~/.config/golems/.env`

### Usage in Scripts

```bash
# golems reads from mounted .env automatically
source ~/.config/golems/.env
ralph 10

# Or use op run if Environments not set up
op run --env-file ~/.config/golems/.env.template -- ralph 10
```

### Migration from Existing Config

If you have `~/.config/golems/config.json` with secrets:

1. Create `golems` Environment in 1Password
2. Add each secret as a variable
3. Mount to `~/.config/golems/.env`
4. Update scripts to read from `.env`

## Troubleshooting

### "File not found" when reading mounted .env

- Ensure 1Password desktop app is running
- Check if mount destination is correct
- Verify environment is enabled (toggle in Environments list)

### Changes to mounted file not persisting

**Expected behavior!** Mounted files are read-only named pipes. Edit variables in the 1Password UI.

### Multiple processes can't read simultaneously

Named pipes have concurrent read limitations. Options:
- Use `op run` instead for multi-process scenarios
- Have one process export to env vars for others

### Team member can't access environment

- Check they have the correct account access
- Verify permissions in Access tab
- Ensure they've synced their 1Password app

## References

- [1Password Environments Docs](https://developer.1password.com/docs/environments/)
- [Local .env File Destination](https://developer.1password.com/docs/environments/local-env-file/)
- [1Password Environments Blog](https://1password.com/blog/1password-environments-env-files-public-beta)
- [op run Documentation](https://developer.1password.com/docs/cli/secrets-environment-variables/)
- [Secret References](https://developer.1password.com/docs/cli/secret-references/)
