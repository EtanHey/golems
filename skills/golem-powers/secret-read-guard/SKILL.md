---
name: secret-read-guard
description: Refuse tool calls that would print a secret file, helper output, keychain or environment; use masked reader.
---

# Secret read guard

Every other golems gate guards writes. This one guards reads: on 2026-11-17 a
Codex worker printed the Claude-proxy key with a plain `cat` of a settings
file, and nothing stopped it.

## What it refuses

A Bash, Monitor, Read or Grep call that would put a secret on screen:

- **A listed file.** The list is data: `secret-files.json` (paths, basenames,
  Claude settings whose `env` block holds a secret-named key, and every
  `*.bak-*`, `~`, `.orig`, `.old` and `.swp` backup), matched the way APFS
  names files: case-insensitive and
  Unicode-normalization-insensitive (`.ENV` is `.env`; composed `é` is
  `e` + U+0301).
  `cat`, `head`/`tail`, `less`, `bat`, any `sed` (in-place included: its
  `w` command can print), `awk`, `grep` (not `-c`/`-l`/`-L`/`-q`),
  `jq` (except a key-only filter such as `keys`), `base64`, `xxd`, `strings`,
  `diff`, editors, `git show HEAD:<file>`, interpreters given the file,
  `curl -d @file`, `< file` into anything but a counter or hash, and a copy or
  move of the file to a path the list does not cover (`cp .env /dev/stdout`,
  `cp auth.json notes.txt`). Any command not known to be safe is refused when
  an operand resolves to a listed file.
- **Links and moves.** `ln`, `ln -s`, `cp -l`/`-s` of a listed file, and `mv`
  from or onto a listed path. The whole command is judged before any of it
  runs, so a link made in it is invisible to a later read: every name this
  command links (or copies a listed file to) is an alias, and reading it later
  in the same command is refused.
