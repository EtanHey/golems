# Pristine split characterization

Base: `84b50967d6f0cdf62b58b23b78cece5c0897c77e`. `corpus.json` contains
commands mined from the existing parser, tmp-block and git-guardian tests, plus
hook envelopes and launcher scenarios derived from `test-repogolem-dispatch.bats`.
The installed tmp-block ledger was inspected by command family only (echo,
cat, tee, printf, git worktree); no raw log command was copied into this repo.

`goldens.json` was captured from the immutable base. Python cases retain exact
stdout, stderr, exit and emitted ledger bytes. Launcher cases retain SHA-256 of
those fields and the generated profile so machine-specific fixture paths are
not published. The gate itself compares the **raw bytes** from base and
candidate subprocesses in the same fixture. It does not normalize outputs.
The harness freezes the hook ledger clock in both processes, fixes hash seed
and timezone, and stubs only external launch CLIs and randomness.

Run `python3 scripts/ci/pristine-harness.py check` to compare the in-tree files
with the base. `verify-goldens` also checks recorded captures in this original
worktree; a different checkout path or OS may change that capture while `check`
still compares both trees byte for byte on the current host. Run `mutation-proof` to
require a one-character change in each target to fail the comparator. The CI
Python skill job runs `check` as a blocking step with full git history, zsh and
jq. This is source and fixture proof; installed hook and launcher verification
belongs to the later split lanes.
