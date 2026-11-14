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
