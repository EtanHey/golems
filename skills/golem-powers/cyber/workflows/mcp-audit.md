---
name: mcp-audit
description: "Step-by-step MCP server security audit — ToolAnnotations, input validation, error handling, tool description injection"
---

# MCP Server Security Audit

## Prerequisites
- Identify the MCP server entry point (usually `server.ts` or `index.ts`)
- Identify all `server.tool()` registrations
- Check the MCP SDK version (`@modelcontextprotocol/sdk` in package.json)

## Step 1: ToolAnnotations Coverage

```bash
# Count total tools
grep -c "server\.tool(" src/server.ts

# Count annotated tools (with readOnlyHint or destructiveHint)
grep -c "readOnlyHint\|destructiveHint" src/server.ts
```

For EVERY tool registration, verify:
- [ ] `readOnlyHint: true/false` declared
- [ ] `destructiveHint: true/false` declared (especially for write/delete/modify tools)
- [ ] `idempotentHint` declared for mutation tools
- [ ] `openWorldHint` declared for tools that access external resources

**Score:** `annotated / total` tools. Target: 100%. Below 80% = MEDIUM finding.

## Step 2: Input Validation

For EVERY tool handler, check:

```
input schema (zod/JSON Schema) → handler function → external call
```

- [ ] All string inputs have maxLength constraints
- [ ] Path inputs are validated (no `..`, resolved against base dir)
- [ ] Numeric inputs have min/max bounds
- [ ] Enum inputs use strict allowlists
- [ ] No raw user input flows to `exec()`, `spawn()`, `fs.*()`, or SQL queries

**Pattern to grep:**
```bash
# Find handlers that take input and call exec/spawn
grep -n "exec\|spawn\|readFile\|writeFile" src/server.ts
```

## Step 3: Error Handling

- [ ] No `.catch(() => {})` or empty catch blocks
- [ ] Tool handlers return structured error responses, not raw exceptions
- [ ] Server startup errors are logged (not swallowed)
- [ ] Async operations have timeout bounds

**Pattern to grep:**
```bash
grep -n "catch\s*(\s*)" src/server.ts
grep -n "\.catch\(\s*(\s*)\s*=>" src/server.ts
grep -n "catch\s*{" src/server.ts  # empty catch blocks
```

## Step 4: Tool Description Injection

Read every `description` field in tool registrations:
- [ ] No HTML or markdown that could be interpreted as instructions
- [ ] No template literals with user-controlled content in descriptions
- [ ] Descriptions don't contain executable patterns (`<script>`, `<!--`, `{{`)

## Step 5: Transport Security

- [ ] stdio transport: validate JSON-RPC framing (no injection via malformed messages)
- [ ] SSE/HTTP transport: validate origin, check CORS policy
- [ ] Socket transport: check permissions on socket file (should be 0600 or 0700)

**For socket-based servers:**
```bash
ls -la /tmp/*.sock  # Check permissions
stat -f "%Lp" /tmp/voicelayer.sock  # Should be 600 or 700
```

## Step 6: Dependency Audit

```bash
# Check for known vulnerabilities
npm audit --json 2>/dev/null | jq '.vulnerabilities | length'
# or
bun audit 2>/dev/null
```

- [ ] No critical/high severity dependency vulnerabilities
- [ ] Dependencies are pinned (not floating `^` or `~` for security-critical packages)

## Report Template

```markdown
## MCP Security Audit: [server-name]

**SDK Version:** @modelcontextprotocol/sdk X.Y.Z
**Transport:** stdio | SSE | socket
**Tools:** N total

### ToolAnnotations Coverage: N/M (X%)
[List unannotated tools]

### Input Validation Issues
| Tool | Input | Issue |
|------|-------|-------|

### Error Handling Issues
| File:Line | Pattern | Severity |
|-----------|---------|----------|

### Verdict: PASS / PASS WITH NOTES / FAIL
```
