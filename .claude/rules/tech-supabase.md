---
globs: "packages/{shared,services,jobs,teller,coach,claude,recruiter,content}/**"
---

# Supabase Rules

- **Project ID:** read `GOLEMS_SUPABASE_PROJECT_REF` from the environment; never hardcode it.
- **RLS always on.** New tables need RLS policies.
- **DDL via `mcp__supabase__apply_migration`**, never `execute_sql`.
- **Client:** import `getSupabase` from `@golems/shared/lib/supabase-factory` — never create clients directly.
