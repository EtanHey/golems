# human-confirm-gate: owner setup

These are the owner steps that make the gate's tokens verifiable. Run every step from a
terminal you control, outside any agent. `SKILL.md` describes what the gate enforces.

## 1. Human signing key (1Password SSH agent)
- In 1Password, create an SSH key for confirmations and enable the 1Password SSH agent.
- Set per-request authorization to *ask every time*. A cached, all-process approval is not
  proof of a human.
- Export the PUBLIC key only, to `~/.config/golems/human-confirm.pub`.
  `scripts/golems-confirm` signs through the agent (`ssh-keygen -Y sign -U`), so the
  private key never touches disk.
- `ssh-keygen` asks only the agent at `SSH_AUTH_SOCK` and ignores `IdentityAgent`. If that
  agent does not list the key, `golems-confirm` tries the `Host *` `IdentityAgent` in
  `~/.ssh/config`, then 1Password's default socket
  (`~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock`). It uses a socket only
  if you own it and it lists exactly this key, and only for the signing step. If no agent has
  the key, it stops before writing a token and names the key fingerprint and every socket it tried.

## 2. Lead signing key
- Run `scripts/golems-lead-keygen` once. It creates
  `~/.config/golems/lead-signer/lead_ed25519` (0600, directory 0700), refuses to
  overwrite, and prints one `lead ssh-ed25519 …` line. The private key is never printed.
- Under one macOS UID this key is an operational boundary, not isolation.

## 3. The trust anchor
- Create `~/.config/golems/human-confirm-anchor/` (mode 0700).
- In it, create `allowed_signers` (mode 0600) holding exactly two lines: `human <type> <key>`
  (the public key from step 1) and the `lead …` line from step 2. No options, no comments
  that look like keys.

