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
- **Human tokens:** `scripts/golems-confirm <repo> <ref> <action> --session <id>` from your
  terminal, approved in 1Password per request.
- **Lead tokens:** `scripts/golems-lead-confirm` (see SKILL.md, "Lead tokens"), for lease
  pushes on a lead's own open PR branch only.
