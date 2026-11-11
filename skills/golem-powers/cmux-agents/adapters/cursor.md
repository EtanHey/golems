# Cursor child adapter

T3 `delegate_task` with `target: {providerInstanceId: "cursor", model: "default"}` (Auto). Write one brief file per child; dispatch `Read and follow <absolute brief path>`. Each brief says `Report to <collab path>, not to the lead thread.` Never use a headless CLI, AutoCursor runner, or background Cursor loop. Never select a named Cursor model; `default` is the T3 Auto sentinel.

Cursor work is dispatched through T3, not a cmux Cursor launcher. See `/agent-routing` for discovery and lifecycle. Verify findings with git before acting: ignored files are not necessarily committed.

Cursor Bugbot is a separate GitHub bot; its policy remains in `/pr-loop`.

Trigger on PRs: `@cursor @bugbot review` (as PR comment)
- PR review bot (`@cursor @bugbot review`)

Apply `/pr-loop` eligibility before requesting Bugbot.
