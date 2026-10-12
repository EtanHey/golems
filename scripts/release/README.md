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
prereleases, so use the paginated release list instead:

```sh
gh api --paginate --slurp 'repos/EtanHey/golems/releases?per_page=100' | \
  jq -er 'map(.[]) | map(select(.draft == false)) | max_by(.created_at) | .tag_name'
```

The `github-release` gate support requires a published release with all three
assets. Local installation detection reads `~/.golems/release.json` and compares the full
version, including the SHA suffix. `--release-only` skips local installation.
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

The installer needs POSIX sh, standard macOS/Linux utilities (including awk,
xargs and mktemp), curl, tar and shasum. It needs no Git, Node, Bun or Python.
JSON parsing is embedded so the one-liner downloads only the installer script.
It verifies the tarball and standalone manifest checksums, rejects unsafe archive
entries, and verifies every payload file before activating the release.
Checksums establish integrity against SHA256SUMS fetched over HTTPS; they are
not release signatures. Payload paths use P1's ASCII path layout.

`--prefix PATH` defaults to `~/.golems`. Releases are stored under
`releases/<version>/`; `current` is replaced atomically using GNU mv -T or BSD
mv -h. An install lock refuses overlapping runs. Same-version runs recheck hashes,
print "already current", and leave metadata untouched. The current release and
two previous installed versions are retained; pruning follows the install history,
not lexical SHA order. Untracked release directories are left alone.

Every skill directory (including shared helpers) is linked into `~/.claude/skills`
and `~/.agents/skills`; `~/.codex/skills` is linked to the latter only if absent.
Existing files/directories and foreign links are reported and kept. Links into
`~/Gits/golems/` are replaced only with `--replace-checkout-links`; this flag also
works on a same-version run. The installer writes `release.json` with version,
commit, channel, installation time and tarball SHA256. It never writes the
sync script's `installed.json`.
Symlinked client parent directories and release/bin directories are refused
to avoid writing through aliases into a checkout or another installation.

Add `<prefix>/bin` to PATH. `pr-watch` wraps the shipped Python script (Python 3
and gh are runtime requirements). `golems-cli` wraps the shipped Bun source;
its `update` command reruns the shipped installer and accepts installer flags,
including offline assets, without requiring Bun. Other CLI commands require Bun.
Updates default to nightly; pass `--channel <tag>` to keep a pinned tag.
repoGolem's dependency setup and client hook installation are separate from this
bootstrap. This phase neither installs hooks nor modifies hooks-live.

Run the scratch-HOME suite with:

```sh
bun test scripts/tests/install-release.test.mjs
```
