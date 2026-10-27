# Local container lifecycle

Opt in by wrapping a local command (Node stdlib only):

```sh
node scripts/docker/container-teardown.mjs run com.docker.compose.project=my-tests -- npm test
node scripts/docker/container-teardown.mjs run com.supabase.cli.project=my-tests -- node integration.mjs
```

Only these exact label selectors are accepted; name globs are rejected. Use a
dedicated project: preflight protects and stops **all** its stale containers.
Compose runs in the caller's working directory; provide its compose file there
or via `COMPOSE_FILE`. Supabase stop selects the explicit project ID.

The wrapper disables restart policies every 250 ms while the child runs. Call
`protect()` immediately after **each** create/recreate step to close that polling
gap (including database resets that replace containers):

```js
import { createLifecycle } from './scripts/docker/container-teardown.mjs';
const lifecycle = createLifecycle('com.supabase.cli.project=my-tests');
// Inside the wrapped command, after each successful start/reset:
await lifecycle.protect();
```

`preflight`, `protect` and `teardown` are also CLI subcommands with the same
selector. Module callers can `await lifecycle.run(['node', 'integration.mjs'])`;
it owns preflight and teardown. Teardown always protects, stops without removing
volumes/backups, then reports every running survivor. Errors aggregate, with the
wrapped command's exit code and error first. SIGINT/SIGTERM reach the child; it
gets at most 1.5 seconds before SIGKILL and teardown. Cleanup has no abort signal.
`CI=true` makes lifecycle methods no-ops and passes through the wrapped command.
SIGKILL of the wrapper skips teardown: restart=no and next-run preflight cover
protected containers; callers must use the hook to minimize the creation gap.
