---
name: repo-scan
description: "Full repository security sweep — grep all vulnerability patterns, triage, report"
---

# Full Repository Security Scan

## Prerequisites
- Identify repo type: MCP server | TypeScript service | Swift app | Shell scripts | Mixed
- Check `.gitignore` to avoid scanning build artifacts

## Step 1: Automated Pattern Sweep

Run ALL patterns from `references/vuln-patterns.md` against the repo. Use ripgrep for speed:

```bash
# Silent error swallowing
rg --type ts '\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)' -n
rg --type ts 'catch\s*\([^)]*\)\s*\{\s*\}' -n

# Unsanitized exec/spawn
rg --type ts 'exec(Sync)?\s*\(' -n
rg --type ts 'spawn\s*\(' -n
rg --type ts 'Bun\.spawn' -n
rg --type ts 'child_process' -n

# Path traversal risk
rg --type ts 'readFileSync|writeFileSync|readFile|writeFile' -n
rg --type ts 'path\.join.*(?:req|input|param|arg|user)' -n

# Secrets / credentials
rg -i '(password|secret|api.?key|token|bearer|sk-|ghp_|gho_)\s*[:=]' -n --type-not binary
rg 'process\.env\[' -n --type ts

# Eval / dynamic code execution
rg --type ts 'eval\s*\(' -n
rg --type ts 'new\s+Function\s*\(' -n
rg --type ts 'vm\.runIn' -n

# JSON.parse without protection
rg --type ts 'JSON\.parse\(' -n

# Data exfiltration surfaces
rg --type ts 'homedir\(\)|os\.homedir' -n
rg '~/\.' -n --type-not binary

# MCP ToolAnnotations (missing)
rg --type ts 'server\.tool\(' -n
rg --type ts 'readOnlyHint|destructiveHint' -n

# Shell scripts
rg --type sh 'eval\s' -n
rg --type sh 'printf.*%s.*\{' -n
rg --type sh '\$\(' -n  # command substitution (context-dependent)

# SSML injection (voicelayer)
rg --type ts '<speak>|<prosody|ssml' -n -i
```

## Step 2: Contextualize Each Finding

For EVERY grep hit:
1. **Read the surrounding code** (10 lines context)
2. **Check if mitigated** --- is there validation before the dangerous call?
3. **Classify severity** using the triage table from SKILL.md
4. **Note false positives** --- mark as FP with reason

## Step 3: ToolAnnotations Audit (MCP repos only)

```bash
# Extract all tool registrations
rg 'server\.tool\(' -A5 src/server.ts

# For each, check if annotations block exists
# Count: total tools vs annotated tools
```

## Step 4: Dependency Check

```bash
npm audit --json 2>/dev/null | jq '.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high") | .key'
```

## Step 5: CLAUDE.md / Prompt Surface Audit

```bash
# Check for hidden instructions
rg '<!--.*-->' CLAUDE.md
rg '<[a-z]' CLAUDE.md  # HTML tags in markdown

# Check tool descriptions for injection
rg 'description:' src/server.ts -A3
```

## Report Template

```markdown
## Repository Security Scan: [repo-name]

**Repo type:** MCP server | TypeScript service | Mixed
**Files scanned:** N
**Scan date:** YYYY-MM-DD

### Findings by Severity

#### CRITICAL (N)
| # | File:Line | Pattern | Description | Fix |
|---|-----------|---------|-------------|-----|

#### HIGH (N)
| # | File:Line | Pattern | Description | Fix |
|---|-----------|---------|-------------|-----|

#### MEDIUM (N)
| # | File:Line | Pattern | Description | Fix |
|---|-----------|---------|-------------|-----|

#### LOW (N)
| # | File:Line | Pattern | Description | Fix |
|---|-----------|---------|-------------|-----|

### False Positives (N)
| File:Line | Pattern | Why FP |
|-----------|---------|--------|

### ToolAnnotations: N/M tools (X%)
### Dependency Vulnerabilities: N critical, N high
### Verdict: PASS / PASS WITH NOTES / FAIL
```
