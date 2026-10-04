# Gemini context

Gemini workers gather research, frames, inventories and verification evidence.
Shared rules remain in `AGENTS.md`. The gatherer routes its tier through
`/agent-routing`; this template does not select a model.

Antigravity 1.2.14 reads global agents from
`~/.gemini/antigravity-cli/agents`. `mainAgent: true` enables `--agent gatherer`;
`subagent: false` keeps this a primary gatherer session. The launcher adds that
agent for `--worker` or inherited `GOLEM_ROLE=worker` when installed, and warns
while preserving the existing launch if it is missing. Leads use their existing
launch flow. Model defaults remain owned by the launcher's routing policy.

Gatherers delegate independent BrainLayer questions and claim checks to the
`brain-worker` subagent with `invoke_subagent`, at most four concurrently.
The parent also enables the native `manage_subagents` and `wait` components:
check its children, wait for their terminal results, then return the combined
receipt. These are in-session lifecycle tools; they do not grant MCP or panes.
An "awaiting" response without returned evidence is incomplete fan-out.

Live probes on agy 1.2.16 verified both components load, native waiting returns
a real BrainLayer result, and the parent retains zero MCP. The prior 1.2.14
stall was not consistently reproduced on 1.2.16; this is completion-path
hardening, not proof of an agy engine fix. Repeat the no-tool, fan-out and
recording-fake-server deny canaries on every CLI upgrade. Do not enable MCP
inheritance or add parent MCP servers to work around missing worker results.

The subagent uses the Flash tier for `gemini.gather.text` in model-roles and
returns compact, expanded source citations. It has no shell or file-write tools.
MCP inheritance and customization inheritance are disabled; its explicit
`mcpServers` list starts the packaged bridge at the absolute path
`/opt/homebrew/bin/brainlayer-mcp-stdio-bridge` and enables only `brain_search`,
`brain_recall`, and `brain_expand`. This avoids PATH shadowing by a hand-installed
shim or proxy. Install the packaged BrainLayer bridge at that path on each host
before using this subagent. The packaged bridge connects to BrainBar's MCP socket;
other inherited servers and future write tools are excluded.

Read-only enforcement depends on agy's `enabledTools` dispatcher filter.
BrainBar exposes 17 tools, including store, update, archive, supersede and backup.
Every agy upgrade must repeat the fake-server deny probe before this agent is used:
verify the unique probe name loads, require an exact no-tool palette canary, then
attempt writes only on a recording fake MCP server with no real-server access.
Never attempt a write against real BrainLayer to prove a denial.

Gatherer: no MCP or shell. MCP and customization inheritance are disabled so
workspace servers cannot grant it pane spawning or terminal control. Web research
uses `search_web` and `read_url_content`; BrainLayer questions go only through
the read-only `brain-worker`. It retains its scoped receipt tools.
Only the declared brain-worker may be invoked;
hidden built-in agents must fail the no-tool delegation probes before release.

Video-qa: shell + write, no MCP. Use `--agent video-qa` for /qa-video work that
needs local media commands, background output/status checks, and denser sampling
around unclear moments. Unlike the research gatherer, it can run its own shell
and write evidence under the brief's artifact directory; it cannot use workspace
MCP servers or cmux panes and has no subagent delegation.
On agy 1.2.14, `run_command` is the registered shell component; command-status
and input helpers are not separately registrable. Keep background job logs,
PID and exit-status files in the artifact directory and poll them with shell
commands or `view_file`.

On agy 1.2.14, `mcpServers` in agent frontmatter must be a **list**, unlike the
mapping in `mcp_config.json`. A mapping silently removes the custom agent from
discovery, and `--agent` can fall back to unrestricted defaults. Verify the named
agent appears in `agy agent` before probing it. `call_mcp_tool` is injected by MCP
configuration; it must never appear in the registry `tools` list. Stream-json
`init.tools` lists the registry, not the session's actual callable tool set.

The source gatherer declares `agents: [brain-worker]`. The installer renders this
to the host's absolute `~/.gemini/antigravity-cli/agents/brain-worker` directory,
containing `agent.md`. agy 1.2.14 does not resolve bare or home-relative agent
dependencies, and expects directories rather than Markdown file paths. Use the
installer instead of copying the source gatherer directly.

A lead persona belongs in `~/.claude/agents/<name>.md`, injected through the
registry's `projects.<project>.agentByCli.gemini` mapping. Other engines retain
the existing `agent` fallback. Workers never receive that lead context.

## Installer

Run `bash scripts/install-gemini-context.sh --host mbp` on the MBP, or use
`--host m1` on the M1. The host is a report label; it does not select an SSH
target. The installer uses `RALPH_REGISTRY_FILE`, then the generated repoGolem
registry, then the legacy Ralph registry. `--registry <file>` selects an explicit
resolved registry. It never generates a registry or resolves secrets.

The default prints a table without writing. `--check` also fails for ritual
patterns in global or repo context. `--apply` installs context and the global
gatherer, brain-worker and video-qa. `--check` and `--apply` are mutually exclusive. Global GEMINI.md is
only verified; a global ritual blocks apply.

To install only these agents after merge, use
`bash scripts/install-gemini-context.sh --host mbp --agents-only --apply`.
This skips repo GEMINI.md writes and retains the same backup/rollback contract.

Existing repo files identical to CLAUDE.md and at most 200 lines are treated as
stale copies. Larger copies and other existing content are conservatively marked
`REVIEW` and kept unless `--force-repo <registered-name>` is
supplied. Missing repos and symlinked repo context or parents get per-repo skip
rows. Registry aliases for one destination are deduplicated; a force on any
alias applies to that destination. Device boot descriptions, bootstrap paths,
reboot timers, and ordinary `brain_recall` mentions are not agent rituals.

Existing replacements are backed up under
`~/.golems/backups/gemini-md/<timestamp>/`; filenames include the repo or agent
name and a canonical destination-path hash, so case-insensitive names cannot
collide. Backups are created exclusively and verified byte-for-byte before any
replacement. Every target and backup directory is checked for writability;
all replacement and rollback files are staged before committing any target.
Each rename is atomic and writes use mode 0600. If a write or rename fails,
already-committed targets are restored from verified backups, newly created
files are removed, and the command exits non-zero with a result table. Backups
remain available; if rollback itself fails, its destination is explicitly
reported for manual restoration. To restore manually, copy the relevant backup
to its original destination.

For a private lead persona, supply `--lead-persona <source> --lead-agent <name>`.
This installs the separate persona and prints the required registry mapping;
the installer does not edit registry configuration. Apply on both Macs after
merge, then verify fresh Gemini worker sessions and their verbose agent/context
load logs. Source tests and dry-run tables do not establish live worker behavior.
