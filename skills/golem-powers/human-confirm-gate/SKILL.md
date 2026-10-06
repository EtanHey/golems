---
name: human-confirm-gate
description: Mechanical confirmation for destructive Git and repository administration commands.
---
# Human confirmation gate
Status: source implementation; install only from hooks-live after lead review/merge.
A chat turn, send_to, sender stamp, or model assertion is never approval.
The Claude PreToolUse hook classifies shell commands with `_shared/shell_parse`.
Simple literal assignments resolve command/argument words (including #500);
unresolved protected executable scope and xargs Git/GH/shell executors deny.
It blocks force/lease pushes, positive-force refspecs, remote deletes, mirror/prune,
filter-repo/filter-branch/replace (conservatively even local rewrites), replacement
ref pushes, repo visibility/delete/archive/rename/default-branch/forced-sync,
and GitHub settings/ruleset/protection/delete/transfer API mutations.
Ordinary pushes with redirects/pipes, PR comments/reviews/labels, read-only
Git global options and config overrides pass. Unknown cwd/executable/config
scope denies when it could affect a protected operation. The gate inspects
known wrappers, shell -c/trap and literal stdin payloads, Git executors and
same-call config mutations; opaque shell stdin sources deny. Unclosed input
and policy/import/runtime errors deliberately deny (exit 2).

**Fleet false positives.** `tests/fleet_commands.json` holds about 5,000
values-stripped shapes of real Claude and Codex Bash commands. The gate must
deny at most 0.5% of them, and every deny carries a reason category. What
the gate treats as data:
- **Quoted heredoc bodies** (`<<'EOF'`): prose such as backticks or
  apostrophes is not a substitution. This applies only when the shared parser's
  line view and a bash-faithful scan agree on every heredoc; otherwise the
  whole command is scanned. Unquoted bodies are never masked.
- **Prose arguments** with an apostrophe, unless they carry a Git/GH payload.
- **Script operands:** `bash file` reads its script from the file, and
  `bash -n` runs nothing. A shell with no operand, `-s`, `-`, a stdin path or
  process substitution reads stdin, so it is opaque and denies. A bare
  interactive shell denies too. Options are read per shell (bash/sh, dash,
  ksh, zsh, fish), including which ones take a value. An unknown long option
  denies. fish's `-C`/`--init-command`/`--command` are code, like `-c`.
- **Prefix assignments** (`X="$HOME/y" cmd`) are not the executable.
- **`command -v/-V`** only looks a name up.
- **Local-only git commands** (merge-base, check-ignore, …): no alias lookup.
- **`gh api` with a shell id:** the endpoint may use a shell value only as a
  whole id segment under pulls/issues/comments/reviews/commits/runs/jobs/
  check-runs of a literal `repos/<owner>/<repo>`. A dynamic GET route is a
  read only if it starts with a literal, is the only endpoint word, and no
  expansion in the call can word-split. An expansion can split if it is
  unquoted, or if its quoting was lost through a wrapper or an alias. A word
  led by an expansion makes the method unknown: the shell value may be a gh
  flag.
- **GraphQL:** a `$name` the query declares is GraphQL syntax only if every
  `$name` in the command is single-quoted, so the shell never expands it.
  Values of fields other than `query`/`operationName` are variables and cannot
  change the operation.

**`gh api` routes:**
- **Flags are read the way gh reads them** (pflag): short clusters such as
  `-iX`, a value attached with `=` or the rest of the cluster, and `--flag=v`.
  An unknown flag denies. A second endpoint word denies unless the request is a
  read. A method-override header makes the method unknown.
- **The route is what gh requests:** `?query` and `#fragment` are dropped,
  and any `.`/`..` segment or a non-`api.github.com` URL host denies.
- **GraphQL mutations deny by default.** Only routine review/comment fields
  pass (comments, reviews, review threads, reactions, labels, review requests,
  draft/ready). A fragment spread at the top of a mutation, an unreadable
  mutation document, `--input`, and a `-F query=@file`/`@-` document all
  deny.

**Git routes:**
- Executable names are case-folded (APFS is case-insensitive), so `GIT`,
  `Git`, `GH` and absolute paths in any case are the same commands.
- git's per-subcommand executables are treated as the matching git subcommand.
- At push time the gate evaluates the *effective* route: the remote picked by
  `--repo`, `branch.<b>.pushRemote`, `remote.pushDefault` or `branch.<b>.remote`,
  plus that remote's configured `push` refspecs and `mirror`, when the command
  names none. So a stored force/delete refspec or mirror needs a token on the
  plain push that uses it. (`:` alone is git's "matching" refspec, not a delete.)
- Tokens bind a digest of that route's config (URLs included, values never
  copied), so changing the remote after issuance invalidates the token.
- Storing a destructive route needs a token too:
  - `git config` setters of a force/delete `remote.<r>.push` or a true `mirror`;
  - Write/Edit/MultiEdit whose resulting git config (`.git/config`,
    `config.worktree`, or the repo's common-dir config) would hold one. The
    edit is simulated on the current file.
- Other writers to git config (shell redirects, includes) are judged at push
  time instead.
The common fail-open launcher retains its existing infrastructure contract:
a missing script or Python syntax failure before `main()` runs allows. This
hook catches evaluator/import errors, not launcher failures. Installer status
must therefore be checked before calling this an installed mechanical gate.
This only covers Claude tool calls; Codex exec_command is not wired to it.
## Trust and issuance
Unsigned file metadata cannot identify a human under the shared macOS UID.
Tokens are SSH-signed JSON, mode 0600, in
`~/.config/golems/human-confirm/<32-lowercase-hex-nonce>.json`, with an adjacent
`.json.sig`. The owner provisions mode-0600
`~/.config/golems/human-confirm-anchor/allowed_signers` out of band, with SSH allowed
signers principals `human` and `lead` (separate keys). The `human` signing key
must be unavailable to agents: a separate owner-controlled signer or hardware
key requiring owner presence. Only the owner creates/signs human tokens;
workers never mint them. A software private key in the shared workspace/HOME
is insufficient. The lead signer must be unavailable to workers; under one UID
this is an operational trust boundary, not enforced key isolation.
Detectable Bash writes/deletes and Write/Edit/MultiEdit/NotebookEdit attempts
to the policy directory deny, including case variants. Monitor commands use
the same evaluator as Bash.
A file copied by an agent cannot gain approval without the issuer's signature.
The same-UID threat frontier remains: this hook is not an OS sandbox; a malicious
process can replace the hook, configuration, or tombstones. Arbitrary interpreter
code, sourced files and external shell startup aliases remain outside static
inspection. Unknown wrappers carrying recognizable protected Git/GH argv deny.
Unregistered tool surfaces remain outside this hook. No owner-origin claim
is made from PID, timestamps, mode, or chat provenance.
Use `scripts/golems-confirm <repo> <ref> <action> --session <id>` from a
separate owner terminal; lease also needs `--sha <full-sha>`. See README for
1Password SSH-agent public-key setup and required per-request authorization.
Cached application/all-process authorization is insufficient human proof.
The helper uses ssh-keygen -U to require the agent; ancestry checks are only
advisory detection. The per-request signer prompt is the owner-presence control.
### Trust anchor integrity
The anchor lives in its own directory, `~/.config/golems/human-confirm-anchor/`,
so locking it never touches the other files under `~/.config/golems`.
It holds exactly one plain key for `human` and at most one for `lead`.
Options are not allowed, so no `cert-authority` and no shared principals.

**Provisioning (owner terminal):**
1. Create the directory mode 0700 and place the allowed signers file there.
2. Run `scripts/golems-confirm-pin` from the pinned tree (the golems repo's
   `.worktrees/hooks-live`). Do not run it from a dev checkout an agent can edit.
3. It prints each principal with its key's `SHA256:` fingerprint. Compare
   them with your signer, then type `PIN`. Only then does it set macOS `uchg`
   on the file and the directory and print one pin line.
4. That line lands in this skill's `anchor.pins` through a reviewed PR.

The pin lives in the pinned hooks-live tree, not the policy directory, so
clearing flags and rewriting the anchor cannot also re-pin it.

`anchor.pins` grammar is shared with `install-hooks` (`tests/pin-vectors.json`):
ASCII, LF lines; each line is empty, a printable `#` comment, or 64 lowercase
hex plus an optional ` label` (`[A-Za-z0-9._-]+`). Anything else voids the pin.

**Every token check** denies every human and lead token, with the hook's
static message, unless all of these hold:
- `anchor.pins` in the hook tree is byte-identical to its blob at that
  tree's git HEAD, so uncommitted edits in hooks-live never re-pin. Git is
  pointed at the tree root explicitly, with object replacement off and
  discovery stopped at the root. Any repository marker between the pin and
  the root denies;
- the anchor, opened fd-relative with no symlinks, has `uchg` on the file and
  the directory, mode 0700/0600, owner UID and a single link;
- its SHA-256 is pinned, and its principals pass the grammar above.

SSH verifies the checked bytes through a pipe and never reopens the path.

**Hook imports.** The installer runs this gate as `python3 -I -B` through the
shared launcher, like every golems Python hook. The launcher loads what
`runpy` needs first, and adds every hook directory LAST on `sys.path`, never
first. The gate then:
- takes its own directory and `_shared` off `sys.path` while the stdlib loads,
  and adds them back last;
- compiles its modules from source, never reading cached bytecode;
- denies every call while compiled modules, symlinks or shadow packages sit
  beside its sources.

**Installer.** `install-hooks` never activates this gate while `anchor.pins`
holds no fingerprint. An `--update` to an unpinned commit unlinks and
deregisters it, and `--status` reports `refused(unpinned)`. Order: merge, then
the owner pins, then the fingerprint PR, then hooks-live install. Key rotation
means an owner-terminal unlock, review and repin, plus a new pin PR. Never
repin automatically on a mismatch.

**What `install-hooks --status` detects** (exit 1). Git runs with
fsmonitor and the untracked cache off, and object replacement disabled:
- tracked edits, and untracked files that are not gitignored, in hooks-live;
- index flags (skip-worktree, assume-unchanged) on any path, and any replace refs;
- for each `requiresPin` gate, its source dir and `_shared` compared
  byte-for-byte with HEAD. That reports changed, missing and extra files,
  ignored ones included. `__pycache__` is skipped because the gate never reads it;
- a hooks-live HEAD that is not on origin/master;
- a HEAD that differs from the SHA recorded by the last `--apply`, or no
  recorded SHA.

It does not cover ignored files outside the gate's import dirs. It cannot see
a same-UID edit that is reverted before it runs, or tampering with git's own
refs and recorded SHA together. The hook does not inspect its
own source at runtime: a same-UID process that rewrites hooks-live's hook code
or commits there defeats the gate until `--status` flags it.

**Early fail-closed argv checks** are defence in depth, not the boundary. They deny:
- `chflags`/`SetFile` whose targets are unresolved (glob, brace, variable,
  substitution, `~user`), relative under an unknown or wrapper-changed cwd,
  or able to reach the anchor or pinned tree, including `-R` on an anchor ancestor;
- flag executors fed targets by `xargs`, `parallel` or `find`;
- non-reader commands whose literal operands name the anchor directory or
  pinned tree (`ln` also of an anchor ancestor), and Write/Edit to either.

They do NOT catch:
- writes through clustered short options, awk/sed write commands, or relative
  operands after an unresolvable `cd`;
- `git` inside hooks-live;
- removing an ancestor of hooks-live (the fail-open launcher then allows);
- interpreter code (`python -c`, `osascript`).

The anchor's uchg/hash and the committed pin are what catch these outcomes.

**By-design over-denies:**
- `chflags` with any glob, or with a relative target under an unknown cwd or a
  wrapper (e.g. `timeout 5 chflags …`);
- `--opt=<anchor path>` and copying the anchor out with a non-reader.

`cd -`, `pushd`/`popd` stacks and CDPATH searches make cwd unknown.
This is tamper evidence within the tool boundary, not an OS sandbox.
Anchor provisioning/runtime are macOS-only. Unsupported hosts refuse tokens;
CI skips those runtime fixtures explicitly, while structural tests still run.
Prepare a JSON draft in the repo's `docs.local/` with these fields:
- `version`: 1; `kind`: `human` or `lead`; `nonce`: random 32 lowercase hex.
- `issued_at`, `expires_at`: Unix seconds, maximum TTL 300 seconds, no future issue.
- `command_sha256`: SHA256 of exact hook `cwd` + NUL + exact Bash command.
- `operations`: output of `hooks/commands.py:operations(command, cwd)`.
- `session_id`: the Claude worker session ID from the hook input.
- `collab`: collab path, for lead tokens only.
Review the exact command, repo, remote, refs and operation classes, then the
issuer copies the draft to the token path, chmods 0600, and signs it:

```sh
ssh-keygen -Y sign -U -f <issuer-controlled-public-key> -n golems-confirm <nonce>.json
```

The hook verifies raw JSON bytes using `ssh-keygen -Y verify`; there is no model
judgement. The digest scopes the complete command (including wrappers) and cwd;
operations scope repo/ref/class/lease SHA; session binding prevents cross-worker
reuse. A valid human token permits its entire scoped command. A `.spent` nonce
is atomically created before capability deletion; keep tombstones permanently.
Even a restored token is denied. Failed execution still consumes approval: get
a fresh token for retries. Concurrent callers cannot consume the same nonce.

## Lead scope

The signed lead token additionally needs an exact line in its signed `collab`.
The resolved path must be inside the coordinator's collab directory (see the
private installation handoff for the machine layout). The line contains
`GOLEMS_CONFIRM ` followed by the token JSON sorted by key, compact separators
`,` and `:`. Ordinary prose or an unlogged token denies. Signing proves lead
issuance; the collab line logs the exact session/ref/SHA/command authorization.

Only a single literal `git [-C <repo>] push
--force-with-lease=refs/heads/<branch>:<full-sha> <remote>
<source>:refs/heads/<branch>` qualifies. Bare force, bare lease, multiple refs,
wrapped/compound commands and other classes require human tokens.
The current local branch must match, source must be HEAD/current branch,
remote must resolve to one GitHub URL, and live read-only GH metadata must show
that exact remote repo's open, unmerged, same-repository PR at the exact lease
SHA, on a non-default branch. The signed session/ref grant asserts worker
ownership; branch names and GitHub author alone do not establish worker identity.
Metadata failures or timeouts deny. Binaries are fixed system Git/SSH, and
gh from fixed, ownership-checked Homebrew locations, avoiding caller PATH substitution. No real destructive operation is used in
verification; integration tests invoke the hook subprocess with signed synthetic
capabilities and disposable repos under docs.local.
