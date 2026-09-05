# Convex Troubleshooting

Common errors and fixes for Convex development.

---

## "Two output files share the same path" Error

**Error message:**
```
✘ [ERROR] Two output files share the same path but have different contents: out/filename.js
```

### What Causes It

Convex bundler (esbuild) finds BOTH `.ts` AND `.js` files with the same name in the `convex/` folder. This happens when:

1. **Git worktrees are created** - Copies compiled .js files alongside .ts source files
2. **Convex crashes mid-compilation** - Leaves orphan .js files behind
3. **Manual file operations** - Accidentally creates .js duplicates

### Immediate Fix

Run:
```bash
rm -f convex/*.js
```

Then retry your Convex command.

### Prevention: Always Auto-Clean

**ALWAYS prefix Convex commands with cleanup:**

```bash
# Dev server
rm -f convex/*.js 2>/dev/null; npx convex dev

# Deploy
rm -f convex/*.js 2>/dev/null; npx convex deploy

# Codegen
rm -f convex/*.js 2>/dev/null; npx convex codegen
```

### Why This Is Safe

Only `.ts` files belong in the `convex/` folder. Any `.js` files are:
- Compilation artifacts from esbuild
- Orphaned from previous runs
- Should NOT be committed to git

The `convex/*.js` pattern should be in `.gitignore`:
```
# In .gitignore
convex/*.js
```

### For Automated Workflows (Ralph, CI)

Add this to the START of any iteration that uses Convex:
```bash
# Clean Convex before starting (always safe)
rm -f convex/*.js 2>/dev/null || true
```

---

## "Not logged in" Error

**Error message:**
```
Error: Not logged in. Run `npx convex login` to authenticate.
```

### Fix

Run:
```bash
npx convex login
```

This opens browser for authentication.

---

## "Project not linked" Error

**Error message:**
```
Error: Project not configured. Run `npx convex init` to set up.
```

### Fix - New Project

Run:
```bash
npx convex init
```

### Fix - Link to Existing Project

Run:
```bash
npx convex dev --configure
```

Then select your existing Convex project from the list.

---

## Types Not Updating

If TypeScript types seem stale:

Run:
```bash
rm -f convex/*.js 2>/dev/null; npx convex codegen
```

This regenerates all types from your schema.

---

## Schema Migration Issues

If schema changes fail to apply:

1. **Check for data conflicts** - Existing data may violate new schema
2. **Use optional fields** - Make new fields optional with defaults
3. **Export data first** - `npx convex export --path ./backup.zip`
4. **Force regenerate** - `npx convex codegen --force`

---

## Environment Variable Issues

### List current env vars
```bash
npx convex env list
```

### Set env var
```bash
npx convex env set KEY=value
```

### Get specific env var
```bash
npx convex env get KEY
```

### Missing CONVEX_DEPLOY_KEY (CI)

For CI/CD deployments, you need a deploy key:
1. Go to Convex Dashboard → Settings → Deploy Keys
2. Create new key
3. Add as `CONVEX_DEPLOY_KEY` secret in your CI
