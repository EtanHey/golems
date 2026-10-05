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
Create that directory mode 0700 in an owner terminal and place the allowed
signers file there. After reviewing its keys, run
`python3 scripts/golems-confirm-pin` from that owner terminal. It sets macOS
`uchg` on the file and directory and prints one fingerprint line.
That line lands in this skill's `anchor.pins` through a reviewed PR. The pin
therefore lives in the pinned hooks-live tree, not in the policy directory, so
clearing flags and rewriting the anchor cannot also re-pin it.
Every token check opens the anchor fd-relative with no symlinks and verifies
these, or the hook issues its static denial for every human and lead token:
- `uchg` on the file and the directory;
- mode 0700 on the directory and 0600 on the file, and owner UID;
- a single link to the file;
- SHA-256 equal to a pinned fingerprint. A missing, empty or malformed pin denies.

SSH verifies the checked bytes through a pipe and never reopens the path.
`install-hooks` refuses to activate this gate while `anchor.pins` holds no
fingerprint (it never installs a gate that would deny every token). Order:
merge, then the owner pins, then the fingerprint PR, then hooks-live install.
Key rotation means an owner-terminal unlock, review and repin, plus a new pin PR.
Never repin automatically on a mismatch.

Early fail-closed checks are defence in depth, not the boundary. They deny:
- `chflags`/`SetFile` whose targets are unresolved (glob, brace, variable,
  substitution, `~user`), relative under an unknown or wrapper-changed cwd,
  or able to reach the anchor or pinned tree, including `-R` on an ancestor;
- flag executors fed targets by `xargs`, `parallel` or `find`;
- any non-reader command naming the anchor directory or pinned tree, so
  `ln` (also of an ancestor), `rsync`, `ditto`, `dd`, `curl -o` and `tar -C`;
- Write/Edit tools on the anchor or pinned tree.

`cd -`, `pushd`/`popd` stacks and CDPATH searches make cwd unknown.
Interpreter code (`python -c`, `osascript`) and `git` operations inside
hooks-live stay outside static inspection. A same-UID process can still
replace hooks-live itself: that shows as drift in `install-hooks --status`.
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
Metadata failures or timeouts deny. Binaries are fixed system Git/SSH and Homebrew
gh, avoiding caller PATH substitution. No real destructive operation is used in
verification; integration tests invoke the hook subprocess with signed synthetic
capabilities and disposable repos under docs.local.
