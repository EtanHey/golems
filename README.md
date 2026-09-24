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

At commit `3c568589` the tree has 13 workspace packages and 86 skills that
carry a top-level `SKILL.md` under `skills/golem-powers/`. That directory holds
93 entries; the other 7 are shared, archived, or workspace scaffolding rather
than installable skills. Run `node scripts/check-skill-library.mjs` to
re-derive the skill count instead of trusting this paragraph.

## Quick start

Requirements: [Bun](https://bun.sh/) and Git.

```bash
git clone https://github.com/EtanHey/golems.git
cd golems
bun install
bun run test
```

List or install skills. Both commands read `skills/golem-powers/` from
`master` through the GitHub API, so they need network access and report what is
published rather than what is in your working tree:

```bash
bun packages/golem-skills/src/index.ts skills list
bun packages/golem-skills/src/index.ts skills install <skill-name>
```

The same CLI checks the environment's dependencies (bun, git, claude):

```bash
bun packages/golem-skills/src/index.ts setup --check
```

Its package is `golems-cli`, and it installs two bin names for the same entry: `golems` and `golems-cli`.

## Packages

| Package | Purpose |
|---|---|
| `packages/claude` | Telegram notification bot and orchestration adapters |
| `packages/coach` | Calendar, planning, and generic coaching primitives |
| `packages/content` | Content pipelines and Remotion infrastructure |
| `packages/golem-skills` | The `golems` CLI (npm `golems-cli`): skills, update, wizard, setup check |
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

Pull requests and pushes to `master` run CodeQL, a dependency audit
(`bun audit`, failing at high severity), a publish-boundary guard, a
`docs.local` guard, the package test suite (`bun run test`), the Python skill
suites (`scripts/run-skill-tests.sh`), the bun/node/shell script suites listed
in the `script-tests` job, and the bats suites in `scripts/tests/`.
Secret scanning also runs but does not fail the build, and only 6 of the 23 bats
files are blocking; the rest of `scripts/tests/*.bats` runs as a non-blocking
report until that directory is green.

## Development

```bash
bun install
bun run test
```

`bun run test` runs the package suite (`bun test ./packages`), the same command
CI runs. Use it rather than a bare `bun test`, which also collects tests from
anything checked out under the gitignored `docs.local/`. On a clean clone at
`3c568589` with the pinned Bun (1.3.14) it runs 1290 tests across 109 files:
1288 pass, 2 skip, 0 fail.

Eight of the 13 packages carry a `CLAUDE.md` with package-specific
instructions. Contribution guidance is in [CONTRIBUTING.md](CONTRIBUTING.md),
and vulnerability reporting is in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
