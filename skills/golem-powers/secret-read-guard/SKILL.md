---
name: secret-read-guard
description: Refuse tool calls that would print a secret file, helper output, keychain password or environment; masked reader instead.
---

# Secret read guard

Every other golems gate guards writes. This one guards reads: on 2026-11-17 a
Codex worker printed the Claude-proxy key with a plain `cat` of a settings
file, and nothing stopped it.

## What it refuses

A Bash, Monitor, Read or Grep call that would put a secret on screen:

- **A listed file.** The list is data: `secret-files.json` (paths, basenames,
  Claude settings whose `env` block holds a secret-named key, and every
  `*.bak-*` copy). `cat`,
  `head`/`tail`, `less`, `bat`, `sed`, `awk`, `grep` (not `-c`/`-l`/`-L`/`-q`),
  `jq` (except a key-only filter such as `keys`), `base64`, `xxd`, `strings`,
  `diff`, editors, `git show HEAD:<file>`, interpreters given the file,
  `curl -d @file`, `< file` into anything but a counter or hash, and a copy or
  move of the file to a path the list does not cover (`cp .env /dev/stdout`,
  `cp auth.json notes.txt`). Any command not known to be safe is refused when
  an operand resolves to a listed file.
- **A file it can't name.** A printing command whose file is only known at
  run time (`f=$(grep -l ...); cat "$f"`, xargs input, `while read f`) is
  refused: fail-closed. The refusal says to run the lookup first and name the
  file literally. Globs, `~`, `$HOME`, inherited environment variables,
  variables the command assigns itself (`F=x.md; cat "$F"`), `for f in a b`
  lists, `cd` targets, and `find -name '*.ts' -exec head {} +` (a name pattern
  that can't match a listed file, outside secret folders) are resolved.
- **A recursive search into a secret folder** (`grep -r`, `rg`, content-mode
  Grep) that prints lines.
- **A secret helper:** running `claude-proxy-token` (the `apiKeyHelper`).
- **The keychain:** `security find-generic-password` / `find-internet-password`
  with `-w` or `-g`, and `security dump-keychain`.
- **Environments:** bare `env`, `printenv`, `export -p`, `declare -x`;
  `printenv`/`echo`/`printf`/`launchctl getenv` of a secret-named variable;
  `ps -E`, `ps e`, `ps eww`; `launchctl print|export|procinfo`;
  `/proc/*/environ`. Piping any of these into a names/count/yes-no filter is
  allowed: `env | cut -d= -f1`, `env | grep -c`, `env | sed 's/=.*//'`,
  `launchctl print ... | grep -q running`.
- **Inline interpreter code** (`python3 -c`, `node -e`, heredoc and
  here-string bodies) that names a listed path, opens a listed name
  (`open('.env')`), prints a secret-named variable, prints the whole
  environment, or runs the helper. Using a key from the environment without
  printing it (`( set -a; . x.env; set +a; python3 ... os.environ['KEY'] )`)
  is allowed.

## The masked reader

```bash
python3 ~/.claude/hooks/secret-read-guard/scripts/masked-read.py <file>
```

It prints the file's structure with every value replaced by
`<redacted len=N sha=xxxxxxxx>` (JSON, YAML, env and TOML aware; unknown
formats print key names only; comments are dropped). Equal values share a
sha, so two files can be compared without showing either. The guard exempts
exactly this file (by real path), not a look-alike. The refusal message names
the reader's path.

## Allowed

`ls`, `stat`, `test -f`, `wc -c`, `shasum`, `chmod`, `grep -c`, `jq 'keys'`,
`. file.env` / `source` (loading keys into a command is the sanctioned use),
`cp x.env x.env.bak-<date>`, reading `.env.example`, and every command that
names no listed file.

## Limits (say so, don't assume)

- Interpreter **scripts** (`python3 tool.py`) are not read; only their operands
  and inline code are checked. Paths built at run time in code
  (`os.path.join(home, ".codex", "auth.json")`) are out of reach.
- `source x.env && echo "$VAR"` is caught only when the variable name looks
  secret (`token`, `secret`, `password`, `api_key`, `credential`...).
- A recursive search inside a repo that holds a `.env` is not walked; `rg`
  skips hidden files by default, `grep -r` does not.
- Editing a listed file needs a path that never prints it: Claude's Edit tool
  needs a Read first (refused), and inline code that opens the file is
  refused. Use a script file or the tool that owns the file.
- These limits are why the keyout lane also takes secrets out of readable
  files. This guard narrows the accident; it is not a sandbox.

## Measured

Replaying 25,702 distinct real Bash commands from local Claude transcripts
(2026-11-24, scratch HOME, no real file read): 369 refused (1.44%); 265 of
those name a file only at run time, most of the rest really read a listed
file or an environment. Hook median 81 ms.

## Wiring

Claude: PreToolUse on `Bash|Monitor|Read|Grep`, fail-closed launcher.
Codex 0.171: native `PreToolUse` hook on `^Bash$` through
`scripts/hooks/codex-policy-hook.py` (Codex has no Read tool; shell is its
read path). Codex runs a new hook only after the owner trusts it from plain
`codex` via `/hooks`. Each denial appends `ts`, `input_sha256` and `rule` to
`~/.claude/logs/secret-read-guard-ledger.jsonl` (override:
`SECRET_READ_GUARD_LEDGER`), never the command text.
