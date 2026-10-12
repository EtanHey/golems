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
assets. Local installation detection reads `~/.golems/installed.json` and compares the full
version, including the SHA suffix. `--release-only` skips local installation.
Golems remains `kind:none` in `release-gate.json` so workspace wizards keep
cloning it; P2 will switch the classification when release installation exists.
Install paths, dependency installation/bundling, bootstrap and hook client
profiles are P2/P3 work; this artifact does not install anything.
