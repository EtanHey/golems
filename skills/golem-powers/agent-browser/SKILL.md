---
name: agent-browser
description: "Agent web testing: attach to shared Chrome Beta over CDP. Never launch worker browsers or drive Helium."
---

# Agent browser

Choose the first option that works:

1. An API or CLI when it gives the data: DeepSource → `deepsource-issues`; GitHub → `gh`.
2. Pages needing no sign-in: a headless browser (or T3's browser tools when the task is browser
   work), leaving no window on Etan's screen.
3. The M1's agent browser when the sign-in exists there. Use the M1 T3 environment or a delegate;
   see `/agent-routing` for cross-machine delegation.
4. M4 Chrome Beta only when the M4 signed-in session is needed.

On the chosen Mac, run `agent-browser start --lease <unique-task-name>` before
**every** CDP attach. If it fails, do not connect. The lease lasts 30 minutes;
renew the same name with `start --lease <name> --ttl 1h` for longer work.
Always pass the same name to `release`: the default name is the calling shell's PID, which
changes between commands. Never touch another task's lease. `status` prints live leases; `reap` drops expired
ones. The last release, or reaping all expired leases, stops the verified browser
with SIGTERM. A launchd job reaps every 10 minutes. Never leave it running for
other workers without their own live leases.

Use the same name through cleanup, even if attach or tab creation fails:

```js
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const lease = `task-${randomUUID()}`;
let leased = false, page;
try {
  execFileSync('agent-browser', ['start', '--lease', lease]);
  leased = true;
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  page = await browser.contexts()[0].newPage();
  // Test using your own tab.
} finally {
  try {
    if (page) await page.close();
  } finally {
    if (leased) execFileSync('agent-browser', ['release', lease]);
  }
}
```

Open and close only your own tabs. Never call `browser.close()`, Playwright
`launch` or `launchPersistentContext` on this shared signed-in browser. Chrome
Beta starts with no window; `newPage()` opens your tab. Etan signs in by hand;
never automate sign-in or clone/export the cookies. Serialize computer-use
checks and use only **Google Chrome Beta**, never Helium.

The shared profile is `~/Library/Application Support/golems-agent-browser`
(0700), with `.leases.json` (0600), outside repos. CDP lets local processes read
signed-in cookies: bind **127.0.0.1 only**, never expose or forward 9333. The
launcher refuses foreign listeners/profiles and corrupt lease files. `stop`
refuses while live leases remain; release your own lease instead.

From any golems checkout, install once the reviewed source is in the installed
hooks-live pin (Git resolves the shared repository location, including worktrees):

```sh
golems_git_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
golems_repo="$(dirname "$golems_git_dir")"
ln -sfn "$golems_repo/.worktrees/hooks-live/scripts/agent-browser/agent-browser" "$HOME/.local/bin/agent-browser"
```

Do not change or repin hooks-live for this installation; its owner runs the
normal reviewed-pin update. Until then, run the reviewed script by its full path.
