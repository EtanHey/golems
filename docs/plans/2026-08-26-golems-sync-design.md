# Golems Sync Design

## Goal

Install or update the golems-owned skill library and repoGolem launcher on a
remote Mac without requiring a checkout or GitHub credentials on that Mac.

## Source and trust boundary

The command runs from a source checkout. By default it only ships a clean local
`master` whose `HEAD` equals `origin/master`; `--allow-dirty` is the explicit
escape hatch for branch validation. The source commit is printed and recorded
in the remote manifest. The transport payload is materialized with
`git archive <commit>`, so ignored, untracked, and dirty working-tree files
cannot be shipped under that commit's identity. The manifest records whether
the invoking checkout was dirty and a deterministic SHA-256 of the archived
payload.

The only destructive mirror is the golems-owned directory
`~/.golems/skills/golem-powers/`. Existing entries under
`~/.claude/skills/<name>` are replaced only when `<name>` is present in the
shipped bundle. Plain files/directories are moved into one timestamped backup
root before symlinks are created. Unowned skills are untouched.

## Transport

Production mode uses `ssh` plus `rsync`. Tests set `HOST_SHELL=local` and
`HOST_ROOT=<directory>` so the same orchestration operates on a filesystem tree
without a remote host. `--dry-run` computes and prints the plan without writes.

The launcher pair is staged under `~/.golems/launcher/`; the shipped installer
runs against the target user's home and the installed dispatcher hash must
equal the source dispatcher hash.

## Portability guard

Before transport, every shipped skill file except files beneath `docs/` and
`README*` is checked for literal developer-home paths, Homebrew executable
paths, and checkout-coupled `~/Gits/<repo>` paths. Any unapproved match aborts
with an occurrence and file count plus file, line, token, and content. Exact
file-and-token exceptions live in
`scripts/golems-sync-coupling-allowlist.tsv`; each has a one-line reason and is
limited to archived evidence, tests, evaluation fixtures, or non-executed
examples. Active instructions use portable `$HOME/.golems` or `$HOME/Gits`
paths. The known `codex-workflows` runtime coupling is removed by resolving
`codex` from `PATH` and putting runs beneath the current user's home.

## Drift and manifest

The command compares file content and link state to classify added, updated,
unchanged, and backed-up items. A successful apply writes
`~/.golems/INSTALLED.json` with commit, UTC timestamp, source host, selected
scope, and counts. A second identical run reports only unchanged items.

## Testing

Bats tests cover dry-run non-mutation, Markdown coupling rejection, archived
tracked-only payload construction, controlled clean/dirty provenance, backup
plus symlink creation, second-run idempotence, and launcher hash verification.
Existing Python tests cover portable `codex-workflows` path resolution. The
final proof uses the real `m1` SSH target and imports the shipped Python module
there.
