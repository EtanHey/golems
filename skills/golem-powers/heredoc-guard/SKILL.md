---
name: heredoc-guard
description: Deny command substitution in unquoted shell heredocs before execution.
---

# Heredoc guard

Unquoted heredocs (`<<EOF`, `<<-EOF`) expand backticks and `$(command)` in
their bodies. A backticked command in generated Markdown can run on the host.
Quote the delimiter: `<<'EOF'`, `<<"EOF"`, `<<\EOF`, or `<<E"OF"`.
If a value must expand, compute it first: put `v=$(cmd)` on its own line before
the heredoc, then use `$v` in the unquoted body. Quoting preserves literal text;
precomputing preserves the intended computed value.
Escaped backticks/dollars, variable expansion and arithmetic alone are allowed.
There is no environment bypass. Commands without a heredoc operator return allow
before shell inspection; `<<` split by escaped newlines still counts. Invalid or
unsupported syntax and inspection limits in heredoc-bearing commands deny with
a plain refusal; the ledger keeps the stage and short cause. ANSI-C escapes in
delimiters require a plain quoted rewrite; ordinary ANSI-C quoted arguments are
treated as strings.

Scope: inspect the outer shell command, including executable substitutions.
Quoted interpreter payloads such as `bash -c '…'` are strings and are not
recursively interpreted. Quotes inside an unquoted heredoc body do not protect it.
This is a heredoc guard, not a full shell syntax validator.

Claude uses the fail-closed launcher; Codex uses `codex-policy-hook.py`.
Codex uses the standard `^(Bash|apply_patch)$` matcher. The gate immediately
allows non-Bash events; native patch content is never parsed as shell.
Each denial appends one JSONL record to the heredoc guard ledger in the user's
Claude logs directory, following tmp-block's durable logs convention. Override
the destination with `HEREDOC_GUARD_LEDGER`; tests and probes use isolated ledgers.
Records contain `ts`,
`command_sha256`, `rule`, and a short static `reason`, never raw command text.
Missing or invalid commands use the SHA-256 of the empty string. An unwritable
ledger still denies with the same plain refusal.
Source wiring does not prove installed/native enforcement. Installation and
native acceptance belong to the lead after merge; this change installs nothing.
