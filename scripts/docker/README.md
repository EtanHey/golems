# Local container lifecycle

Opt in by wrapping a local command (Node stdlib only):

```sh
node scripts/docker/container-teardown.mjs run com.docker.compose.project=my-tests -- npm test
node scripts/docker/container-teardown.mjs run com.supabase.cli.project=my-tests -- node integration.mjs
```

Only these exact label selectors are accepted; name globs are rejected. Use a
dedicated project: preflight protects and stops **all** its stale containers.
Restart-policy changes are permanent and never restored. Selecting a long-lived
dev stack stops it and removes its automatic restart policy.
Compose runs in the caller's working directory. Any compose configuration there
or in `COMPOSE_FILE` can limit stop to its services; remaining project containers
are reported as survivors. Supabase stop selects the explicit project ID.

The wrapper disables restart policies every 250 ms while the child runs. Call
`protect()` immediately after **each** create/recreate step to close that polling
gap (including database resets that replace containers):

```js
import { createLifecycle } from './scripts/docker/container-teardown.mjs';
const lifecycle = createLifecycle('com.supabase.cli.project=my-tests');
// Inside the wrapped command, after each successful start/reset:
await lifecycle.protect();
```

A container removed between listing and protection is skipped only after an
exact missing-container error and a confirming re-list. An exact Docker error
marking a full container ID as removing/dead also skips that ID, even while it
remains listed. Other protection errors remain fatal for live containers, and
the final survivor check still reports anything running.

`preflight`, `protect` and `teardown` are also CLI subcommands with the same
selector. Module callers can `await lifecycle.run(['node', 'integration.mjs'])`;
it owns preflight and teardown. Teardown always protects, stops without removing
volumes/backups, then reports every running survivor. Errors aggregate, with the
wrapped command's exit code and error first. SIGINT/SIGTERM/SIGHUP reach the child; it
gets at most 1.5 seconds before SIGKILL and teardown. Cleanup has no abort signal.
Lifecycle subprocesses run in separate process groups and stay awaited, so a
terminal Ctrl-C cannot kill cleanup commands directly.
Each teardown command has a 60-second timeout. Set
`GOLEMS_DOCKER_TEARDOWN_TIMEOUT_MS` to an integer from 1 to 60000 to shorten it.
On expiry the command's process group gets TERM, then KILL after 250 ms, and
teardown fails naming the command. A first signal during teardown records a
non-zero exit; a second SIGINT/SIGTERM/SIGHUP immediately KILLs the active cleanup
group, reports failure and skips further cleanup commands. A signal that already
interrupted the wrapped child counts as the first signal.
`CI=true` makes lifecycle methods no-ops and passes through the wrapped command.
SIGKILL of the wrapper skips teardown: restart=no and next-run preflight cover
protected containers; callers must use the hook to minimize the creation gap.
A SIGKILL of the wrapper during teardown can leave its detached stop process
running; restart=no and the next run's preflight cover the project containers.
