---
name: agent-browser
description: "Agent web testing: attach to shared Chrome Beta over CDP. Never launch worker browsers or drive Helium."
---

# Agent browser

Use `agent-browser start|status|stop`. Start is idempotent. Chrome Beta runs
headed, launched with `open -g` to stay in the background, without automation
flags. Etan signs in by hand; workers never automate sign-in.

There is ONE shared instance and cookie jar, at
`~/Library/Application Support/golems-agent-browser` (0700), outside repos.
Before **every** CDP attach, run `agent-browser start` (idempotent; verifies
Chrome Beta ownership and 127.0.0.1). If it exits non-zero, **do not connect**.
Attach; never call Playwright `launch` or `launchPersistentContext`:

```js
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = await browser.contexts()[0].newPage();
try {
  // Test using your own tab.
} finally {
  await page.close();
}
// Never browser.close(): other workers share this browser.
```

Workers open and close only their OWN tabs: no new windows or instances.
Do not clone/export the shared session cookies. Serialize computer-use checks;
computer use is allowed ONLY on **Google Chrome Beta**, NEVER on Helium.
Respect Etan's permission for computer use. Use an API/CLI whenever it supplies
the data: DeepSource → `deepsource-issues`; GitHub → `gh`.

**CDP security:** any local process can read logged-in cookies through this port.
Bind **127.0.0.1 only**, keep the profile 0700, and never expose or forward 9333.
The launcher refuses foreign or non-loopback listeners and only stops the
verified Chrome Beta PID with this profile. Stop is a shared lifecycle action;
workers normally leave the instance running for each other.

Install once the reviewed source is in the installed hooks-live pin:

```sh
ln -sfn ~/Gits/golems/.worktrees/hooks-live/scripts/agent-browser/agent-browser ~/.local/bin/agent-browser
```

Do not change or repin hooks-live for this installation; its owner runs the
normal reviewed-pin update. Until then, run the reviewed script by its full path.
