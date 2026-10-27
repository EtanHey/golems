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
`activation.mcp_probe.ok: true` and `activation.seat_scan` with:

- `method`: `t3-threads` or `list_agents`;
- `checked_at`: a UTC Z timestamp strictly later than `installed.install_finished_at`;
- `active_seats`: an array of non-empty seat IDs, each present in
  `activation.reconnected_seats`.

An empty `active_seats` permits empty or absent `reconnected_seats`. Reconnect only
seats actively using the server; idle, ready and paused seats receive no reconnect
or nudge (deploy-local-prod contract #3, 2026-09-24). The agent's own stdio/MCP
probe never counts as a seat in either list. For every product, validation rejects
`activation.reconnected_seats` or `activation.seat_scan.active_seats` containing an
exact string match of `writer.thread_or_session`; both validate and write refuse
the receipt and name the field. The schema requires the writer ID, so this check
always applies. `status` also calls validation and reports such stored receipts
as MISMATCH. The stdio `mcp_probe` itself still has no seat identifier.
The seat scan is optional in the schema for existing receipts, but missing scans,
stale scans, uncovered active seats or unsuccessful probes downgrade MCP LIVE to
INSTALLED_NOT_ACTIVE with a specific reason. A version self-report alone is
insufficient. Other products retain version self-report or MCP probe proof.

### Process-level client proof (I2f)

`seat_scan.method: client-processes` requires `clients`, `excluded`, and
`bridge_diff` in addition to `checked_at` and `active_seats`. These fields are
refused on the two existing seat methods, whose behavior is unchanged.

- `clients[]`: `{pid: positive integer, started_at: UTC Z, argv: non-empty array
  of non-empty strings, argv_source: ps-split|procargs2, thread_id: non-empty
  string or null}`. `argv` replaces `command`; the closed schema rejects the old
  field. Record every token, with no truncation to argv[0..1]. Record ps lstart
  in UTC (whole seconds only; fractions are refused).
  `argv_source` is required. Today's collector emits `ps-split`: the whitespace
  split of ps's complete command string. This is lossy: an argument containing a
  space becomes several elements; these are not true argv boundaries. No core
  client path contains a space, so splitting preserves its matching element;
  extra splits can only add elements, erring toward a match and stale status
  (fails closed). `procargs2` reserves true argv from a future native
  KERN_PROCARGS2 reader; this change does not implement that reader.
- `excluded[]`: `{rule: socat-relay|daemon-process, reason: non-empty string,
  count: non-negative integer}`.
- `bridge_diff`: `{from_tag, to_sha, paths: [non-empty strings], changed: boolean}`.
  `to_sha` must equal `target.released_sha`. `from_tag` must differ from `target.tag`;
  when `prior.version` is present it must equal that version prefixed with `v`
  (preserving an existing `v` prefix). The diff is caller-attested at write time;
  core does not run git or ps. Status independently re-derives it for LIVE receipts
  using this method (see below). BrainLayer and BrainBar diffs must cover all three
  core paths: `src/brainlayer/mcp_stdio_bridge.py`, `src/brainlayer/mcp/`, and
  `src/brainlayer/mcp_socket_config.py`.

Core alone matches BrainLayer and BrainBar clients when ANY `argv` element contains
one of these paths as the whole element or immediately after an option separator
`=` or `:` (the path must extend to the end of the element):
`/opt/homebrew/bin/brainlayer-mcp-stdio-bridge`,
`/opt/homebrew/opt/brainlayer/bin/brainlayer-mcp-stdio-bridge` or
`/opt/homebrew/Cellar/brainlayer/<version>/bin/brainlayer-mcp-stdio-bridge`,
at any token index, including `uv run <bridge>` and interpreter wrappers, with
trailing arguments allowed. For example, `--bridge=/opt/homebrew/opt/brainlayer/bin/brainlayer-mcp-stdio-bridge`
matches; arbitrary directory prefixes and Cellar `..` traversal paths are refused.
A stray path held by an editor also matches, erring
toward stale. Watch, drain, daemon, hybrid-helper and supervisor_guard commands
without a matching bridge element are not clients. BrainBar shares this matcher
because those bridges relay to its `/tmp/brainbar.sock`.
The Cellar version segment cannot be `.` or `..`. If ANY element has basename
`brainlayer-mcp-stdio-bridge` but an unrecognised path, validation refuses the
receipt even when `bridge_diff.changed=false`. Every `clients[]` entry must match
its product's core rule; otherwise validate and write refuse with
`unmatched client in seat_scan.clients`. Exclude non-client processes rather than
silently including unmatched entries. Collectors pass token arrays to the exported
`CLIENT_RULES` matcher (`.test(argv)`); they never normalise paths or copy matchers.
The per-element bridge regex is private; exported matchers consume full argv arrays.

Core floors both timestamps to whole seconds when comparing
`started_at <= installed.install_finished_at`:
the equal second is stale. IDs are `pid:<pid>@<started_at>` so a reused PID with
a later start is fresh. `active_seats` must equal that derived set; validate and
write both refuse a differing list, including duplicate claims. When
`bridge_diff.changed=false`, none are stale and write records why in reasons.

VoiceLayer and VoiceBar are relay products: core derives no stale clients for
these products. A relay client must contain the exact tokens `socat` (or
`/opt/homebrew/bin/socat`), `STDIO`, and
`UNIX-CONNECT:/tmp/voicelayer-mcp.sock`, with extra arguments allowed.
The rule does not independently verify relay counts.
A `socat-relay` exclusion must record the observed count (including zero) and
contain this exact sentence; excluded processes may already be absent from `clients`:

> LIVE = daemon serves the new code; socat seats connected before a daemon restart got EOF and are dead for voicelayer until their session restarts (not visible to ps).

VoiceBar shares this rule because its daemon serves that socket. No observed
client matcher exists for cmuxlayer: this method is refused with
`no client matcher for cmuxlayer`. Other unconfigured products are also refused.

For this method, MCP LIVE requires a successful `mcp_probe`, no derived stale
clients, and `checked_at > install_finished_at`, plus the existing identity and
fresh daemon activation requirements. Reconnected seat claims cannot clear a
stale process. Otherwise write downgrades LIVE to INSTALLED_NOT_ACTIVE and lists
stale pairs in reasons. An existing conservative verdict is never promoted.
The writer's own pre-install bridge still counts: expect the first receipt to
remain INSTALLED_NOT_ACTIVE until old sessions end. Follow up with one mechanical
recheck; never poll from a lead.

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
is the verification authority under invariant 5a: since #893 it independently
peels the target tag and compares merge_sha to the observed release commit.
A tag or ancestry contradiction prints MISMATCH; an unavailable lookup prints
LIVE-UNVERIFIED. Only independently verified LIVE receipts for the latest
release can print CURRENT. Inactive receipts with valid ahead ancestry retain
their activation verdict whether or not the release is current, including when release lookup fails.
Other inactive receipts retain their activation verdict when current.
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

Since #897, latest for brainlayer, brainbar, voicelayer, voicebar, cmuxlayer and
narrationlayer is the highest SemVer tag from `git ls-remote --tags`, including
prereleases; annotated tags are peeled to commits. Golems uses `gh api` to
paginate published Releases, includes prereleases, excludes drafts, and selects
by publication date before resolving that tag to its commit. It does not use
`releases/latest` or trust `target_commitish`.

The TAP column independently compares the Homebrew formula/cask version with
the highest stable upstream tag: TAP-OK, TAP-STALE, or TAP-UNKNOWN. Products
without a tap path print TAP-N/A; repo overrides do not use the upstream tap.
An unreadable tap or a tap ahead of upstream is TAP-UNKNOWN.

For LIVE activation using `client-processes`, status first peels
`refs/tags/<from_tag>` with the existing tag resolver. An unresolved reference
(including a branch name or raw SHA without a matching tag) prints
LIVE-UNVERIFIED. It then runs
`gh api repos/<owner>/<repo>/compare/<peeled_from_sha>...<to_sha>` with
pagination, using commit SHAs at both endpoints. Only `ahead` is accepted:
`behind`, `diverged`, or `identical` prints MISMATCH with claimed versus
observed comparison status. This prevents downgrade or divergent histories
from hiding bridge changes in a three-dot comparison.
It intersects changed filenames with the product's core bridge paths, using
prefix matching for directory entries and considering both names of renames.
BrainLayer and BrainBar share the three core paths listed above; VoiceLayer
and VoiceBar have no core bridge paths because their clients are relays.
A non-empty intersection with claimed `changed=false` prints MISMATCH and
claimed versus observed paths in VERIFICATION. Claimed `changed=true` with an
empty intersection is noted as stricter and keeps the otherwise valid verdict.
A failed/unreachable or malformed comparison, or a file list reaching GitHub's
300-file cap, prints LIVE-UNVERIFIED. Pagination does not remove that file cap.
All git/gh calls use argv-only execution with GIT_TERMINAL_PROMPT=0 and
GH_PROMPT_DISABLED=1. The writer's offline validation semantics are unchanged.

The tab-separated matrix reports CURRENT, LIVE-UNVERIFIED, AHEAD, BEHIND,
NO-RECEIPT, MISMATCH, UNKNOWN, UNREACHABLE or a conservative activation verdict.
For different commits, `gh api` compares latest-release SHA to installed SHA:
descendants are AHEAD, ancestors BEHIND; divergence or comparison failure is
UNKNOWN, without guessing order from version strings.
SSH/remote-reader failure is UNREACHABLE; release lookup failure is UNKNOWN
(or LIVE-UNVERIFIED for independently assessed LIVE activation).
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
row is CURRENT and no row is TAP-STALE. TAP-UNKNOWN alone does not fail an
otherwise CURRENT row. Tests inject remote and GitHub readers and make no network calls.
