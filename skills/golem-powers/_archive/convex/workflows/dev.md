# Dev Server Workflow

Start the Convex development server with hot reload.

---

## Quick Start

Run the dev script:

```bash
bash ~/.claude/commands/convex/scripts/dev.sh
```

This script:
- Verifies you're in a Convex project
- Auto-cleans orphan `.js` files (prevents "Two output files" error)
- Starts `npx convex dev` with hot reload

---

## Options

| Flag | Purpose |
|------|---------|
| `--deployment <name>` | Connect to specific deployment |
| `--no-codegen` | Skip type generation |
| `-h, --help` | Show all options |

### Examples

```bash
# Standard dev server
bash ~/.claude/commands/convex/scripts/dev.sh

# Specific deployment
bash ~/.claude/commands/convex/scripts/dev.sh --deployment my-project-dev

# Without type generation
bash ~/.claude/commands/convex/scripts/dev.sh --no-codegen
```

---

## Running Alongside Frontend

Typically run in a separate terminal from your frontend dev server:

**Terminal 1 - Convex backend:**
```bash
bash ~/.claude/commands/convex/scripts/dev.sh
```

**Terminal 2 - Frontend (e.g., Next.js):**
```bash
npm run dev
```

---

## Troubleshooting

**"Not logged in" error?**
```bash
npx convex login
```

**"Project not linked" error?**
```bash
npx convex dev --configure
```

**Types not updating?**
```bash
npx convex codegen
```
