# Fleet launchd jobs

The checkout hook installer can install worktree-sweeper and disk-guard when a
host is explicitly enabled in the pinned manifest's fleet_hosts. The shipped
manifest has fleet_hosts: [], so merging and post-merge --apply activate nothing.
Both jobs execute from the locked hooks-live pin, independent of the root
checkout's branch, using the installer's vetted stable Node path. No relay
config is provisioned. The client/release-source installer is unchanged.

A separate rollout PR may enable mbp after the lead assesses the runtime's
remaining concurrency limitation (scripts/fleet/README.md). Only then does the
existing install-hooks.sh --host mbp --update --apply command write and bootstrap
hourly launchd jobs (RunAtLoad).
Unchanged loaded jobs are left running. Changed loaded jobs are booted out before
atomic plist replacement and bootstrap; an error fails the installer. A print
error permits bootstrap only when launchd explicitly reports a missing service;
permission, transport, and other unknown errors refuse without replacing it.
--status compares installed plist bytes to the selected pin. Source drift now
includes scripts/fleet, so future runtime changes require guarded Mac receipts.
Byte equality does not prove job liveness, successful runs, or delivery.

Offline check: node --test scripts/hooks/fleet-jobs.test.mjs.
No job is installed or started by that test. Native launchctl install and both-Mac
execution remain NOT_RUN until the lead's rollout.

M1 is a release client (README-private-gate.md), with no owner-profile alias.
Its fleet jobs require a follow-up through the client/release path. Do not use
the owner checkout installer for an M1 fleet rollout. Fixture manifests without
fleet_hosts, or with an empty list, do not install or inspect launchd jobs.
