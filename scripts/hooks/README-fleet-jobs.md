# Fleet launchd jobs

The checkout hook installer --apply now installs worktree-sweeper and disk-guard
on the mbp and m1 host identities. Both jobs execute from the locked hooks-live
pin, independent of the root checkout's branch. No relay config is provisioned.
The client/release-source installer is unchanged.

Install after merge with the existing install-hooks.sh --host <host> --update
--apply command. This writes and bootstraps hourly launchd jobs (RunAtLoad).
Do not enable before the runtime PR's concurrency limitation has been reviewed.
Unchanged loaded jobs are left running. Changed loaded jobs are booted out before
atomic plist replacement and bootstrap; an error fails the installer.
--status compares installed plist bytes to the selected pin. Source drift now
includes scripts/fleet, so future runtime changes require guarded Mac receipts.
Byte equality does not prove job liveness, successful runs, or delivery.

Offline check: node --test scripts/hooks/fleet-jobs.test.mjs.
No job is installed or started by that test. Native launchctl install and both-Mac
execution remain NOT_RUN until the lead's rollout.

The pinned manifest opts in using fleet_hosts. M1 uses the mbp hook set when it
has no explicit m1 set; machine identity validation still requires m1. Fixture
manifests without fleet_hosts do not install or inspect launchd jobs.
