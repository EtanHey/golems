Codex 0.169 warning replay fixture

Derived from a helper provider stream from a recorded run. The event
order, item IDs, startup-warning wording and usage fields are retained. The
thread ID, config path, image path and entire image observation were replaced
with public synthetic values. No private screen content or spoken words remain.

The private helper exits 2 because it includes the warning in tool_calls;
provider exit 0, the warning and the valid response remain in its JSON receipt.
The CLI replay creates that receipt offline. It never launches Codex or a model.
