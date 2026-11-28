# Fan-out engines

No Cursor in the fleet. Never dispatch Cursor workers, gatherers, reviewers or Bugbot.
Historical Cursor timing evidence remains in [fan-out-head-to-head.md](fan-out-head-to-head.md), not as routing authority.

Use T3 `delegate_task` for independent child work, with one file-backed brief per child and normal role pins. The brief says `Report to <collab path>, not to the lead thread.`
Inside Claude, use its Workflow/Agent tools for independent work. Visible terminal fleets may use `/cmux-agents`; no task requires cmux. A coherent edit or dependent steps stay serial.

Read `/agent-routing` for routing, models, isolation, review and dispatch limits. Never hardcode file-derived numbers into async prompts; have the worker read the source. Do not duplicate a slow worker without evidence of a stall. Shared-quota exhaustion caused by a dispatch is reported as that dispatch's effect.