- **A file it can't name.** A printing command whose file is only known at
  run time (`f=$(grep -l ...); cat "$f"`, xargs input, `while read f`) is
  refused: fail-closed. The refusal says to run the lookup first and name the
  file literally. Globs, `~`, `$HOME`, inherited environment variables,
  variables the command assigns itself (`F=x.md; cat "$F"`), `for f in a b`
  lists, `cd` targets, and `find -name '*.ts' -exec head {} +` (a name pattern
  that can't match a listed file, outside secret folders) are resolved.
- **A recursive search into a secret folder** (`grep -r`, `rg`, content-mode
  Grep) that prints lines, including a symlink into that folder. Content-mode
  Grep over a directory enumerates candidates with `rg --files`, with the same
  path, glob and type; any listed file refuses the search regardless of pattern.
  Enumeration fails closed after 2 seconds, 10,000 files or 2 MiB of names,
  or on a tool error. Grep globs containing `{` or `[` are refused; other
  globs are checked against representative listed names before enumeration.
- **A secret helper:** running `claude-proxy-token` (the `apiKeyHelper`).
- **The keychain:** `security find-generic-password` / `find-internet-password`
  with `-w` or `-g`, and `security dump-keychain`.
- **Environment dumps, in any form or pipeline, no exceptions:** `env` with no
  command (`env -0` too), `printenv` (any argument), `export` bare or `-p`,
  bare `set`, `declare`/`typeset` bare or with `-p`/`-x`, `compgen -e`;
  `echo`/`printf`/`launchctl getenv` of a secret-named variable; `ps -E`,
  `ps e`, `ps eww`; `launchctl print|export|procinfo`; `/proc/*/environ`.
  `env NAME=value cmd` (env as a wrapper) still runs. Variable names only?
  Use a script file.
- **Inline interpreter code that touches the environment at all.** For
  python, node, ruby, perl, php, deno, bun, osascript and the rest: inline
  code in any spelling (`-c`/`-e`, clustered `-Ic`/`-sc`, attached `-cCODE`,
  `--eval=CODE`, `-p`, `-r`, `deno eval`, `-`, a heredoc or here-string with
  no script file) is refused if it references `os.environ`, `environ`,
  `getenv`, `process.env`, `ENV`, `%ENV`, `Deno.env`, `Bun.env`, AppleScript
  `system attribute` / `do shell script`, Swift `ProcessInfo`/`.environment`,
  Scala `sys.env`, or Tcl `$env(`, `env(`,
  `array get env`, `parray env`. The same goes for awk-family `ENVIRON` and
  jq/yq `env`, `$ENV`, `strenv` (a `.env` field is fine). Code piped on stdin
  into any interpreter or shell (`echo 'puts $env(K)' | tclsh`,
  `echo printenv | sh`, `cat <<EOF | node`) is inline code too; a variable in
  it means the code only exists at run time, so it is refused. Output of
  another command piped in (`cat tool.py | python3`) counts as a script file.
  A heredoc or here-string fed to any shell, `eval`'s arguments and
  `source /dev/stdin <<EOF` are judged as shell text; `source <(...)` is
  refused. `busybox`/`toybox <applet>` is judged as the applet.
  No name matching: aliases (`e=os.environ; print(e)`) leave nothing to match. It is
  also refused if it names a listed path, opens a listed name
  (`open('.env')`) or runs the helper. Code that needs a key belongs in a
  script file; `( set -a; . x.env; set +a; python3 tool.py )` keeps working.

## The masked reader

```bash
python3 ~/.claude/hooks/secret-read-guard/scripts/masked-read.py <file>
```

Exactly that argv: `python3 <reader> <files>`. Any interpreter option
(`-I`, `-X`, `-c`, `-m`, `-W`...) or other shape, direct execution included,
is not exempt. It prints the file's structure with every value replaced by
`<redacted len=N sha=xxxxxxxx>` (JSON, YAML, env and TOML aware; unknown
formats print key names only; comments are dropped). Equal values share a
sha, so two files can be compared without showing either. The guard exempts
exactly this file (by real path), not a look-alike. The refusal message names
the reader's path.

## Allowed

`ls`, `stat`, `test -f`, `wc -c`, `shasum`, `chmod`, `grep -c`, `jq 'keys'`,
`. file.env` / `source` with a script or binary after it (the sanctioned way
to use a key), `env NAME=value cmd`,
`cp x.env x.env.bak-<date>`, reading `.env.example`, and every command that
names no listed file.

## Known limits

**This guard is a speed bump plus an audit trail, not a sandbox.** It parses
shell text and cannot enumerate every interpreter, applet, encoding or
indirection an agent could use to read a file or the environment. The primary
control is keeping secrets out of agent-readable files: the keyout lane's
`apiKeyHelper` plus the macOS keychain. Treat a refusal as a nudge toward the
masked reader or a script file, and a pass as "no known shape matched", never
as proof that nothing leaked.

Specific gaps known today:

- Interpreter **scripts** (`python3 tool.py`) are not read; only their operands
  and inline code are checked. Languages with only file runners (`go run`)
  are the same.
- Shell text is judged with bash meanings: fish's `set -x` / `set --show`
  list exported variables there, but `set -x` is tracing in bash, so it is
  not refused. Paths built at run time in code
  (`os.path.join(home, ".codex", "auth.json")`) are out of reach.
- `source x.env && echo "$VAR"` is caught only when the variable name looks
  secret (`token`, `secret`, `password`, `api_key`, `credential`...).
- Bash recursive searches inside ordinary repos are not walked; `rg` skips
  hidden files by default, `grep -r` does not. Directory content-Grep now
  checks rg's candidate files, but shares rg's default ignore/hidden rules.
  Filesystem changes between the check and the actual search remain a race.
- Editing a listed file needs a path that never prints it: Claude's Edit tool
  needs a Read first (refused), and inline code that opens the file is
  refused. Use a script file or the tool that owns the file.
- These limits are why the keyout lane also takes secrets out of readable
  files. This guard narrows the accident; it is not a sandbox.

## Measured

Replaying distinct real Bash commands from local Claude transcripts (scratch
HOME, no real file read): round 0, 369 of 25,702 refused (1.44%); round 1
(stricter env, sed and inline-code rules), 379 of 24,904 (1.52%); round 2
(final class rules: any env reference in inline code, no env-dump
exceptions), 431 of 24,892 (1.73%); round 3 (awk/jq/AppleScript/Tcl env
reads, piped stdin code), 432 of 24,880 (1.74%). About 60% of refusals name a file only at
run time; most of the rest touch a listed file or the environment. Hook median
81 ms.

## Wiring

Claude: PreToolUse on `Bash|Monitor|Read|Grep`, fail-closed launcher.
Codex 0.171: native `PreToolUse` hook on `^Bash$` through
`scripts/hooks/codex-policy-hook.py` (Codex has no Read tool; shell is its
read path). Codex runs a new hook only after the owner trusts it from plain
`codex` via `/hooks`. Each denial appends `ts`, `input_sha256` and `rule` to
`~/.claude/logs/secret-read-guard-ledger.jsonl` (override:
`SECRET_READ_GUARD_LEDGER`), never the command text.
