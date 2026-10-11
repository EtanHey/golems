# Worktree creation floor

Every automated golems-owned Git worktree creator checks the target volume before
adding a worktree: Codex workflows, live-eval sandboxes, hook installation, private
regression gate, and Mac ratchet runner. repoGolem's `-w` consumes an existing tree;
cmuxlayer owns its external creation path and must adopt this same environment contract.

`GOLEMS_WORKTREE_MIN_FREE_GB` overrides the floor. The helper fallback is 15 GiB.
The private machine config sets 15 for the MBP and 50 for the M1 through each
machine's `overrides.global.env`; the public config example demonstrates the shape.
The lead regenerates/syncs machine environments after merge. Non-repoGolem shells
and launchd creators on the M1 must inherit the explicit 50 setting too.

Invalid values or unavailable disk measurements refuse creation. The check finds the
nearest existing target ancestor and creates no directories or branches. Low-space
errors print available space, required space and the override name. Tests use an
explicit zero floor only for isolated fixtures exercising unrelated creator behavior;
separate tests prove the 15/50 boundaries and refusal before any Git write.

The public machine example uses `example-host=50` and `example-laptop=15`.
Its schema and generated environment tests verify that the overrides reach each
machine without changing unrelated project settings.
