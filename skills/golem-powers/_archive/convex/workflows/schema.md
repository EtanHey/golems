# Schema Workflow

Inspect, validate, and manage your Convex schema.

---

## Prerequisites

### Step 1: Verify Convex project

Run:
```bash
[ -d "convex" ] && echo "Convex project found" || echo "ERROR: No convex/ directory"
```

### Step 2: Check schema file exists

Run:
```bash
[ -f "convex/schema.ts" ] && echo "Schema file found" || echo "No schema.ts - using schemaless mode"
```

---

## View Current Schema

### Step 1: Read schema definition

Run:
```bash
cat convex/schema.ts
```

### Step 2: View generated types

Run:
```bash
cat convex/_generated/dataModel.d.ts 2>/dev/null || echo "Types not generated - run 'npx convex codegen'"
```

---

## Validate Schema

### Step 1: Run codegen to check for errors

Run:
```bash
npx convex codegen
```

If schema is valid, types will be regenerated. Errors indicate schema issues.

### Step 2: TypeScript check

Run:
```bash
npx tsc --noEmit -p convex/tsconfig.json 2>/dev/null || npx tsc --noEmit convex/schema.ts
```

---

## Schema Structure Reference

Basic schema pattern:
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  messages: defineTable({
    body: v.string(),
    userId: v.id("users"),
    channelId: v.id("channels"),
  }).index("by_channel", ["channelId"]),
});
```

---

## Add a New Table

### Step 1: Edit schema.ts

Add new table definition to the schema:
```typescript
newTable: defineTable({
  field1: v.string(),
  field2: v.optional(v.number()),
}).index("by_field1", ["field1"]),
```

### Step 2: Regenerate types

Run:
```bash
npx convex codegen
```

### Step 3: Push changes (dev)

Run:
```bash
npx convex dev
```

Types will auto-update when dev server is running.

---

## Add an Index

### Step 1: Edit schema.ts

Add `.index()` to table definition:
```typescript
messages: defineTable({
  // ... fields
}).index("by_user", ["userId"])
  .index("by_channel_and_time", ["channelId", "createdAt"]),
```

### Step 2: Push changes

Run:
```bash
npx convex codegen && npx convex deploy
```

---

## Schema Validation Types

| Type | Example |
|------|---------|
| `v.string()` | `"hello"` |
| `v.number()` | `42`, `3.14` |
| `v.boolean()` | `true`, `false` |
| `v.null()` | `null` |
| `v.id("table")` | Document reference |
| `v.array(v.string())` | `["a", "b"]` |
| `v.object({...})` | Nested object |
| `v.optional(v.string())` | String or undefined |
| `v.union(v.string(), v.number())` | String or number |
| `v.literal("value")` | Exact value |

---

## Search Indexes

For full-text search:

### Step 1: Add search index to schema

```typescript
messages: defineTable({
  body: v.string(),
  // ...
}).searchIndex("search_body", {
  searchField: "body",
  filterFields: ["channelId"],
}),
```

### Step 2: Deploy to enable

Run:
```bash
npx convex deploy
```

---

## Troubleshooting

**"Schema validation failed" error?**
- Check syntax in `convex/schema.ts`
- Ensure all referenced tables exist
- Verify `v.id("tableName")` references valid tables

**Index not working?**
- Indexes are not instantly available after creation
- Check index is defined in schema
- Verify query uses index fields in correct order

**Type errors after schema change?**
```bash
npx convex codegen
```

**Destructive schema change blocked?**
- Removing fields or tables requires data migration
- Export data first, then make changes
- Or use Convex dashboard to force-push (dangerous)
