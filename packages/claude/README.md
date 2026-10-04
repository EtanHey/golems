# @golems/claude

ClaudeGolem persona and Claude CLI status plugin.

`SOUL.md` defines the ecosystem's casual, concise voice. The status command and
skill inspect active Claude CLI sessions and recent local event-log entries.
The package has no background service or listener to start.

- `SOUL.md`: shared persona guidance.
- `commands/status.md`: session and event-log status command.
- `skills/status/SKILL.md`: status workflow.
- `.claude-plugin/plugin.json`: plugin metadata.
- `src/soul.test.ts`: persona checks.

Run the persona checks with `bun test packages/claude/src/soul.test.ts` from
the workspace root.
