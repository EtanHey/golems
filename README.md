# Golems

[![CI](https://github.com/EtanHey/golems/actions/workflows/golem-powers-skill-tests.yml/badge.svg?branch=master)](https://github.com/EtanHey/golems/actions/workflows/golem-powers-skill-tests.yml)
[![License: Apache-2.0](https://img.shields.io/github/license/EtanHey/golems)](LICENSE)

Golems is a Bun monorepo with two parts: a set of TypeScript agent packages, and
`golem-powers`, a library of `SKILL.md` workflows for AI coding agents. Many
skills ship executable evals.

It is for two kinds of reader. The first builds with AI coding agents (Claude
Code, Codex, Cursor) and wants skills and evals to reuse or copy. The second
wants to see how one developer runs a fleet of coding agents day to day.

This is one person's working setup, published in the open. Many
packages and skills assume the author's machine, accounts, and tools. Read them
as working examples, not as a supported product.

Two terms:

- A **golem** is a package that handles one domain (jobs, finance, planning).
  It holds the code, prompts, and integrations for that domain.
- A **skill** is a `SKILL.md` file that an agent loads and follows. It can come
  with scripts, references, and evals.

## Quick start

You need [Bun](https://bun.sh/), [Node.js](https://nodejs.org/), and Git. CI
reads its Bun version from `.bun-version`, so install that version locally too.
One test checks for the `claude` CLI on your `PATH`. CI stubs it, and you can
do the same.

```bash
git clone https://github.com/EtanHey/golems.git
cd golems && bun install
bun run test
```

`bun run test` runs `bun test ./packages`, the same package suite CI runs. Use
it instead of a bare `bun test`, which also picks up tests from any local
untracked folders.

## Packages

There are 11 workspace packages under `packages/`:

| Package | What it is |
|---|---|
| `claude` | Telegram bot and notification server |
| `coach` | Daily scheduling, calendar sync, habit tracking, briefings |
| `content` | Content pipelines (LinkedIn, ghostwriting) and Remotion video rendering |
| `golem-skills` | The CLI, published as `golems-cli`: installs and lists skills, checks setup |
| `golems-tui` | Terminal dashboard built on React Ink |
| `green-invoice-mcp` | MCP server for Green Invoice, an Israeli invoicing service |
| `mock-mcp` | Mock MCP server for testing agent skills |
| `recruiter` | Outreach drafting, interview practice, Elo-rated skill tracking |
| `services` | Morning briefing, scheduler worker, `doctor` health checks |
| `shared` | Supabase, LLM, email, state, and MCP helpers the other packages share |
| `teller` | Subscription tracking, payment categorization, spending reports, payment-failure alerts |

The package tests need no credentials; CI runs them with no secrets. Running
the domain packages for real is different: they call outside services
(Supabase, Telegram, calendar and job-board APIs) and read credentials from
the environment. Where a package
has its own `README.md` or `CLAUDE.md`, that file says what it needs.

## Skill library

Each skill lives in `skills/golem-powers/<skill-name>/`:

```text
skill-name/
├── SKILL.md       # the workflow the agent reads
├── adapters/      # optional: notes for a specific agent harness
├── references/    # optional: supporting material
├── scripts/       # optional: helpers the skill runs
└── evals/         # optional: fixtures and behavior checks
```

To count the skills, run the checker instead of trusting a number in a README:

```bash
node scripts/ci/check-skill-library.mjs   # prints skills=<n> and description-size totals
```

Some skills to start with:

- `pr-loop`: branch, commit, PR, review, and merge, with agent attribution on commits
- `never-fabricate`: read, run, and verify before claiming something is done
- `large-plan`: split a big change into phases for parallel agents
- `plan-council`: judges from several model families review a plan, or rank anonymized candidates
- `git-guardian`: a safety gate in front of force-push, reset, and branch deletes
- `tmp-block`: a hook that blocks durable writes to `/tmp`
- `skill-creator`: create, audit, and eval skills
- `unslop`: cut AI-sounding filler and keep the facts

An eval checks only the behavior it asserts. It is regression evidence. It
does not prove a skill works in every setup.

The Python skill suites and gate evals run with `bash scripts/ci/run-skill-tests.sh`.
You need `python3` with `pytest` installed.

## CLI

The CLI lives in `packages/golem-skills`. Run it from a clone:

```bash
bun packages/golem-skills/src/index.ts skills list      # skills on the default branch, via the GitHub API
bun packages/golem-skills/src/index.ts setup --check    # checks for bun, git, and claude
bun packages/golem-skills/src/index.ts skills install <skill-name>   # copies into ~/.claude/skills/
```

`skills list` and `skills install` read the published default branch over the
network. They do not read your working tree. The npm package `golems-cli` is
behind this repo, so for now run the CLI from source.

## repoGolem config

`scripts/repogolem/repogolem-config.ts` builds the per-repo agent launchers
(`<repo>Claude`, `<repo>Codex`, ...) from one YAML config. You keep that config
yourself. Golems ships only the generator, the schema
(`scripts/repogolem/config.schema.json`) and a placeholder example
(`scripts/repogolem/config.example.yaml`).

```bash
export REPOGOLEM_CONFIG=~/somewhere-private/repogolem.yaml
bun scripts/repogolem/repogolem-config.ts init       # starter config, with this Mac's machines: section
$EDITOR "$REPOGOLEM_CONFIG"                          # your projects, MCPs, op:// refs
bun scripts/repogolem/repogolem-config.ts generate   # resolve refs, write the launchers
bun scripts/repogolem/repogolem-config.ts generate --check   # exit 1 + the stale file if the config changed
```

- **One file, many machines.** `projects`, `mcpDefinitions` and `global` are
  shared. `machines.<LocalHostName>` sets `reposPath` (relative project paths
  join it), `clis` (the CLIs that machine has) and `overrides` (objects merge,
  lists replace, `null` drops a project). `generate` picks the section by
  `scutil --get LocalHostName`, or by `--host` / `REPOGOLEM_HOST`.
- **Secrets are op:// refs only.** The schema rejects a literal under
  `secrets:`. The config holds no values, so you can keep it in a private
  repo.
- **`generate` is the only step that resolves them.** It resolves every ref
  in one `op run` (one 1Password unlock) and writes
  `~/.config/repogolem/generated/{registry.json,launchers.zsh,secrets.env}`.
  Each file is stamped with the config's sha256. `--check` only reads these
  files and never calls `op`. `golem-dispatch.zsh` still resolves refs through
  Ralph's loader today. Moving it to read `secrets.env` is the next step, and
  after that an unattended spawn never waits on a prompt.

**The tradeoff: resolved values are on disk.** `secrets.env` holds them in
plain text, so an agent can start without an unlock prompt. The rule is that
secrets are never committed, not that they are never on disk. The guards:
files are `0600` and the directory `0700`; `generate` refuses an output
directory inside a git work tree, a symlink, or one owned by another user;
`--check` reports a loosened mode as stale; and no command prints a resolved
value, only counts and key paths. If you need values never to touch disk, do
not use `secrets:`. Read them with `op read` at launch instead.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md): workflow, commit format, test layout
- [SECURITY.md](SECURITY.md): report vulnerabilities privately
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Contributor Covenant

## License

Apache-2.0. See [LICENSE](LICENSE).
