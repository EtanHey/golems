# Golems release artifact

Build from committed Git objects (dirty and untracked files never enter a build):

```sh
node scripts/release/build-release.mjs --commit HEAD --out dist/release
```

Version is `YYYY.MM.DD-<sha7>`, using the commit's **UTC committer date**,
not the build date. The tag is `v<version>`. Outputs are
`golems-<version>.tar.gz`, `MANIFEST.json`, and `SHA256SUMS`.
The archive has no enclosing directory; extract into a dedicated version directory.

The archive preserves these repo-relative paths:

- `skills/golem-powers/`: skills and runtime supporting files, including `_shared`
- `skills/catalog.json`: the canonical per-client set to link (shared helpers are payload only)
- `scripts/pr-watch` and `scripts/pr-watch-lib/` (including vendor license/notice)
- `scripts/repogolem/`: config generator, schema/example, runtime and dispatch modules
- `packages/golem-skills/`: golems-cli source and package metadata
- `scripts/hooks/`: installers, public gate implementations and hook manifest
- `.claude/hooks/block-dangerous-commands.py`, `hooks/daemon-gate-precheck.py`:
  additional sources named by the hook manifest
- `scripts/model-roles.mjs`, its `scripts/ci/check-model-role-drift.mjs` loader,
  `standards/model-roles.{json,schema.json}`, `.bun-version`, `LICENSE`
- Generated root `package.json`: only repoGolem's `ajv`, `yaml`, `varlock`
  dependencies, taken from the commit's root package metadata
- `scripts/release/install.sh` and `release-gate.json`: bootstrap/update and
  the wizard's artifact classification

Tests, evals, fixtures, docs.local, private directories, environment/secret files,
keys, caches and node_modules are excluded. Public code such as
`private-regression-gate.py` is shipped; private regression data is not.
Symlinks and submodules in selected paths are rejected. Files retain their Git
executable bit as `0755` or `0644`. USTAR entries have fixed ownership/mtime,
UTF-8 byte order, and a gzip header without clock/platform metadata.

`MANIFEST.json` contains `{version, commit, files:[{path, sha256, mode}]}`;
mode is an octal string. It lists every payload file, including the generated
package metadata, and excludes itself to avoid a circular hash. `SHA256SUMS`
checks the tarball and the standalone manifest. CI independently checks the
archive's per-file hashes, modes and metadata, and compares two whole builds.

PRs validate without publishing. Every master merge publishes immutable assets to
the **nightly** channel as a GitHub prerelease, explicitly never marked Latest.
The **stable** channel will come later through promotion of a tested nightly.
Reruns compare existing assets instead of replacing them. Interrupted draft
uploads are replaced on rerun. Publication jobs are serialized, and both jobs
pin Node to 22.22.0.

Resolve nightly as the newest published release by `created_at`, **including
prereleases** and excluding drafts. GitHub's `/releases/latest` endpoint omits
prereleases, so the installer requests only page 1 (`per_page=30`) and selects
the newest non-draft by `created_at` from that response:

```sh
gh api 'repos/EtanHey/golems/releases?per_page=30&page=1' | \
  jq -er 'map(select(.draft == false)) | max_by(.created_at) | .tag_name'
```

The `github-release` gate support requires a published release with all three
assets. Local installation detection reads `~/.golems/release.json` and compares the full
version, including the SHA suffix. `--release-only` skips local installation.
Prereleases are accepted only for manifest entries with `channel:nightly`;
drafts and missing assets remain refused, including in the `--sha` gate.
Golems is `kind:github-release` in `release-gate.json`; workspace and daemon-host
wizards return INSTALL with the public bootstrap command.

## Installation and updates

```sh
curl -fsSL https://raw.githubusercontent.com/EtanHey/golems/master/scripts/release/install.sh | sh -s -- --channel nightly
# Or pin an exact release tag:
sh scripts/release/install.sh --channel v2026.10.11-abcdef0
# Offline/test path (both files come from the same release):
sh scripts/release/install.sh --from-file golems-2026.10.11-abcdef0.tar.gz --sums SHA256SUMS
```

Pass `--preserve-releases` to keep every previously installed release directory
when activating an update. The default keeps the current release and two prior
versions, plus any release still pinned by the client hook receipt.

The installer needs POSIX sh, standard macOS/Linux utilities (including awk,
xargs and mktemp), curl, tar and shasum. A fresh bootstrap needs no Git, Node,
Bun or Python. Updates with an existing client hook receipt also need Node and
Python >= 3.11 to reverify and reinstall the policy hooks.
JSON parsing is embedded so the one-liner downloads only the installer script.
The body is enclosed in `main()` so a truncated piped download cannot execute
installation steps. `GITHUB_TOKEN` optionally authenticates API requests; HTTP
403 reports a possible rate limit and the token option. Downloads and every
redirect require HTTPS and a GitHub host (`api.github.com`, `github.com`,
`objects.githubusercontent.com`, or `release-assets.githubusercontent.com`).
The API token is never forwarded to asset hosts.
It verifies the tarball and standalone manifest checksums, rejects unsafe archive
entries, and verifies every payload file before activating the release.
Checksums establish integrity against SHA256SUMS fetched over HTTPS; they are
not release signatures. Payload paths use P1's ASCII path layout.

