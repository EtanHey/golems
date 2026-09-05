---
name: shell-hardening
description: "Bash security checklist: injection, set -euo, printf, quoting. Triggers: shell hardening, bash security."
---

# Shell Hardening Checklist

**Apply to EVERY bash script before committing.** The March 26 overnight sprint found
security issues in every orchestrator worker PR (D-R1 through D-R6). Common patterns:
JSON injection via printf, shell metacharacter bypass, unquoted paths, unquoted
heredoc delimiters.

## Mandatory Header

```bash
#!/usr/bin/env bash
set -euo pipefail
```

- `set -e` — exit on error
- `set -u` — error on undefined variables
- `set -o pipefail` — pipe failures propagate

## Checklist

### 1. String Interpolation (CRITICAL)
- [ ] NEVER use `printf` with format strings to construct JSON — use `jq`
- [ ] NEVER use `echo "$var"` in command construction — use arrays
- [ ] NEVER use `eval` or `bash -c "$string"` with user input

```bash
# WRONG — JSON injection
printf '{"name": "%s"}' "$user_input"

# RIGHT — jq handles escaping
jq -n --arg name "$user_input" '{"name": $name}'
```

### 1b. Heredoc Delimiters (CRITICAL when writing markdown)
- [ ] ALWAYS quote the heredoc delimiter (`<<'EOF'`) when writing or appending ANY content containing backticks or `$()` — markdown code spans count
- [ ] Unquoted `<<EOF` command-substitutes the body: every backtick span and `$()` EXECUTES

```bash
# WRONG — unquoted delimiter: the shell evaluates the backtick code span.
# Canonical incident (2026-06-07, PID 36248): writing exactly this kind of
# markdown note launched `voicelayer serve` against the default socket — the
# kickoff's ONE forbidden thing — while the live VoiceBar was in use.
cat >> notes.md <<EOF
Run `voicelayer serve` to start the server.
EOF

# RIGHT — quoted delimiter: body is literal; backticks and $() preserved
cat >> notes.md <<'EOF'
Run `voicelayer serve` to start the server.
EOF
```

### 2. Command Construction (CRITICAL)
- [ ] Use arrays for command arguments, never string concatenation
- [ ] Check for shell metacharacters before executing: `; && || | $( ) \``

```bash
# WRONG — metacharacter injection
cmd="git commit -m $message"
eval "$cmd"

# RIGHT — array construction
cmd=(git commit -m "$message")
"${cmd[@]}"
```

### 3. Path Safety (HIGH)
- [ ] Always quote paths: `"$file_path"` not `$file_path`
- [ ] Use `realpath` or `readlink -f` to resolve symlinks
- [ ] Check for path traversal: reject paths containing `..`

### 4. Temporary Files (HIGH)
- [ ] Use `mktemp` not hardcoded /tmp paths
- [ ] Set `trap 'rm -f "$tmpfile"' EXIT` for cleanup
- [ ] Never write secrets to temp files

### 5. Error Handling (MEDIUM)
- [ ] Check return codes: `if ! command; then handle_error; fi`
- [ ] Use `|| true` only when failure is genuinely acceptable
- [ ] Log errors to stderr: `echo "ERROR: ..." >&2`

### 5b. pipefail + SIGPIPE (CRITICAL with `set -o pipefail`)
- [ ] Piping into an early-exit consumer (`awk '{exit}'`, `head -1`, `grep -m1`) **SIGPIPE-kills the producer** → exit 141, often masked as success in naive scripts
- [ ] **Buffer first, consume second** — write to a temp file or variable, then awk/grep/head the buffer
- [ ] Never use zsh read-only specials (`status`, `path`, etc.) as variable names

```bash
# WRONG — producer gets SIGPIPE under pipefail
some_generator | awk '/pattern/{print; exit}'

# RIGHT — buffer then consume
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
some_generator > "$tmp"
awk '/pattern/{print; exit}' "$tmp"
```

See `/mac-systems` mechanical truths #3–#4 for environment context.

### 6. ShellCheck (MEDIUM)
- [ ] Run `shellcheck script.sh` before committing
- [ ] Fix all warnings, not just errors
- [ ] Suppress only with inline comments explaining why

## Quick Audit Command

```bash
# Run on any script (covers section 6 — ShellCheck):
shellcheck --severity=warning script.sh && echo "CLEAN" || echo "ISSUES FOUND"
```

Note: ShellCheck covers syntax and common pitfalls but does NOT detect sections 1-5 (injection patterns, path traversal, temp file misuse). Those require manual review using the checklist above.
