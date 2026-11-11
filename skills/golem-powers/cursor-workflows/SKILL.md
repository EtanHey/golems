---
name: cursor-workflows
description: "Route Cursor gather/recon through T3 delegate_task children. Triggers: cursor-workflow, cursor gather, fan out Cursors."
---

# Cursor Workflows

T3 `delegate_task` with `target: {providerInstanceId: "cursor", model: "default"}` (Auto). Write one brief file per child; dispatch `Read and follow <absolute brief path>`. Each brief says `Report to <collab path>, not to the lead thread.` Never use a headless CLI, AutoCursor runner, or background Cursor loop. Never select a named Cursor model; `default` is the T3 Auto sentinel.

Call `orchestrator_capabilities` once before the first dispatch. If Cursor is unavailable, report that fact; do not fall back to shell fan-out. Follow the delegate's `next`; completion wakes the parent. Verify the child's report before relaying findings.

If your dispatch exhausts shared quota, report that dispatch as the cause, never the resulting error as an external finding.
