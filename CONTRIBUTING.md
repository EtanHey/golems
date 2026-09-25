# Contributing

Thanks for your interest in contributing!

## Development Workflow

1. **Fork the repo** and create a branch from the default branch
2. **Write tests first** when adding new functionality
3. **Run the test suite** before pushing (the repo-specific section below names the command)
4. **Keep commits focused** — one logical change per commit, conventional format (`feat:`, `fix:`, `docs:`)
5. **Open a PR** against the default branch

## Pull Request Process

1. Create a PR with a clear description of what and why
2. CI must pass on the PR's latest commit
3. **CodeRabbit** reviews every PR automatically:
   - Fix CRITICAL/HIGH issues before merge
   - MEDIUM issues are judgment calls
   - Style-only comments can be skipped with rationale
4. PRs are merged with a merge commit (not squashed), so each commit stays traceable

## Vouching Model

We use a **vouching system** for new contributors, inspired by the t3-oss community:

- **First PR?** An existing contributor or maintainer reviews and vouches for you
- **Vouched contributors** get faster review cycles on subsequent PRs
- **No CLA required** — your contributions are licensed under the repository's license by submitting them
- Add `Vouched-by: @username` to your PR description if someone invited you

## AI Contributions

This project uses AI coding tools extensively. When AI agents contribute code:

- Add `Co-Authored-By: <agent> <agent@example.com>` to commit messages
- AI-generated code goes through the same review process as human code
- No distinction in quality standards — all code must pass tests and review

## Reporting Issues

Open an issue with: what you expected, what happened, steps to reproduce, and your environment (OS, runtime versions).

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
