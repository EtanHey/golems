---
name: vuln-patterns
description: "Grep patterns for detecting vulnerabilities — organized by severity, grounded in real ecosystem bugs"
---

# Vulnerability Grep Patterns

> Every pattern below maps to a REAL bug found in our ecosystem. Source PR/scan noted for each.

## CRITICAL Patterns

### silent-catch --- Silent Error Swallowing
**Source:** cmuxlayer PR #21
```
\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)
catch\s*\([^)]*\)\s*\{\s*\}
\.catch\(\(\)\s*=>
```
**Match:** `.catch(() => {})`, `catch (e) {}`, `.catch(() =>`
**Fix:** Log the error or rethrow. Never swallow silently in server code.

### unsanitized-exec --- Child Process with User Input
**Source:** voicelayer SafeSkill scan (52 critical findings)
```
exec\s*\(
execSync\s*\(
Bun\.spawn\s*\(
child_process
spawn\s*\(.*\$\{
```
**Match:** `exec(`, `execSync(`, `Bun.spawn(`, template literals in spawn args
**Fix:** Use array arguments. Never interpolate user input into shell strings.

### eval-dynamic --- Dynamic Code Execution
```
eval\s*\(
new\s+Function\s*\(
vm\.runInNewContext\s*\(
vm\.runInThisContext\s*\(
```
**Fix:** Remove eval entirely. Use structured data processing instead.

### hardcoded-secrets --- Committed Credentials
```
(password|passwd)\s*[:=]\s*['"][^'"]+['"]
(api[_-]?key|apikey)\s*[:=]\s*['"][^'"]+['"]
(secret|token)\s*[:=]\s*['"][^'"]+['"]
sk-[a-zA-Z0-9]{20,}
ghp_[a-zA-Z0-9]{36}
gho_[a-zA-Z0-9]{36}
Bearer\s+[a-zA-Z0-9._-]{20,}
```
**Fix:** Use environment variables or 1Password `op` CLI. Never commit secrets.

## HIGH Patterns

### path-traversal --- Unvalidated File Paths
**Source:** orchestrator PR #41
```
path\.join\(.*,\s*(?:req|input|param|arg|user|body|query)
readFileSync\s*\(\s*(?!['"])
writeFileSync\s*\(\s*(?!['"])
```
**Match:** `path.join(baseDir, userInput)`, `readFileSync(variable)`
**Fix:** `path.resolve()` + `startsWith(baseDir)` check.

### data-exfil --- Sensitive Path Access
**Source:** brainlayer SafeSkill scan
```
os\.homedir\(\)
homedir\(\)
~\/\.config
~\/\.ssh
~\/\.aws
~\/\.env
process\.env\[
Bun\.env\[
```
**Match:** Tools reading from user home directory, accessing env vars
**Fix:** Allowlist specific paths. Never let tool input control home dir traversal.

### json-parse-unprotected --- Unguarded JSON Parse
```
JSON\.parse\s*\([^)]*\)\s*[^}]*$
```
**Context:** JSON.parse without surrounding try/catch. In MCP servers, malformed tool input crashes the server.
**Fix:** Always wrap in try/catch with structured error response.

### prompt-injection --- Tool Description Injection
**Source:** brainlayer SafeSkill scan
```
description:.*<(?!br)
description:.*\{\{
description:.*<!--
```
**Match:** HTML/template syntax in MCP tool descriptions
**Fix:** Keep descriptions as plain text. No HTML, no template interpolation.

## MEDIUM Patterns

### missing-tool-annotations --- MCP ToolAnnotations
**Source:** MCP spec 2025-03-26
```
server\.tool\s*\((?!.*annotations)
```
**Context:** Tool registered without annotations block.
**Fix:** Add `{ annotations: { readOnlyHint, destructiveHint, idempotentHint } }`.

### ssml-injection --- SSML Tag Injection in TTS
**Source:** voicelayer TTS pipeline
```
<speak>.*\$\{
<prosody.*\$\{
ssml.*\+.*(?:input|text|user|content)
```
**Match:** User input interpolated into SSML templates
**Fix:** Escape `<>&"'` before interpolation.

### env-no-fallback --- Missing Environment Variable Fallback
```
process\.env\.\w+[^?|]
process\.env\[['"][^'"]+['"]\][^?|]
```
**Context:** Accessing env var without `??` or `||` fallback. Missing var = `undefined` flowing downstream.
**Fix:** `process.env.VAR ?? "default"` or throw with helpful message.

### stack-trace-leak --- Error Response Leaking Internals
```
res\.json\(\{.*error:.*err\.stack
\.stack.*res\.send
message:.*err\.message
```
**Fix:** Return generic error to client. Log full error server-side.

## LOW Patterns

### console-sensitive --- Logging Sensitive Data
```
console\.log.*(?:token|password|secret|key|credential|auth)
```
**Fix:** Redact sensitive values before logging.

### no-timeout --- Missing Async Timeouts
```
await\s+(?!Promise\.race).*fetch\(
await\s+(?!Promise\.race).*axios
```
**Context:** Async calls without timeout bounds can hang the MCP server.
**Fix:** Wrap in `Promise.race([operation, timeout])`.
