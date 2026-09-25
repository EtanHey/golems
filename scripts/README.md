# scripts/

Repo tooling: CI checks, Claude Code helpers, host sync, and the stream
pipeline. Nothing here is imported by the packages.

## Directories

| Dir | What's in it |
|---|---|
| `ci/` | CI checks: skill-library lint, PR size labels, release gate, the Python suite runner (`run-skill-tests.sh`) |
| `cc/` | Claude Code helpers: statusline, usage sync, Axiom reporter |
| `sync/` | Syncing config to other hosts (`golems-sync.sh`) and checking installed copies for drift |
| `stalker/` | Stream capture, clipping and digest pipeline, run by LaunchAgents |
| `repogolem/` | The `repoGolem` launcher dispatcher and its installer |
| `hooks/` | Installs the Claude Code hooks each host's `manifest.json` lists, from a pinned worktree |
| `lib/` | Shell and TS helpers the scripts above source |
| `templates/` | `owner-profile.md`, the example profile `setup-golem-profiles.sh` starts from |
| `tests/` | Tests for `scripts/`: node/bun, bats, shell and pytest. CI runs them; `bun run test` covers `packages/` only |

## The publish-boundary trio stays at the top level

`check-publish-boundary.sh`, `publish-boundary-policy.yaml` and
`publish-boundary-known-violations.sha256` guard what may be published.
The nightly CI run re-checks every commit since the public genesis commit
against the current baseline. The baseline hashes each known violation together with its path.
Every commit since genesis has them at this path, so moving them passes a
PR's own check but fails that full re-check on every older commit. So they
stay here.

## Compatibility shims

These top-level files only forward to their new home. Each was left behind for
callers outside this repo, and each header says when it can go:

| Shim | Moved to | Remove when |
|---|---|---|
| `cc-statusline.ts`, `cc-axiom-reporter.ts` | `cc/` | `~/.claude/settings.json` calls the new path |
| `check-skill-library.mjs`, `release-gate.mjs`, `pr-size-labels.sh` | `ci/` | agent briefs and installed skill copies use the new path |
| `golems-sync.sh`, `sync-config.sh` | `sync/` | runbooks and other repos' docs use the new path |
| `stream-watcher.sh`, `stalker-live-guard.sh`, `post-stream.sh` | `stalker/` | installed LaunchAgents run the new path and no old watcher is still running |

New code should call the moved path.

## Other top-level files

- Security and repo guards: `guard-no-docslocal.sh`, `google-drive-oauth-guard.mjs` (+ `install-…`), `materialize-deep-security-plan.sh`
- Document generators: `branded-doc.ts`, `explanatory-doc.ts`, `summarize-file.sh`
- Host upkeep: `storage-cleanup.sh` (+ `storage-audit-prompt.md`), `worktree-gc.sh`, `setup-golem-profiles.sh`
- One-offs kept for their tests: `migrate-to-kg.py` (a one-off migration into BrainLayer), and `jev-*-replay.py` (read-only replays of gate decisions over frozen fixtures)
- `test_precompact.py`: a stdlib test for `hooks/precompact-checkpoint.py`. `ci/run-skill-tests.sh` runs every top-level `test_*.py`
