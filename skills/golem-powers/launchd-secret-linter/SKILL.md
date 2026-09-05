---
name: launchd-secret-linter
description: "Lint launchd plists for hardcoded secrets in EnvironmentVariables. Triggers: launchd plist, LaunchAgents, plist secret, raw API key in plist, secrets hygiene, op:// reference."
---

# launchd-secret Linter

A launchd plist that hardcodes a secret in `EnvironmentVariables` **leaks it into the
user-agent environment on first load and contaminates the whole fleet** — the gen-18
specimen was a raw `GOOGLE_API_KEY` leaked exactly this way. A hardened plist carries only
an **`op://` 1Password reference** or **`$VAR` env-indirection**, never the literal. This
skill makes that rule a mechanical, replayable gate.

## Run it

```bash
python3 lint_cli.py ~/Library/LaunchAgents/*.plist   # exit 1 if any plist hardcodes a secret
python3 -m pytest tests/                              # the RED→GREEN gate (10 cases)
```

The CLI never prints secret values — only the plist, the env key, and the rule.

## Rules (precision-biased — flag literals, never indirection)

| Rule | Catches |
|------|---------|
| `raw-secret-value` | A value matching a known provider key shape — Google `AIza…`, OpenAI `sk-…`, GitHub `ghp_/gho_/ghs_/ghu_…`, Slack `xox…`, AWS `AKIA…`, a PEM `-----BEGIN … PRIVATE KEY-----` — that is a literal (not `op://…`, not `$VAR`). |
| `literal-in-secret-named-var` | An env var whose **name** says secret (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*PASSWORD*`, `*CREDENTIAL*`, `*PRIVATE_KEY*`) whose value is a non-empty literal that is not an `op://` reference or `$`-indirection. |

`op://` references and `$VAR` / `${VAR}` indirection are always treated as the hardened
(non-leaking) form and never flagged.

## The hardened form

```xml
<key>GOOGLE_API_KEY</key>
<string>op://Private/google/api_key</string>   <!-- 1Password reference -->
<key>GH_TOKEN</key>
<string>$GH_TOKEN</string>                       <!-- env indirection -->
```

## Do NOT auto-rotate

When this linter finds a hardcoded secret, **flag it — do not rotate it automatically**.
Per gen-18 D7: `untrack != redaction`; assess the secret's live/billed status before any
rotation, and migrate the plist to an `op://` reference. Auto-rotation can break live
services and is the user's call.

## Validated against real artifacts

Run against the live `~/Library/LaunchAgents/` set, the linter both confirms hardened
plists clean and surfaces real hardcoded secrets by key (values never printed). The
RED→GREEN fixtures (`fixtures/`) pin the gate; provider-pattern detection is exercised with
values built in test code so the committed suite carries no real-shaped secret.
