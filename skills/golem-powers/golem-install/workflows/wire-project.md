# Wire Project Workflow

Add a new project to the Ralph ecosystem with registry entry, contexts, and launcher functions.

---

## Prerequisites

- Ralph installed and working (`ralph-help` shows commands)
- Project directory exists
- Know which MCPs and contexts the project needs

---

## Step 1: Detect Recommended Contexts

Run context-audit in your project to auto-detect tech stack:

```bash
cd /path/to/your/project
# In Claude Code:
/context-audit
```

This will analyze your project and suggest contexts like:
- `tech/nextjs` for Next.js projects
- `tech/supabase` for Supabase integration
- `workflow/rtl` for Hebrew/Arabic UI
- etc.

---

## Step 2: Add Project to Registry

Edit `~/.config/golems/registry.json`:

```bash
# Open in editor
code ~/.config/golems/registry.json
# or
nano ~/.config/golems/registry.json
```

Add your project entry to the `projects` object:

```json
{
  "projects": {
    "existingproject": { ... },
    "mynewproject": {
      "path": "/absolute/path/to/mynewproject",
      "displayName": "My New Project",
      "mcps": ["Context7", "browser-tools"],
      "mcpsLight": ["Context7"],
      "contexts": [
        "base",
        "skill-index",
        "workflow/interactive"
      ],
      "secrets": {},
      "created": "2026-01-25T00:00:00Z"
    }
  }
}
```

---

## Step 3: Configure Contexts

Choose contexts based on your tech stack:

### Universal (Add to All Projects)

```json
"contexts": [
  "base",           // Scratchpad, AIDEV-NOTE, type safety rules
  "skill-index",    // Available skills reference
  "workflow/interactive"  // Interactive Claude rules
]
```

### Tech Stack Contexts

| Technology | Context | Description |
|-----------|---------|-------------|
| Next.js | `tech/nextjs` | App router, server components, Next.js patterns |
| React Native | `tech/react-native` | Expo, mobile patterns |
| Supabase | `tech/supabase` | Auth, database, realtime patterns |
| Convex | `tech/convex` | Functions, queries, mutations |

### Workflow Contexts

| Context | When to Use |
|---------|-------------|
| `workflow/rtl` | Hebrew/Arabic UI (right-to-left layouts) |
| `workflow/testing` | Test-heavy projects |
| `workflow/design-system` | Component library development |

---

## Step 4: Configure MCPs

Add MCPs from `mcpDefinitions` in the registry:

```json
"mcps": ["Context7", "browser-tools", "supabase"],
"mcpsLight": ["Context7"]  // For faster startup
```

Available MCPs:
- `Context7` - Library documentation lookup
- `browser-tools` - Browser automation
- `supabase` - Supabase MCP (requires secret)
- `linear` - Linear issue tracking (requires secret)
- `figma-local` / `figma-remote` - Figma integration
- `tempmail` - Temporary email for testing

---

## Step 5: Configure Secrets (Optional)

For MCPs that need secrets, use 1Password references:

```json
"secrets": {
  "SUPABASE_ACCESS_TOKEN": "op://VaultName/supabase/ACCESS_TOKEN",
  "LINEAR_API_TOKEN": "op://VaultName/linear/API_TOKEN"
}
```

Or store tokens in 1Password first:
```bash
op item create --category "API Credential" --vault "MyVault" --title "myproject-secrets"
op item edit "myproject-secrets" "SUPABASE_ACCESS_TOKEN[concealed]=sbp_yourtoken"
```

---

## Step 6: Regenerate Launchers

After saving registry.json, regenerate launcher functions:

```bash
# In any terminal with Ralph loaded
_ralph_generate_launchers_from_registry
```

This creates:
- `runMynewproject()` - Start dev server
- `openMynewproject()` - Change to project directory
- `mynewprojectClaude()` - Launch Claude with MCPs and contexts

---

## Step 7: Verify

```bash
# Source the new launchers
source ~/.config/golems/launchers.zsh

# Test the launcher
mynewprojectClaude
```

You should see Claude start with your configured MCPs loaded.

---

## Complete Example

For a Next.js + Supabase project:

```json
"myapp": {
  "path": "$HOME/projects/myapp",
  "displayName": "MyApp",
  "mcps": ["Context7", "browser-tools", "supabase"],
  "mcpsLight": ["Context7"],
  "contexts": [
    "base",
    "skill-index",
    "tech/nextjs",
    "tech/supabase",
    "workflow/interactive"
  ],
  "secrets": {
    "SUPABASE_ACCESS_TOKEN": "op://MyApp/supabase/ACCESS_TOKEN"
  },
  "created": "2026-01-25T00:00:00Z"
}
```

---

## Troubleshooting

### Launcher not available after regenerating

```bash
# Source the launchers file
source ~/.config/golems/launchers.zsh

# Verify it was created
cat ~/.config/golems/launchers.zsh | grep myproject
```

### Contexts not loading

Check the contexts exist:
```bash
ls ~/.claude/contexts/base.md
ls ~/.claude/contexts/workflow/interactive.md
```

If missing, symlink from golems:
```bash
ln -sf ~/.config/golems/contexts/* ~/.claude/contexts/
```

### MCPs not connecting

1. Check MCP is defined in `mcpDefinitions`
2. Verify secrets are accessible: `op read "op://VaultName/item/field"`
3. Check MCP server is installed: `which npx`

---

## Next Steps

1. **Test your launcher**: `myprojectClaude`
2. **Create a PRD**: `/prd Add feature X`
3. **Run Ralph**: `ralph 20` (20 iterations)