## 4. Lock and pin
- From the pinned tree (the golems repo's `.worktrees/hooks-live`), run
  `scripts/golems-confirm-pin`.
- Compare each printed `SHA256:` fingerprint with 1Password (`ssh-add -l`) and with
  `ssh-keygen -lf ~/.config/golems/lead-signer/lead_ed25519.pub`, then type `PIN`.
- It sets macOS `uchg` on the anchor and its directory, and prints one pin line.

## 5. The pin PR
- Add that line to `skills/golem-powers/human-confirm-gate/anchor.pins` through a reviewed
  PR. Once hooks-live carries it, the installer stops refusing the gate.
- Never repin automatically after a mismatch: a changed anchor means every token denies,
  by design.

## Daily use

- **Own-branch leases:** see [SKILL.md, "Own-branch leases"](SKILL.md#own-branch-leases) for the narrow token-free exception.
- **Human tokens:** `scripts/golems-confirm <repo> <ref> <action> --session <id>` from your
  terminal, approved in 1Password per request.
- **Lead tokens:** `scripts/golems-lead-confirm` (see SKILL.md, "Lead tokens"), for lease
  pushes on a lead's own open PR branch only.

Push tokens hash the resolved Git executable path, its effective selected remote's
entire `remote.<name>.*` section, branch/push selection, `core.sshCommand`, `ssh.*`,
`protocol.*`, `http.*`, and `url.*` config, plus Git's resolved push URL list
(including legacy `.git/remotes` and `.git/branches` routes). Config is read using
that executable and the hook-visible environment, including inherited scopes and
includes. The digest also binds hook-visible `GIT_SSH`, `GIT_SSH_COMMAND`,
`GIT_SSH_VARIANT`, `GIT_PROXY_COMMAND`, `GIT_CONFIG`/`GIT_CONFIG_*`, and `GIT_EXEC_PATH`.
For destructive operations, the gate refuses covered variable names anywhere
in the command, including quoted function/eval bodies, declarations and unsets.
The set includes `GIT_COMMON_DIR`, `XDG_CONFIG_HOME`, `HOME`, `GIT_DIR`,
`GIT_WORK_TREE`, `GIT_CONFIG*`, `GIT_EXEC_PATH`, `PATH`, `GIT_SSH*` and
`GIT_PROXY_COMMAND`; `env -u` of a covered variable and `env -C/-P/-S`
also obscure scope. For plain pushes, only direct invocation prefixes or its
`env` wrapper supply the environment: unrelated assignments in a compound
command do not change that invocation's plain classification. An implicit
push under unresolved configuration writers cannot establish ordinary refs.
`GIT_ASKPASS` supplies credentials rather than choosing Git/config/transport.

Named residuals requiring separate work are `git --exec-path`, `BASH_ENV`,
and sourced files; this token check does not establish their runtime effects.

Only the digest travels in tokens. This wider binding invalidates older tokens;
tokens live at most 300 seconds, so reissue costs at most five minutes of approvals.

This pre-run check does not bind wrapper script contents, symlinks behind local
path URLs, `~/.ssh/config`, DNS, or shell-startup environment changes invisible to
the hook. State can also change between the hook check and Git execution. Closing
these gaps requires the gate to run the push itself with fixed config/environment
and the resolved URL; that execution-boundary redesign is outside this change.

## Secure Enclave draft

`golems-confirm --enclave` uses the parsed-token native helper and a separate
SPKI P-256 public-key pin in `anchor.pins`. See
[helper setup, threat model and NOT_RUN gates](../../../native/golems-approve/README.md).
No enclave key or pin ships with this draft. The SSH `kind: human` path remains
weak until owner enrolment and an orc decision to retire it. Git executable paths
are bound, not their contents (including repointable Homebrew symlinks). SSH
wrapper contents, ~/.ssh/config, DNS, shell-startup env and a check-versus-run
race remain; a future gate that executes pushes with fixed Git must close them.

## Archived fleet branch deletion

To delete a fleet branch: run scripts/fleet/archive-and-delete-branch.sh, then the command it prints.
Pass `<repo-dir> <remote> <branch>`. The helper fetches the branch, saves a full bundle,
verifies it, and prints one lease-pinned delete; it never pushes. It stages an isolated
bare repository under the archive so the bundle names exactly `refs/heads/<branch>`
without moving a local branch. Existing bundles are verified, never overwritten.

No signature is needed only for `git [-C <repo>] push
--force-with-lease=refs/heads/<branch>:<40-hex-tip> <remote> :refs/heads/<branch>`.
The same own-lease destination and push-configuration checks apply. The branch must
be non-shared, non-default, unprotected, and unused as head or base of any open PR.
Repository, branch and own-PR requests start concurrently; when the repository is a
fork, the discovered parent's open PRs with head `EtanHey:<branch>` are read while
the other requests are still running, within the same four-second deadline; errors, ambiguous data,
and a full 100-PR page refuse with a retry message rather than assume completeness.
A parent-read failure refuses. GitHub identity cannot distinguish agent work from owner work, so the exception
checks reversibility instead of authorship. All other delete forms retain approval.

The canonical bundle is `~/.golems/branch-archive/<owner>/<repo>/<branch with slashes
replaced by __>/<tip>.bundle`: user-owned, regular, no symlink, mode 0600 or 0644,
exactly one listed head matching the lease, and accepted by `git bundle verify`.
One parser reads the header from the same open fd: only v2, or v3 with exactly
`@object-format=sha1`, is accepted. Prerequisites and filter capabilities refuse;
the saved history must be complete. Every directory from `branch-archive` down
must be user-owned and not group/other-writable. The helper creates new directories
0700 and refuses unsafe existing directories rather than changing their ownership.
The gate appends and flushes a JSON receipt to `~/.golems/branch-archive/deletes.jsonl`
before allowing, with `event: "allowed_attempt"`, time, repository, branch, tip, bundle path and SHA-256. A receipt
records an allowed attempt, not proof that Git subsequently deleted the branch.
Git-guardian validates the exact shape through the same confirmation hook using
`--archive-check-only`: it writes no receipt. Only the mandatory gate hook writes
the allowed-attempt row, so one command crossing both hooks yields one row.
A caller-supplied payload cannot select check-only mode. Failure to write refuses.
The guardian selects an eight-second deadline only for this exact candidate shape;
its nested check times out after seven seconds, inside the nine-second installed
watchdog and ten-second harness budget. Ordinary commands keep three seconds.

The helper uses the hook installer's fixed absolute Homebrew Python candidates
(`/opt/homebrew/bin/python3`, then `/usr/local/bin/python3`), never PATH. Non-Mac
fixtures use `/usr/bin/python3`; Python 3.11+ is required and runs with `-I -B`.

Full bundles can be large: the review's t3code example was about 125 MB per branch.
Archives accumulate. Pruning is a later, explicit retention decision; this helper
never prunes saved bundles.

Restore from the saved bundle with `git fetch <bundle-path> refs/heads/<branch>`;
inspect the fetched tip before deciding to push it back. Keep the archive for recovery.
This pre-run policy does not prevent same-user edits after verification or a new PR
opening before the push; the lease still fences the deleted remote tip. Installed
hook activation and live GitHub deletion are separate release proof.
