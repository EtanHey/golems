# Run Function Workflow

Execute Convex queries, mutations, and actions from the CLI.

---

## Quick Start

Run the function script:

```bash
bash ~/.claude/commands/convex/scripts/run-function.sh api:functionName
```

This script:
- Validates function path format
- Verifies you're in a Convex project
- Executes the function and formats output

---

## Options

| Flag | Purpose |
|------|---------|
| `--args <json>` | JSON arguments for the function |
| `--prod` | Run against production deployment |
| `-h, --help` | Show all options |

### Examples

```bash
# Simple query
bash ~/.claude/commands/convex/scripts/run-function.sh api:listMessages

# Query with arguments
bash ~/.claude/commands/convex/scripts/run-function.sh api:getMessage --args '{"messageId": "k97abc123"}'

# Mutation
bash ~/.claude/commands/convex/scripts/run-function.sh api:createMessage --args '{"body": "Hello"}'

# Against production
bash ~/.claude/commands/convex/scripts/run-function.sh api:getStats --prod
```

---

## Function Path Format

Path format is `filename:functionName`:

- `api:listUsers` - `listUsers` function in `convex/api.ts`
- `tasks:create` - `create` function in `convex/tasks.ts`
- `internal:cleanup` - `cleanup` function in `convex/internal.ts`

**No `.ts` extension in the path!**

---

## Function Types

| Type | Purpose | Example |
|------|---------|---------|
| Query | Read-only, no side effects | `api:getUser` |
| Mutation | Modifies database | `api:createUser` |
| Action | Can call external APIs | `api:sendEmail` |

---

## Troubleshooting

**"Function not found" error?**
- Check function is exported: `export const functionName = ...`
- Verify path format: `filename:functionName`
- Ensure file is in `convex/` directory

**"Invalid arguments" error?**
- Arguments must be valid JSON (use double quotes)
- Check argument types match function definition

**"Unauthorized" error?**
- Run `npx convex login`
- Or provide deploy key for production access
