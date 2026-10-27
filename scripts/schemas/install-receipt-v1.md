# install-receipt/v1 — PR-A

`install-receipt-v1.mjs` exports the closed JSON Schema. The CLI uses the existing
Ajv dependency and registers `utc-time` for real UTC calendar timestamps.

```sh
node scripts/install-receipt.mjs validate receipt.json
node scripts/install-receipt.mjs write receipt.json
cat receipt.json | node scripts/install-receipt.mjs write -
node --test scripts/tests/install-receipt.test.mjs
```

Input must contain the schema fields shown in the test fixture. `write` assigns a
fresh UUID and UTC `written_at`, checks the local hostname/user, and returns the
stored receipt plus its `path`. It can downgrade LIVE but never promote a verdict.
Any present embedded commit, worktree pin, owner_status.pin_sha or self-report commit differing from
`target.released_sha` yields MISMATCH, even with a matching asset digest or MCP probe.
Owner status exit != 0, drift or settings_drift downgrades LIVE to
INSTALLED_NOT_ACTIVE: activation is unverified, rather than a proven SHA mismatch.
For brainlayer, voicelayer, cmuxlayer, brainbar and voicebar, LIVE additionally requires
`activation.mcp_probe.ok: true` and a non-empty `activation.reconnected_seats`
array of non-empty strings. A version self-report alone downgrades to
INSTALLED_NOT_ACTIVE. Other products retain version self-report or MCP probe proof.
Existing FAILED/MISMATCH verdicts remain conservative. `target.merge_sha` remains the required 40-hex PR merge being shipped.
`target.released_sha` is required and identifies the release tag's commit (the
commit embedded by the build). All commit SHAs and content hashes must be
lowercase hex; uppercase input is rejected consistently by validate/write.
Required `target.ancestry` records `method` (gh-compare or git-merge-base),
`status` (identical, ahead, behind or diverged) and UTC `checked_at`.
Compare merge_sha as base to released_sha as head: LIVE requires identical or
ahead. Self-contradicting claims also yield MISMATCH: identical requires equal
merge/released SHAs; ahead requires different SHAs. For a claimed LIVE receipt,
validate fails, while write succeeds and stores MISMATCH. Behind/diverged yields MISMATCH;
missing or incomplete ancestry is invalid. An existing FAILED stays FAILED.
A release tagged on a later version-bump commit can therefore be LIVE without
relabeling its embedded commit with the PR merge SHA. With no embedded commit,
a matching asset digest still requires valid ancestry.
For hooks-live, use `install_source.mode: worktree-pin`, `pin_sha`, and
`owner_status` from the owner installer's `--status`; owner_status.pin_sha is
required for worktree-pin. No `release.json` is needed.

PR-A-era receipts without released_sha/ancestry are now invalid, show MISMATCH
in status, and must be re-emitted with actual evidence. Ancestry is caller-attested
at write time. The writer stays offline and checks only recorded values. Status
is the verification authority under invariant 5a; independent tag and ancestry
re-verification ships separately in PR-B2. Until then, recorded LIVE or claimed
ahead ancestry prints LIVE-UNVERIFIED, and status never prints CURRENT.
A receipt naming the latest tag with a released_sha different from its resolved
commit prints MISMATCH, even if comparison would otherwise say AHEAD/BEHIND.

Writes go to `$HOME/.local/state/golems/install-receipts/<product>/` regardless
of XDG_STATE_HOME. Event names are `<UTC-timestamp>-<version>.json`; collisions
fail without replacing an event. An exclusive temporary file is linked into the
event name, then renamed atomically over `latest.json`. A failed latest update
can leave a complete event, never a partial latest receipt.
Under the single-writer rule, `latest.json` is last-rename-wins, not timestamp-ordered.
Symlinked directories below HOME are refused; HOME itself may be a symlink.
Keep this state local to each Mac, outside sync folders.

Unknown fields at every object level are rejected, including secrets, tokens,
transcripts, dictionary terms and BrainLayer content. Allowed text fields are
summaries and identity evidence only; callers must never put private content in
them. The CLI records supplied evidence; it does not run activation commands or
independently attest the reported installation. Cross-Mac `status` is PR-B.

## Cross-Mac status (PR-B)

```sh
node scripts/install-receipt.mjs status
node scripts/install-receipt.mjs status golems voicebar
node scripts/install-receipt.mjs status custom-product=owner/repo
node --test scripts/tests/install-receipt*.test.mjs
```

Status reads each product's `latest.json` locally and via
`ssh -o BatchMode=yes m1` using `cat` on a strictly validated, quoted receipt
path. JSON parsing and schema validation happen locally; remote Node is not
required. It never installs, activates, or writes receipts. The local alias is
detected from hostname (mbp / MacBook-Pro, or m1); an unknown hostname stops
with an error. On M1, local receipts populate M1 and MBP remains UNKNOWN.
Default products are brainlayer, brainbar, voicelayer,
voicebar, cmuxlayer, golems and narrationlayer; paired apps use their parent repo.
Override the repository with `product=owner/repo` when its release channel differs.

`gh api` paginates published releases, includes prereleases, excludes drafts,
and resolves the newest publication's tag to its commit. This does not use the
stable-only `releases/latest` endpoint or trust `target_commitish`.

The tab-separated matrix reports LIVE-UNVERIFIED, AHEAD, BEHIND, NO-RECEIPT or
MISMATCH. CURRENT is reserved for independent verification in PR-B2.
For different commits, `gh api` compares latest-release SHA to installed SHA:
descendants are AHEAD, ancestors BEHIND; divergence or comparison failure is
UNKNOWN, without guessing order from version strings.
SSH/remote-reader failure is UNREACHABLE; release lookup failure is UNKNOWN
(or LIVE-UNVERIFIED for recorded LIVE or claimed ahead ancestry).
Invalid receipts, wrong product/host, failed installs and owner status drift
are MISMATCH. A missing receipt has activation UNKNOWN, never LIVE. Release
currency and activation are separate: CURRENT does not upgrade the receipt's
activation verdict or prove a current runtime probe. For hooks-live,
`install_source.mode: worktree-pin` and recorded owner status need no
`release.json`. Release currency compares target.released_sha with the resolved latest tag commit.
The pin SHA participates in mismatch detection; CURRENT still
requires installed.embedded_commit to match target.released_sha, or a matching
installed content hash when no embedded commit exists. A pin alone is not
installed identity proof. Reads are snapshots of recorded install evidence,
not a new owner-installer or runtime attestation. Exit is nonzero unless every
row is CURRENT. Tests inject remote and GitHub readers and make no network calls.
