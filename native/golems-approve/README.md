# Golems approval helper (draft; not enrolled)

The helper signs the exact canonical UTF-8 JSON read from stdin, using P-256
ECDSA/SHA-256 (X9.62 DER signature on stdout). It parses the bytes and constructs
its own reason showing repository URL, refs/targets, operation, directory, Git
provider, exact command, and expiry in local time. Caller labels are ignored.
Printable ASCII and bounded prompt length are intentional restrictions; controls,
bidi, invisible text, oversized displays and noncanonical JSON refuse. There is
no approval exit-code fallback. The verifier recomputes display scope as well as
the command hash and operations; lying display fields cannot yield a usable token.
Actual OS dialog layout/truncation remains a native qualification gate.

Each request uses a new LAContext with zero reuse, no fallback button, and a
120-second process deadline. The permanent Secure Enclave key uses
`privateKeyUsage | biometryCurrentSet`, `WhenUnlockedThisDeviceOnly`, an explicit
access group, and the data protection keychain. No passcode policy is requested.
The OS enforces provisioned access groups, not filesystem ownership. A different
Team's substitute cannot access the enrolled key. The signing identity and
provisioning credentials must themselves be inaccessible to agents; possession
of the owner's signing authority can create another entitled helper. Hardened
runtime, library validation and absence of get-task-allow are mandatory.

