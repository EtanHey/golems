# Golems

Golems is a Bun monorepo of reusable AI-agent packages, command-line tooling,
and evaluated workflow skills. It includes domain packages for recruiting,
finance, scheduling, jobs, content, and shared infrastructure, plus the
`golem-powers` skill library.

## Concepts

A **golem** is a domain-focused agent package: code, prompts, and integrations
that work together for a bounded job. A **skill** is a `SKILL.md` workflow that
an AI coding agent can load and follow. Skills may also ship scripts,
references, adapters, fixtures, and executable evals.

The repository currently contains 13 workspace package directories, 93
top-level `golem-powers` skill directories, and 122 `SKILL.md` entrypoints.
Those numbers are generated from the checked-out tree and may change as the
project evolves.

## Quick start

Requirements: [Bun](https://bun.sh/) and Git.

```bash
git clone https://github.com/EtanHey/golems.git
cd golems
bun install
bun test
```

Inspect or install a skill directly from the source checkout:

```bash
bun packages/golem-skills/src/index.ts skills list
bun packages/golem-skills/src/index.ts skills install <skill-name>
```

The setup CLI currently exposes a dependency/configuration check:

```bash
bun packages/golems-cli/src/index.ts setup --check
```

## Packages

| Package | Purpose |
|---|---|
| `packages/claude` | Telegram notification bot and orchestration adapters |
| `packages/coach` | Calendar, planning, and generic coaching primitives |
| `packages/content` | Content pipelines and Remotion infrastructure |
| `packages/golem-skills` | Skill installer and update CLI |
| `packages/golems-cli` | Environment setup CLI |
| `packages/golems-tui` | React Ink terminal interface |
| `packages/green-invoice-mcp` | Invoice MCP integration |
| `packages/jobs` | Job collection and matching |
| `packages/mock-mcp` | MCP test fixture package |
| `packages/recruiter` | Outreach and interview-practice workflows |
| `packages/services` | Briefing, scheduler, doctor, and local services |
| `packages/shared` | Shared state, LLM, email, and notification utilities |
| `packages/teller` | Finance and transaction categorization |

## Skill library and evals

Skills live under `skills/golem-powers/<skill-name>/`. The common shape is:

```text
skill-name/
├── SKILL.md
├── adapters/      # optional harness-specific guidance
├── references/    # optional supporting material
├── scripts/       # optional executable helpers
└── evals/         # optional fixtures and behavior checks
```

An eval demonstrates only the behavior asserted by that eval. It is regression
evidence, not a claim that a skill or agent is correct in every environment.

## Development

```bash
bun install
bun test
```

Package-specific instructions live in `packages/*/CLAUDE.md`. Contribution
guidance is in [CONTRIBUTING.md](CONTRIBUTING.md), and vulnerability reporting
is in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
