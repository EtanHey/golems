# User Deletion Workflow

Complete user deletion pattern - removes user AND all related data across tables.

---

## Quick Start

For a complete user deletion, you need to:
1. Find the user by email
2. Delete from all app tables with userId foreign key
3. Delete from auth tables (user, session, account)

---

## Step 1: Find User by Email

Query to get the user document:

```typescript
// convex/admin.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    return user;
  },
});
```

Run from CLI:
```bash
npx convex run admin:getUserByEmail --args '{"email": "user@example.com"}'
```

---

## Step 2: Discover Tables with userId

Query to find all tables that reference userId:

```typescript
// convex/admin.ts
export const discoverUserTables = query({
  handler: async (ctx) => {
    // Get schema info - check your schema.ts for tables with userId
    // This is a manual check - Convex doesn't have introspection API

    // Common patterns to look for in schema.ts:
    // - userId: v.id("users")
    // - userId: v.string()
    // - user: v.id("users")

    return {
      authTables: ["users", "sessions", "accounts", "verificationTokens"],
      commonAppTables: [
        "progress",
        "preferences",
        "logs",
        "notifications",
        "uploads",
        "comments",
        "reactions",
      ],
      note: "Check your schema.ts for all tables with userId field"
    };
  },
});
```

**Manual check command:**
```bash
grep -n "userId" convex/schema.ts
```

---

## Step 3: Delete from App Tables

Delete pattern for each table with userId foreign key:

```typescript
// convex/admin.ts
import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Delete all records from a specific table for a user
async function deleteUserRecords(
  ctx: any,
  tableName: string,
  userId: string,
  indexName: string = "by_user"
) {
  const records = await ctx.db
    .query(tableName)
    .withIndex(indexName, (q: any) => q.eq("userId", userId))
    .collect();

  for (const record of records) {
    await ctx.db.delete(record._id);
  }

  return records.length;
}

// Internal mutation for batch deletion
export const deleteUserDataFromTable = internalMutation({
  args: {
    tableName: v.string(),
    userId: v.string(),
    indexName: v.optional(v.string())
  },
  handler: async (ctx, { tableName, userId, indexName }) => {
    return await deleteUserRecords(ctx, tableName, userId, indexName ?? "by_user");
  },
});
```

---

## Step 4: Delete from Auth Tables

**Order matters!** Delete in this order to avoid foreign key issues:

1. `sessions` - user sessions
2. `accounts` - OAuth/credential accounts linked to user
3. `verificationTokens` - email verification tokens
4. `users` - the user record itself

```typescript
// convex/admin.ts
export const deleteAuthData = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const deleted = {
      sessions: 0,
      accounts: 0,
      verificationTokens: 0,
      user: false,
    };

    // Delete sessions
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    deleted.sessions = sessions.length;

    // Delete accounts (OAuth providers)
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const account of accounts) {
      await ctx.db.delete(account._id);
    }
    deleted.accounts = accounts.length;

    // Delete verification tokens (if using email auth)
    const user = await ctx.db.get(userId);
    if (user?.email) {
      const tokens = await ctx.db
        .query("verificationTokens")
        .withIndex("by_email", (q) => q.eq("email", user.email))
        .collect();
      for (const token of tokens) {
        await ctx.db.delete(token._id);
      }
      deleted.verificationTokens = tokens.length;
    }

    // Finally delete the user
    await ctx.db.delete(userId);
    deleted.user = true;

    return deleted;
  },
});
```

---

## Complete Deletion Mutation

Combines all steps into one mutation:

```typescript
// convex/admin.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const deleteUserAndAllData = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    // 1. Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    const userId = user._id;
    const deletionReport = {
      userId: userId,
      email: email,
      deletedRecords: {} as Record<string, number>,
    };

    // 2. Delete from app tables (add your tables here)
    const appTables = [
      "progress",
      "preferences",
      "logs",
      "notifications",
      "uploads",
      // Add more tables as needed
    ];

    for (const tableName of appTables) {
      try {
        const records = await ctx.db
          .query(tableName)
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();

        for (const record of records) {
          await ctx.db.delete(record._id);
        }

        deletionReport.deletedRecords[tableName] = records.length;
      } catch (e) {
        // Table might not exist or have different index
        deletionReport.deletedRecords[tableName] = 0;
      }
    }

    // 3. Delete auth data (sessions, accounts, tokens)
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) await ctx.db.delete(s._id);
    deletionReport.deletedRecords.sessions = sessions.length;

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const a of accounts) await ctx.db.delete(a._id);
    deletionReport.deletedRecords.accounts = accounts.length;

    // 4. Delete user last
    await ctx.db.delete(userId);
    deletionReport.deletedRecords.users = 1;

    return deletionReport;
  },
});
```

---

## CLI Command

Run the complete deletion:

```bash
npx convex run admin:deleteUserAndAllData --args '{"email": "user@example.com"}'
```

**Output example:**
```json
{
  "userId": "k97abc123xyz",
  "email": "user@example.com",
  "deletedRecords": {
    "progress": 15,
    "preferences": 1,
    "logs": 42,
    "sessions": 3,
    "accounts": 2,
    "users": 1
  }
}
```

---

## Required Indexes

Ensure these indexes exist in your `schema.ts`:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    // ... other fields
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.id("users"),
    // ... other fields
  }).index("by_user", ["userId"]),

  accounts: defineTable({
    userId: v.id("users"),
    provider: v.string(),
    // ... other fields
  }).index("by_user", ["userId"]),

  // App tables - add by_user index to each
  progress: defineTable({
    userId: v.id("users"),
    // ... other fields
  }).index("by_user", ["userId"]),

  preferences: defineTable({
    userId: v.id("users"),
    // ... other fields
  }).index("by_user", ["userId"]),

  logs: defineTable({
    userId: v.id("users"),
    // ... other fields
  }).index("by_user", ["userId"]),
});
```

---

## Safety Checklist

Before running user deletion:

- [ ] **Backup first** - `npx convex export --path ./backup-$(date +%Y%m%d).zip`
- [ ] **Verify user email** - Double-check the email is correct
- [ ] **Check all tables** - Ensure appTables array includes all tables with userId
- [ ] **Test on dev** - Run on development deployment first
- [ ] **Log the deletion** - Store deletion reports for compliance

---

## Troubleshooting

**"Index not found" error?**
- Ensure `by_user` index exists on the table
- Check index name matches your schema (might be `by_userId` or similar)

**"User not found" error?**
- Verify email is correct
- Check if user already deleted

**Partial deletion (some tables failed)?**
- Check deletion report for 0 counts
- Manually query tables to find remaining records
- Fix index or table name and retry

**Need to delete by userId instead of email?**
- Modify the mutation to accept `userId: v.id("users")` instead
- Skip the email lookup step