`--prefix PATH` defaults to `~/.golems`. Releases are stored under
`releases/<version>/`; `current` is replaced atomically using GNU mv -T or BSD
mv -h. An install lock refuses overlapping runs. Same-version runs recheck hashes,
print "already current", and leave metadata untouched. The current release and
two previous installed versions are retained; pruning follows the install history,
not lexical SHA order. A release referenced by the client hook receipt is also
retained in the history until a later update no longer needs it. Untracked
release directories are left alone.

Only the entries in `skills/catalog.json` are linked into `~/.claude/skills`
and `~/.agents/skills`, using their separate lists; `~/.codex/skills` is linked
to the latter only if absent. An existing real Codex skills directory uses the
agents catalog: missing entries are linked through `~/.agents/skills/<name>`,
release-owned links are refreshed, and checkout links are migrated with
`--replace-checkout-links`. Foreign links, real entries and dot-entries are
reported and kept. Names outside the catalog are also kept, except for non-dot
Codex symlinks whose target is exactly `$HOME/.agents/skills/<name>` and which
are broken or resolve into this prefix's `releases/` directory. Those retired links are removed;
other targets (including direct release links) stay untouched. Each created or
re-pointed Codex catalog link prints `Linked <path> -> <target>`, including swaps
to custom agents content. Existing Codex root symlinks are preserved. Each
catalog entry must have `SKILL.md`.
The catalog was derived from the owner's readable golems-owned links in these
two roots on 2026-10-12, following golem-install's installed-skill scan. That scan
is the source chosen for the curated installed set: the library checker counts
all available skills, and `scripts/sync/reconcile-profile.json` does not declare
per-client subsets. Update the catalog deliberately when changing the installed
set; the release manifest verifies its bytes along with the payload.
Existing files/directories and foreign links are reported and kept. Links that
resolve into a golems checkout's `skills/` (including relative and worktree links)
are replaced only with `--replace-checkout-links`; links resolving into another
repo stay untouched even when reached through a golems symlink. The flag also
works on a same-version run. Updates refresh release-owned links and remove
retired entries from the Claude and agents roots only when they resolve into
this prefix's `releases/` directory.
The installer writes `release.json` with version,
commit, channel, installation time, tarball SHA256 and `manifest_sha256`
(the standalone manifest hash verified against SHA256SUMS). A successful install
prints the version, full commit and tarball SHA256. It never writes the
sync script's `installed.json`.
Symlinked client parent directories and release/bin directories are refused
to avoid writing through aliases into a checkout or another installation.

Add `<prefix>/bin` to PATH. `pr-watch` wraps the shipped Python script (Python 3
and gh are runtime requirements). `golems-cli` wraps the shipped Bun source;
its `update` command reruns the shipped installer and accepts installer flags,
including offline assets, without requiring Bun. Other CLI commands require Bun.
Updates default to nightly; pass `--channel <tag>` to keep a pinned tag.
repoGolem's dependency setup and the first client hook installation are separate
from this bootstrap. Once `~/.claude/hooks/golems-hooks-release.json` exists,
updates activate the verified candidate and rerun its client hook installer
before pruning. Hooks remain pinned to the verified release directory. Failed
applies restore hook links, registrations and modes; the updater restores the
previous `current` and `release.json` and leaves history unpruned. Candidate
releases without client rollback protocol 1 are refused before activation.
This includes downgrades to releases predating that protocol. Native Codex
`/hooks` trust still needs review after definitions change. Owner hooks-live
installations do not enter this client update path.

For a former M1 owner install, install the release with `--replace-checkout-links`,
then run `node ~/.golems/current/scripts/hooks/install-hooks.mjs --host client
--source ~/.golems/current --migrate-owner-install --apply`. Verify the same command
with `--status` instead of `--migrate-owner-install --apply` reports `drift=0`.
The migration archives the old pin and hooks-live links with a receipt under
`~/.golems/archive/owner-install-<timestamp>-<id>/` and rolls back failed writes;
without the flag, an owner-shaped HOME is refused. The MBP always refuses client
installation, including migration. Status verifies wiring; native Codex `/hooks`
trust review is still required. Archive/retire the old checkout only after installed
parity and live verification pass.

Run the scratch-HOME suite with:

```sh
bun test scripts/tests/install-release.test.mjs
```
