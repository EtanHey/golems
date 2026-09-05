# Convex Context

> Use this context for projects using Convex (real-time database).

---

## Critical: .js File Error Fix

**Error message:**
```
Two output files share the same path but have different contents: out/filename.js
```

### What Causes It
Convex bundler finds BOTH `.ts` and `.js` files with the same name in `convex/` folder.

### BEFORE Starting Convex Dev Server - ALWAYS RUN:
```bash
rm -f convex/*.js
npx convex dev
```

### Fix When Error Occurs:
```bash
# Stop convex dev (Ctrl+C)
rm -f convex/*.js
npx convex dev
```

### Prevention Rules:
1. **NEVER create .js files in convex/** - Only .ts files belong there
2. **After creating git worktree** - Run `rm -f convex/*.js` before `npx convex dev`
3. **Add to .gitignore** - Ensure `convex/*.js` is ignored

---

## Project Structure

```
convex/
├── schema.ts        # Database schema
├── queries.ts       # Query functions
├── mutations.ts     # Mutation functions
├── auth.ts          # Auth config (Better Auth)
└── seed.ts          # Seed data
```

---

## Schema Definition

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_email', ['email']),

  items: defineTable({
    userId: v.id('users'),
    title: v.string(),
    content: v.string(),
    status: v.union(v.literal('draft'), v.literal('published')),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_status', ['status']),
});
```

---

## Queries

```typescript
// convex/queries.ts
import { query } from './_generated/server';
import { v } from 'convex/values';

export const getItems = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query('items')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();
  },
});

export const getItem = query({
  args: { id: v.id('items') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});
```

---

## Mutations

```typescript
// convex/mutations.ts
import { mutation } from './_generated/server';
import { v } from 'convex/values';

export const createItem = mutation({
  args: {
    userId: v.id('users'),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { userId, title, content }) => {
    return await ctx.db.insert('items', {
      userId,
      title,
      content,
      status: 'draft',
      createdAt: Date.now(),
    });
  },
});

export const updateItem = mutation({
  args: {
    id: v.id('items'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    status: v.optional(v.union(v.literal('draft'), v.literal('published'))),
  },
  handler: async (ctx, { id, ...updates }) => {
    await ctx.db.patch(id, updates);
  },
});

export const deleteItem = mutation({
  args: { id: v.id('items') },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
```

---

## React Usage with TanStack Query

```typescript
// hooks/useItems.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useConvex } from 'convex/react';
import { api } from '../convex/_generated/api';

export function useItems(userId: Id<'users'>) {
  const convex = useConvex();

  return useQuery({
    queryKey: ['items', userId],
    queryFn: () => convex.query(api.queries.getItems, { userId }),
  });
}

export function useCreateItem() {
  const convex = useConvex();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { userId: Id<'users'>; title: string; content: string }) =>
      convex.mutation(api.mutations.createItem, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items', variables.userId] });
    },
  });
}
```

---

## CLI Commands

Use `/golem-powers:convex` skill for dev server management, deployments, and function execution.

**Essential one-liners:**
```bash
npx convex dev        # Start dev server
npx convex deploy     # Deploy to production
npx convex dashboard  # View dashboard
```

**Note:** Check project's `package.json` for project-specific scripts (e.g., `bun dev` may include Convex).

---

## User Deletion Pattern

When deleting a user, delete related data in order (foreign key constraints):

```typescript
// convex/admin.ts
import { mutation } from './_generated/server';
import { v } from 'convex/values';

export const deleteUserAndAllData = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    // 1. Delete user's items
    const items = await ctx.db
      .query('items')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();

    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // 2. Delete auth data (if using Better Auth)
    // sessions → accounts → verificationTokens → user

    // 3. Delete user
    await ctx.db.delete(userId);

    return { deleted: { items: items.length, user: 1 } };
  },
});
```

---

## Environment Variables

```env
# .env.local
CONVEX_DEPLOYMENT=dev:your-project-name
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

---

## Tips

- Always use `v.id('tableName')` for foreign keys
- Use indexes for any field you filter/sort by frequently
- Convex functions are automatically typed - import from `_generated`
- Real-time updates are automatic - no subscription setup needed
- Use `ctx.db.get(id)` for single document, `ctx.db.query()` for multiple
