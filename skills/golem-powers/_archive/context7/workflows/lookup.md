---
name: lookup
description: Step-by-step library documentation lookup
---

# Library Documentation Lookup Workflow

This workflow guides you through finding and querying library documentation using Context7.

## Prerequisites

- [ ] `CONTEXT7_API_KEY` environment variable is set
- [ ] `jq` is installed (for JSON parsing)
- [ ] `curl` is available

## Step 1: Identify the Library

First, determine which library documentation you need.

**Examples:**
- React hooks documentation
- Next.js app router guide
- Tailwind CSS configuration
- TypeScript utility types

## Step 2: Search for Library ID

Use `resolve-library.sh` to find the Context7 library ID:

```bash
./scripts/resolve-library.sh <library-name>
```

**Examples:**

```bash
# Search for React
./scripts/resolve-library.sh react

# Search for Next.js
./scripts/resolve-library.sh next.js

# Search for Tailwind
./scripts/resolve-library.sh tailwindcss
```

The output will show matching libraries with their IDs. Copy the ID for the library you need.

## Step 3: Query Documentation

Use `query-docs.sh` with the library ID and your question:

```bash
./scripts/query-docs.sh "<library-id>" "<your-question>"
```

**Examples:**

```bash
# React useEffect documentation
./scripts/query-docs.sh /facebook/react "useEffect cleanup function"

# Next.js app router
./scripts/query-docs.sh /vercel/next.js "how to use app router"

# Tailwind dark mode
./scripts/query-docs.sh /tailwindlabs/tailwindcss "dark mode configuration"
```

## Step 4: Review Results

The output is Markdown-formatted documentation. It may include:

- Code examples
- API references
- Best practices
- Related links

## Common Library IDs

| Library | ID |
|---------|-----|
| React | `/facebook/react` |
| Next.js | `/vercel/next.js` |
| Tailwind CSS | `/tailwindlabs/tailwindcss` |
| TypeScript | `/microsoft/typescript` |
| Node.js | `/nodejs/node` |
| Express | `/expressjs/express` |
| Prisma | `/prisma/prisma` |
| Supabase | `/supabase/supabase` |
| Convex | `/get-convex/convex` |

## Troubleshooting

### "Missing API Key" Error

Set your API key:

```bash
export CONTEXT7_API_KEY="ctx7sk_your_key_here"
```

### "Library Not Found"

- Try different spellings
- Use the official library name
- Check available libraries at context7.com

### "No Documentation Found"

- Try different query keywords
- Be more specific in your question
- Check if the library has documentation indexed

### "Rate Limited"

Wait a few seconds and try again. Free tier has 60 requests/hour limit.
