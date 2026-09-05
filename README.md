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

At commit `72d907ec` the tree has 13 workspace packages and 88 skills that
carry a top-level `SKILL.md` under `skills/golem-powers/`. That directory holds
95 entries; the other 7 are shared, archived, or workspace scaffolding rather
than installable skills. Run `node scripts/check-skill-library.mjs` to
re-derive the skill count instead of trusting this paragraph.

## Quick start

Requirements: [Bun](https://bun.sh/) and Git.

```bash
git clone https://github.com/EtanHey/golems.git
cd golems
bun install
bun test
```

List or install skills. Both commands read `skills/golem-powers/` from
`master` through the GitHub API, so they need network access and report what is
published rather than what is in your working tree:

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

## Launchers and CI gates

`scripts/repogolem/` installs `golem-dispatch.zsh`, a zsh function that starts a
coding-agent session in a chosen repo; `-E, --effort <low|medium|high|xhigh|max|ultra>`
sets the effort for a single dispatch. The launchers assume the author's own
machine layout, so read them as a reference rather than a supported product.

Pull requests and pushes to `master` run CodeQL, secret scanning, a dependency
audit, a publish-boundary guard, a `docs.local` guard, the Python skill suites
(`scripts/run-skill-tests.sh`), and the bats suites in `scripts/tests/`.
`bun test` is not one of those gates.

## Development

```bash
bun install
bun test
```

`bun test` runs 2130 tests across 158 files. At `72d907ec` it reports 2124
passing, 4 skipped, and 2 failing; both failures predate this checkout, so a
clean clone shows them too.

Eight of the 13 packages carry a `CLAUDE.md` with package-specific
instructions. Contribution guidance is in [CONTRIBUTING.md](CONTRIBUTING.md),
and vulnerability reporting is in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
