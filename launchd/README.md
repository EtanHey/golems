# Golems LaunchAgents

gui-path retired 2026-10-31; T3 providers use absolute binaryPath.

`install.sh` installs worktree cleanup and the Drive OAuth guard. Design skill
updates and the morning digest have dedicated installers. To install an adopted
stream watcher/guard, ComfyUI, or the ratchet relay explicitly, run from the
persistent root checkout (`~/Gits/golems`), never a scratch worktree. The stream
watcher wrapper pins that checkout path; a later install from a different
checkout is refused as differing bytes.

```sh
cd "$HOME/Gits/golems"
launchd/install-job.sh com.golems.stream-watcher
# Render, create/verify the named executable, and lint without activation:
launchd/install-job.sh com.golems.stream-watcher --skip-launchctl
```

The guarded hook installer owns fleet disk guard and worktree sweeper activation;
its existing host-admission policy still applies. `render-plist.sh` stays a pure
renderer, so rendering alone does not create wrappers or change installed jobs.
Do not install a raw rendered plist: use an installer above.

## Naming a job in Login Items

macOS derives a script job's Login Items name from its executable filename.
Use `named-program.mjs` after rendering and before replacing or loading a plist.
It changes only `ProgramArguments[0]`, leaving the remaining plist bytes intact.
The owned mode-0755 file under `~/.local/lib/golems/` looks like:

```sh
#!/bin/sh
set -eu
exec '/absolute/path/to/the/original/interpreter' "$@"
```

1. Name the wrapper for humans: `Golems <Plain Purpose>` (see `jobNames`).
2. `exec` the exact original program and forward `"$@"`; keep the original plist
   arguments, label, schedule, environment and log paths. Shell-quote the program
   and XML-escape the wrapper path, including paths with spaces and apostrophes.
3. Never overwrite differing wrapper bytes. Reinstallation accepts only an
   owned regular file with identical bytes and mode 0755. Symlinked wrappers or
   directories and group/world-writable directories are refused. An intentional
   interpreter-path change needs explicit operator reconciliation first.

Wrappers stay on uninstall so an uninstall never deletes a modified executable.
TTS belongs to VoiceLayer and has no installer here. Ecosystem health and storage
cleanup have no tracked golems plist/installer and are outside this installation.

`install-job.sh` keeps a uniquely named `.prev.*` plist backup until bootstrap
succeeds. It waits for the old label to leave launchd before activating the new
plist. On bootstrap failure it restores and reloads the previous definition,
returns nonzero, and retains the backup for diagnosis. Wrappers are never
replaced, so the old executable remains available throughout rollback.
