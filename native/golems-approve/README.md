# Golems approval helper (draft; not enrolled)

Parked: Reviewed draft; signing runs in a brainlayer workflow (separate PR); nothing enrolled or signed.

The helper signs the exact canonical UTF-8 JSON read from stdin using P-256
ECDSA/SHA-256 (X9.62 DER on stdout). The gate binds command, operations,
repository/branch, full directory, Git provider, destination-config digest,
nonce, session and issue/expiry timestamps. Expiry is at most 300 seconds.
A different signature, scope, session or consumed nonce refuses.

## Readable approval box

The helper parses the signed bytes and constructs the box in this order:

1. **What happens:** fixed gate copy derived from the parsed operation and target.
2. **Why (the agent's words, not checked):** optional, visually below the gate's copy.
3. **Operation:** the parsed class.
4. **Command:** full exact command, never shortened.
5. **Directory:** at most 96 ASCII characters plus `...`; full cwd remains signed.
6. **Expires:** local wall-clock date/time with timezone offset.

Delete, force-push, explicit lease, history rewrite and protection-settings shapes
have separate sentences. Unknown class, ambiguous target, multiple branches,
wildcard or unsupported command shape refuses; there is no generic fallback.
For GitHub URLs the sentence names the owner/repo, otherwise it names the actual
repository URL. The same derivation is checked in the verifier. GitHub CLI/alias
operations still refuse on the enclave path until their actual target can be
resolved exactly. Settings rendering is limited to explicit ruleset/protection
endpoints; it does not enable the currently refused gh entry point.

Supply explanatory text with `golems-confirm --enclave --reason 'explanation'`
(or the token JSON `reason` field). Absent omits the Why line. The optional reason
is at most 200 Unicode code points, on one line: letters, numbers, punctuation,
symbols and ASCII space only. Controls, bidi, format/zero-width and combining
marks refuse; nothing is stripped, normalized or truncated. Its bytes are signed
so the record contains what the owner saw. It never chooses the operation
sentence or changes the authorized command/scope. Caller `asked_by` or
`what_happens` labels are ignored. Noncanonical/duplicate JSON, unsafe rendered
fields and a reason box over 1000 UTF-8 bytes refuse.
Actual OS dialog layout, wrapping and truncation remain NOT_RUN.

## Known identity and committed packaging inputs

The owner's Developer ID profile pins:

- Team ID: **PPN23G925Y**.
- Application identifier and concrete helper group: **PPN23G925Y.com.golems.approve**.
- Profile group allowlist: **PPN23G925Y.*** (covers the concrete group).
- Profile expiry: **2044-11-10**.
- SHA-256: **7287dac8a8a9b3308da5b96428471db1afb100ee6bf26250f2d5ff79082eef4f**.

The profile was decoded/read only and is NOT committed or copied into golems.
Signing uses the committed `Info.plist` (bundle identifier, executable, APPL) and
`GolemsApprove.entitlements` (application identifier, team identifier, concrete
keychain group; no other entitlements). The separate signing workflow stages
those exact files and the pinned profile as `Contents/embedded.provisionprofile`.
It builds/signs on a machine where agents do not run; the team private key must
never be reachable by agents on the enrolling Mac. This lane does not search for,
choose, import, export or use a signing identity.

The production helper also checks its Team ID, application identifier/group,
hardened runtime and absence of get-task-allow/library-validation relaxation.
There is no software-key provider in its target. `swift test --package-path
native/golems-approve --scratch-path .build.noindex/golems-approve` builds it and
runs test-target-only software signers. No ad-hoc build is native approval proof.

## Root installation and enrolment (documented only; NOT_RUN)

The owner installs the already-signed app from the signing workflow in one step:

```sh
sudo /bin/sh -c '
set -eu
/usr/bin/install -d -o root -g wheel -m 0755 /Library/PrivilegedHelperTools/com.golems.approve
/usr/bin/ditto "$1" /Library/PrivilegedHelperTools/com.golems.approve/GolemsApprove.app
/usr/sbin/chown -R root:wheel /Library/PrivilegedHelperTools/com.golems.approve/GolemsApprove.app
/bin/chmod -R go-w /Library/PrivilegedHelperTools/com.golems.approve/GolemsApprove.app
' sh /path/to/signed/GolemsApprove.app
```

Only then run `scripts/golems-enclave-enroll` from an owner terminal. Before
reserving the public file or invoking `--enroll`, it requires:

- Every ancestor and the helper binary root-owned, without group/world write or symlinks.
- The exact binary to pass `codesign --verify --strict -R` against the committed
  `anchor apple generic and certificate leaf[subject.OU] = "PPN23G925Y" and identifier "com.golems.approve"`.
  `-R` receives `=` to select literal requirement text, not a file path.
- The installed bundle's embedded profile to be a root-owned regular file,
  match the SHA-256 above and decode to the expected Team/application identifier
  and wildcard profile group. Hash and decode use the same byte snapshot.
- `security find-identity -p codesigning -v` to return ONLY `0 valid identities found`
  on the enrolling Mac; any identity, unexpected output or failure refuses.

The Secure Enclave key is permanent, P-256, in the data protection keychain,
`WhenUnlockedThisDeviceOnly`, using `privateKeyUsage | biometryCurrentSet` and the
concrete group above. Each request has a fresh LAContext, zero reuse, no fallback
button and a 120-second process deadline. No passcode policy is requested.
Enrolment exercises private-key usage once with Touch ID, refuses to replace a
key, stores only SPKI DER at `~/.config/golems/enclave-public.der` (0600) and prints
the PUBLIC key/pin. The pin requires a separate reviewed `anchor.pins` PR, then
normal hooks-live activation. An interrupted enrolment needs owner recovery;
never automatically delete/replace a reserved file or orphaned key.

## Threat model, remaining policy and proof limits

An agent may forge the caller, receipts, tokens, environment or helper exit codes;
only a signature from the pinned key authorizes an enclave token. Root custody
and the pinned designated requirement protect the enrolment trust boundary.
Provisioning enforcement binds the group; another Team's rebuild cannot use the
key. Possession of the same Team's signing authority can create an entitled
substitute and remains a custody boundary.

`--approval-receipt` carries a recorded affirmative question-tool JSON receipt
with exactly approved=true, cwd, command and session_id. It is spent before the
prompt and is context, never authenticated presence. A fake receipt still needs
the enclave signature. Existing SSH human/lead paths remain unchanged.

F5: pin labels currently have no semantic effect; the SPKI shape/hash prevents
cross-format reuse. Label separation remains separate work. F6: `kind: human`
stays weak until orc rules on retirement; enclave verification still requires the
locked SSH anchor, so retiring SSH must preserve or decouple it. Same-UID
hooks-live can be committed and the writable replay ledger can be removed.
Signed nonce/expiry do not make that ledger tamper-proof.

The Git path is bound, not contents or repointable Homebrew symlinks. SSH wrapper
contents, ~/.ssh/config, DNS, shell-startup environment and check-versus-run
remain. A privileged gate that executes the push with fixed Git/environment and
a protected replay store is the future execution-boundary fix.

Real signing, installed profile/code validation, Secure Enclave creation/signing,
Touch ID display/cancel/timeout, changed biometry, alternate-signature key denial,
root install and enrolment: **NOT_RUN** here. Read-only profile metadata and
software-key tests do not establish those native properties.

Apple's [key protection](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave),
[data protection keychain](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains),
and [provisioning contract](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
describe the platform boundaries.
