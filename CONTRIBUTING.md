# Contributing

Thanks for your interest in contributing!

## Development Workflow

1. **Fork the repo** and create a branch from the default branch
2. **Write tests first** when adding new functionality
3. **Run the test suite** before pushing (the repo-specific section below names the command)
4. **Keep commits focused** — one logical change per commit, conventional format (`feat:`, `fix:`, `docs:`)
5. **Open a PR** against the default branch

## Pull Request Process

1. Create a PR with a clear description of what and why, and fill in the PR template's checks
2. Six checks must pass on the PR's latest commit before it can merge: Publish Boundary Guard, Package test suite (bun), Python skill test suites, Check PR size label truth, Secret Scanning, and No new tracked docs.local. The other CI jobs run on every PR too; fix a red one before asking for review
3. Reviews are agent-assisted, and the maintainer merges. No review bot runs on this repo
4. PRs are merged with a merge commit (not squashed), so each commit stays traceable

## First-time Contributors

- **No CLA required**: your contributions are licensed under the repository's license by submitting them
- If someone invited you, or you agreed the approach in an issue first, add `Vouched-by: @username` to your PR description

## AI Contributions

This project uses AI coding tools extensively. When AI agents contribute code:

- Credit them with a `Co-Authored-By:` trailer. The maintainer's agents use `Co-Authored-By: <agent> running <model> <noreply@anthropic.com>`; your tool's standard trailer is fine
- AI-generated code goes through the same review process as human code
- No distinction in quality standards: all code must pass the required checks and review

## Reporting Issues

Open an issue from the [bug report or feature request form](https://github.com/EtanHey/golems/issues/new/choose): what you expected, what happened, steps to reproduce, and your environment (OS, runtime versions). Report security vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Report conduct problems through the private channel it names.

## License

By contributing, you agree that your contributions will be licensed under the license in this repository's `LICENSE` file.

## Golems specifics

Golems is open source under Apache 2.0.

### Getting Started

```bash
git clone https://github.com/EtanHey/golems.git
cd golems
bun install
```

### Tests

- Run `bun run test` before pushing. It is the package suite (`bun test ./packages`) that CI runs.
- CI runs the package suite, the Python skill suites, the script suites, and the blocking bats suites on every PR.
- Package tests live in `packages/<package>/src/__tests__/`: `src/foo.ts` is tested by `src/__tests__/foo.test.ts`.

### Code Style

- TypeScript for all new code
- No `any` types — use proper interfaces
- Use `@golems/shared` for Supabase, LLM, and notification utilities
