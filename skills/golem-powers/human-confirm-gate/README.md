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

## Carry a T3 option approval (source; requires reviewed installation)

An agent can record the question and selected affirmative option with
`scripts/golems-approval record --input <receipt.json>`. The JSON object needs
`question` and `answer` verbatim; `answer_kind: "option"` and
`affirmative_option` equal to `answer` (supported labels: `Approve`, `Yes`,
`Approve deletion`); `t3_request_id`, `t3_thread_id`, `asked_by`, `command`,
`repo_remote` (exact origin URL), `ref` (full branch ref), and
`expected_remote_sha` (40 lowercase hex). Optional `ttl_hours` defaults to 24,
maximum 72. The question must contain the exact command or both the URL and ref.
The helper supplies timestamps and a random ID, creates the record exclusively
in `~/.config/golems/approvals/` (0700, files 0600), and refuses symlinks.

From the target repository, the agent then runs
`scripts/golems-confirm --approval <id> --session <sid> --command '<exact command>'`.
Only a single literal `git push --delete origin refs/heads/<branch>` is supported.
The command, parser operation, fetch/push URL, and current remote tip must match.
The helper shows a native **Touch ID** prompt naming the repository, branch,
command, seat and receipt time. It refuses if Touch ID is unavailable, cancelled
or times out; there is no password, stdin or environment fallback. The Swift
helper requires macOS and the Xcode command-line tools. The issuer then signs
through the existing owner SSH agent and verifies the unchanged pinned anchor.
An SSH agent may additionally show its configured key-use prompt.

The receipt is untrusted metadata, not authenticated evidence from T3. Even a
forged receipt cannot grant authority without native presence and the owner key.
A locked, fsynced consumed ledger makes carry single-use; it is appended before
any token write. Failed signing leaves the record spent. Token TTL is at most
300 seconds and never extends beyond the receipt expiry. Default owner-terminal
mode still refuses inside an agent. No hook or token-verifier change is needed.

The tip check occurs at issuance, including after the prompt. This does not
provide an atomic compare-and-delete at eventual Git push time: the existing
token format cannot fence a remote tip that moves after issuance.
Real Touch ID presentation and SSH-agent signing are **NOT_RUN** in CI; tests
inject only the presence seam and use disposable signing keys for hook proof.