Apple's [key protection](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave),
[data protection keychain](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains),
and [provisioning contract](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
explain the platform boundaries. Signing alone does not grant a restricted group:
a matching Developer ID provisioning profile is required.

## Build and owner signing (not executed in this lane)

`swift test --package-path native/golems-approve --scratch-path .build.noindex/golems-approve`
builds both helper and parser tests. The software signer exists only in the test
target. An unsigned/ad-hoc build refuses before querying or creating a key.

For deployment, build/sign ONLY on the isolated signing machine where agents do
not run. Build release with `swift build -c release` and stage the executable as
`GolemsApprove.app/Contents/MacOS/golems-approve`. The already-signed bundle later
reaches the enrolling Mac through the root-install step below. Set the bundle's
CFBundleIdentifier to `com.golems.approve`, CFBundleExecutable to `golems-approve`,
and CFBundlePackageType to `APPL`. Embed the owner's matching Developer ID profile
as `Contents/embedded.provisionprofile`. Sign with the owner's Developer ID
Application identity, `codesign --options runtime --timestamp --identifier
com.golems.approve --entitlements <owner-entitlements.plist> --sign <identity>
<app>`, then verify with `codesign --verify --strict --verbose=2 <app>`.

The entitlements must contain `com.apple.application-identifier` =
`TEAMID.com.golems.approve`, `com.apple.developer.team-identifier` = `TEAMID`, and
`keychain-access-groups` = `[TEAMID.com.golems.approve]`. No get-task-allow or
runtime relaxation entitlements. TEAMID is the actual identity's Team ID, never
an invented value. An agent must not provision or export signing credentials.

Round-1 identity inventory (not refreshed in round 2): `security find-identity -p codesigning -v` returned
**0 valid identities found**. Team ID and concrete access group: **UNKNOWN**.
Developer ID signing, profile validation and installed helper: **NOT_RUN**.
No ad-hoc signature is offered as a substitute receipt.

## Owner enrolment after merge (NOT_RUN)

Enrolment stays disabled until the owner decides on signing, the real Team ID
lands in a reviewed PR, and the root install and zero-identity preconditions below
are met. Only then run `scripts/golems-enclave-enroll` once from the owner's terminal. It invokes the
signed helper's `--enroll`, refuses to replace a key, exercises private-key usage
with Touch ID, stores only SPKI DER at `~/.config/golems/enclave-public.der` (0600),
and prints the PUBLIC key and SHA-256 pin. Add the printed `enclave-owner` pin to
`skills/golem-powers/human-confirm-gate/anchor.pins` in a separate reviewed PR,
then update hooks-live through the normal installer. No automatic repinning.
An interrupted enrolment may leave a reserved public file or an orphaned key:
stop for owner recovery; do not rerun or delete either automatically.

## Issue and carry

Use `scripts/golems-confirm <repo> <ref> <action> --session <id> --enclave`.
Agents may invoke this path: only the enclave signature gives authority. One
explicit Git operation with one resolved remote URL is supported; shell
wrappers, multiple operations and ambiguous remotes refuse. Both issuer and hook
must resolve the same Git and GIT_* configuration. Existing `kind: human` and
lead paths stay intact, including their existing anchor requirement.

Optional `--approval-receipt <file>` carries a recorded affirmative question-tool
answer. The 0600 JSON has exactly `approved: true`, `cwd`, `command`, `session_id`;
all must match this invocation. It is spent before the helper prompt. It is
context, not authenticated human presence: fabricated receipts still require
Touch ID. There is no caller text in the native reason.

## Threat model and residuals

An agent may invoke, replace or rebuild the caller and may forge receipt files,
tokens or environment variables. Only the pinned public key authenticates an
enclave token. A software or SSH-agent key cannot create its signature. Token
nonce, issue/expiry, exact command, scope and destination digest are all signed;
nonce tombstones prevent ordinary replay. Under the same UID, deletion of the
writable spent ledger can defeat single-use within the short lifetime; this
inherited limitation needs an execution service/privileged replay store. Expiry
is enforced by signed timestamps and the verifier's wall clock, not the ledger.

The SSH `kind: human` path remains weak: any process with authorized SSH-agent
access can sign it until the owner enrols and orc rules on retiring that path.
The Git binary path is bound, not contents; a Homebrew symlink can be repointed.
SSH wrapper contents, ~/.ssh/config, DNS, shell-startup environment and the
check-versus-run race remain. The future fix is for the gate itself to run the
push with a fixed Git and environment. This draft does not claim that proof.

Real Secure Enclave creation/signing, Touch ID display/cancel/timeout, changed
biometry, substituted-signature key denial, enrolment and installed helper tests:
**NOT_RUN**. Swift/software-key and disposable hook tests are local evidence only.

## Round 2: enrolment is disabled pending the owner's signing decision

Parked: Reviewed draft; waits on the owner's decision about the signing identity (orc 20:46). Nothing enrolled or signed.

F1: The reviewed helper path is now beneath
`/Library/PrivilegedHelperTools/com.golems.approve/`. Every directory from `/` to
the binary, plus the binary itself, must be root-owned, not group/world-writable,
and not a symlink. The owner installs an already-signed app from a trusted signing
machine in ONE owner step (documented only, not run here):

```sh
sudo /bin/sh -c '
set -eu
/usr/bin/install -d -o root -g wheel -m 0755 /Library/PrivilegedHelperTools/com.golems.approve
/usr/bin/ditto "$1" /Library/PrivilegedHelperTools/com.golems.approve/GolemsApprove.app
/usr/sbin/chown -R root:wheel /Library/PrivilegedHelperTools/com.golems.approve/GolemsApprove.app
/bin/chmod -R go-w /Library/PrivilegedHelperTools/com.golems.approve/GolemsApprove.app
' sh /path/to/owner-signed/GolemsApprove.app
```

Before invoking that exact binary with `--enroll`, `golems-enclave-enroll` verifies
its signature using `/usr/bin/codesign --verify --strict -R` (the `=` prefix selects
a literal requirement rather than a file path) with the committed
requirement `anchor apple generic and certificate leaf[subject.OU] = "TEAMID_NOT_CONFIGURED" and identifier "com.golems.approve"`.
`ENROLL_TEAM_ID` deliberately remains `TEAMID_NOT_CONFIGURED`; enrolment refuses
this placeholder BEFORE reserving a public file or running any platform command.
A reviewed PR must set the owner's real Team ID. Environment variables, CLI flags
and caller labels cannot supply it. Root custody closes the check-versus-execute
replacement opportunity for a same-user agent at enrolment.

F2: Build/sign and retain the team key on a machine where agents do not run.
As an enrolment precondition, the enrolling agent Mac must return ONLY
`0 valid identities found` from `/usr/bin/security find-identity -p codesigning -v`.
Any identity, unexpected output or failed command refuses before `--enroll`.
Tests mock this command; this round performs no identity/certificate search.
Possession of the same Team's signing authority can produce another entitled
helper and remains the critical custody boundary. No new signing identity is
chosen, generated, imported or looked up by this work.

F3: `gh` commands refuse on the enclave path until their actual explicit/resolved
GitHub target can be rendered exactly; the cwd origin is never used as a gh target.
The existing SSH path and its policy are unchanged.

F4: Command is rendered immediately after Operation and is NEVER truncated.
Directory is last, shortened to its first 96 ASCII characters plus `...` when
needed. Full cwd remains signed and verifier-bound. Existing 400-byte field and
1000-byte reason limits refuse requests rather than shorten Command. Real OS
prompt layout/truncation remains NOT_RUN.

F5 (documented only): pin labels currently have no semantic effect; an enclave
SPKI hash under another label still passes. P-256 SPKI shape and SHA-256 binding
prevent cross-format reuse; future label separation is a separate change.

F6 (documented only): existing `kind: human` tokens stay accepted, so agents with
SSH-agent signing access can still use that weak path. Enclave verification still
requires the locked SSH anchor. Retiring SSH must explicitly decouple or preserve
that anchor. The same-UID hooks-live tree can be committed and the writable spent
ledger can be removed; this draft does not add a privileged runtime boundary.
