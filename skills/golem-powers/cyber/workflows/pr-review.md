---
name: pr-review
description: "Security-focused PR review checklist — run before merge on any PR touching MCP servers, auth, exec, or file I/O"
---

# Security PR Review

## When to Trigger
- PR touches `server.ts`, `mcp-server.*`, or any MCP tool handler
- PR adds `exec`, `spawn`, `child_process`, or `Bun.spawn` calls
- PR modifies file I/O (`fs.*`, `Bun.file`, `Deno.readFile`)
- PR touches auth, tokens, credentials, or secrets
- PR modifies CLAUDE.md or tool descriptions
- PR adds/modifies shell scripts

## Checklist (apply to EVERY changed file in the diff)

### Tier 1: Blockers (must fix before merge)
- [ ] No `.catch(() => {})` or empty catch blocks added
- [ ] No `eval()`, `new Function()`, or `vm.runInNewContext()` with variable input
- [ ] No hardcoded secrets (`sk-`, `ghp_`, `password =`, `Bearer `, API keys)
- [ ] No `execSync`/`exec` with string interpolation from inputs
- [ ] No `fs.readFileSync`/`writeFileSync` with unvalidated paths
- [ ] No `JSON.parse()` on untrusted input without try/catch

### Tier 2: Should Fix (fix or explicitly risk-accept)
- [ ] New tools have ToolAnnotations (`readOnlyHint`, `destructiveHint`)
- [ ] String inputs have length bounds in schema
- [ ] Path inputs checked for traversal (`..`, symlink resolution)
- [ ] Error responses don't leak stack traces or internal paths
- [ ] New dependencies checked for known vulnerabilities

### Tier 3: Note for Follow-up
- [ ] Console.log doesn't emit sensitive data (tokens, passwords, PII)
- [ ] Timeout bounds on async operations
- [ ] Rate limiting on tools that access external resources
- [ ] CORS/origin validation on HTTP transports

## Review Process

```
1. Read the full diff (gh pr diff N)
2. For EVERY changed file:
   a. Run vuln-patterns grep against the file
   b. Check each changed line against Tier 1 blockers
   c. Read surrounding context (5 lines above/below each change)
3. Check test coverage:
   a. Are error paths tested?
   b. Are malicious inputs tested? (path traversal, injection, overflow)
4. Report findings using the audit output contract
```

## Diff-Specific Patterns

When reviewing a diff, pay special attention to:

```bash
# Lines that ADD catch blocks --- are they empty?
grep "^+" diff.txt | grep -E "catch\s*\(\s*\)|catch\s*\{\s*\}"

# Lines that ADD exec/spawn
grep "^+" diff.txt | grep -E "exec\(|execSync\(|spawn\(|Bun\.spawn"

# Lines that ADD file operations
grep "^+" diff.txt | grep -E "readFile|writeFile|appendFile|unlink|rmdir"

# Lines that ADD env var access
grep "^+" diff.txt | grep -E "process\.env|Bun\.env|Deno\.env"
```
