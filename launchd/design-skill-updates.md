# MacBook design skill updater

Install and load on the MBP (never the M1):

```sh
node launchd/install-design-skill-updates.mjs
```

The installer refuses other hosts, validates the plist, copies a content-pinned
runner outside the worktree, and bootstraps only com.golems.design-skill-updates.
It runs daily at 10:43 local (07:43–08:43 UTC in Israel), away from 01:15Z maintenance.
No login-time run, new token, repository permission change, merge, approval or force-push.
The GitHub workflow schedule remains gated off.

Manual proof: run the installed runner path printed by the installer with Node.
Unchanged payloads log NOOP and exit 0. Changes use the merged master's copier in
an isolated temporary checkout and existing gh login to open a normal review PR.
No upstream code runs. Existing proposals are not reopened. A runner-side guard
rejects a symlinked upstream skills/ root. Normal Git hooks remain enabled.

Logs: ~/.golems/state/design-skill-updates/updates.log, launchd.stdout.log and
launchd.stderr.log. Errors log ERROR and return nonzero. Only this run's temporary
checkout is removed; durable logs and remote proposals remain.

Inspect: launchctl print gui/$(id -u)/com.golems.design-skill-updates
Rollback: launchctl bootout gui/$(id -u)/com.golems.design-skill-updates; retain logs,
then remove only the plist created by this installer from ~/Library/LaunchAgents/.
Reinstall after changing the runner; installed files never point into a worktree.
