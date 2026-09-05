# Supabase Context

> Use this context for projects using Supabase (PostgreSQL, Auth, Storage).

---

## Database Migration Guidelines

**CRITICAL: NEVER MODIFY PRODUCTION DATABASE DIRECTLY**

### Migration Workflow:
1. **Create migration file FIRST** in `/supabase/migrations/`
   - Format: `YYYYMMDD_descriptive_name.sql`
   - Example: `20250124_add_status_column.sql`
   - **CRITICAL**: Always save locally BEFORE applying to database!

2. **Apply to development database** for testing
3. **Commit the migration file** to git
4. Let deployment pipeline handle production migrations

### Important Rules:
- **ALWAYS** create local migration file first
- **ALWAYS** version control migrations
- Use descriptive names in snake_case
- **NEVER** apply migrations without saving locally first
- **NEVER** use `mcp__supabase__execute_sql` for schema changes (read-only queries only)

### Example Migration:
```sql
-- 20250124_add_user_preferences.sql

-- Add preferences column
ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';

-- Create index for common queries
CREATE INDEX idx_users_preferences_theme ON users ((preferences->>'theme'));
```

---

## Type Management Guidelines

**Database Types are the Source of Truth**

### Workflow:
1. **Make schema changes** via migration
2. **Generate TypeScript types**:
   ```bash
   npm run typegen
   ```
3. **Import types** throughout the project:
   ```typescript
   import type { Tables, TablesInsert, TablesUpdate } from '@/types/database.types';

   type User = Tables<'users'>;
   type UserInsert = TablesInsert<'users'>;
   type UserUpdate = TablesUpdate<'users'>;
   ```

### Important Rules:
- Never create duplicate type definitions - always reference database types
- All type helpers and constants go in `/types/helpers.ts`
- Re-generate types after every schema change
- Never manually edit `database.types.ts` - it's auto-generated
- Do NOT try to understand schema by querying Supabase - read `database.types.ts` directly

---

## Client Usage

### Server Components (Next.js)
```typescript
import { createClient } from '@/lib/supabase/server';

export default async function Page() {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from('items')
    .select('*')
    .eq('status', 'active');

  return <div>{/* render */}</div>;
}
```

### Client Components (Next.js)
```typescript
'use client';

import { createClient } from '@/lib/supabase/client';

export default function Component() {
  const supabase = createClient();

  const fetchItems = async () => {
    const { data } = await supabase.from('items').select('*');
  };
}
```

### Important Rules:
- Always use `@/lib/supabase/server` for server components
- Always use `@/lib/supabase/client` for client components
- Never recreate Supabase client instances - import from existing files
- Never use server client in client components or vice versa

---

## Common Query Patterns

### Select with Relations
```typescript
const { data } = await supabase
  .from('posts')
  .select(`
    *,
    author:users(id, name, avatar),
    comments(id, content, created_at)
  `)
  .eq('published', true)
  .order('created_at', { ascending: false });
```

### Insert with Return
```typescript
const { data, error } = await supabase
  .from('items')
  .insert({ name: 'New Item', status: 'active' })
  .select()
  .single();
```

### Upsert
```typescript
const { data, error } = await supabase
  .from('items')
  .upsert({ id: existingId, name: 'Updated Name' })
  .select()
  .single();
```

### Delete
```typescript
const { error } = await supabase
  .from('items')
  .delete()
  .eq('id', itemId);
```

---

## Real-time Subscriptions

```typescript
'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function RealtimeComponent() {
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel('items')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items' },
        (payload) => {
          console.log('Change received!', payload);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
```

---

## Storage

### Upload File
```typescript
const { data, error } = await supabase.storage
  .from('avatars')
  .upload(`${userId}/${fileName}`, file, {
    cacheControl: '3600',
    upsert: true
  });
```

### Get Public URL
```typescript
const { data } = supabase.storage
  .from('avatars')
  .getPublicUrl(`${userId}/${fileName}`);

const publicUrl = data.publicUrl;
```

---

## Row Level Security (RLS)

### Enable RLS
```sql
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
```

### Common Policies
```sql
-- Users can read their own items
CREATE POLICY "Users can read own items"
  ON items FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own items
CREATE POLICY "Users can insert own items"
  ON items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own items
CREATE POLICY "Users can update own items"
  ON items FOR UPDATE
  USING (auth.uid() = user_id);
```

---

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGc..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."  # Server-only, never expose
```

- `NEXT_PUBLIC_` prefix = accessible in client code
- Service role key = full access, server-only
