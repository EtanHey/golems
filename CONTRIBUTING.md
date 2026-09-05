# Contributing to Golems

Thanks for your interest in contributing! Golems is open source under Apache 2.0.

## Getting Started

```bash
git clone https://github.com/EtanHey/golems.git
cd golems
bun install
```

## Development Workflow

1. **Fork the repo** and create a branch from `master`
2. **Write tests first** when adding new functionality
3. **Run tests** before pushing: `bun test`
4. **Keep commits focused** — one logical change per commit, conventional format (`feat:`, `fix:`, `docs:`)
5. **Open a PR** against `master`

## Pull Request Process

1. Create a PR with a clear description of what and why
2. The checks configured on that repo must pass. Read the PR's own checks list:
   the set of gates differs per repo and does not always include the full test
   suite
3. Automated reviewers are per-repo and not guaranteed. Where one is installed
   (CodeRabbit, for example), treat its output this way:
   - Fix CRITICAL/HIGH issues before merge
   - MEDIUM issues are judgment calls
   - Style-only comments can be skipped with rationale
4. PRs are squash-merged

## Vouching Model

We use a **vouching system** for new contributors, inspired by the t3-oss community:

- **First PR?** An existing contributor or maintainer reviews and vouches for you
- **Vouched contributors** get faster review cycles on subsequent PRs
- **No CLA required** — your contributions are licensed under Apache 2.0 by submitting them
- Add `Vouched-by: @username` to your PR description if someone invited you

## AI Contributions

This project uses AI coding tools extensively. When AI agents contribute code:

- Add `Co-Authored-By: <agent> <agent@example.com>` to commit messages
- AI-generated code goes through the same review process as human code
- No distinction in quality standards — all code must pass tests and review

## Code Style

- TypeScript for all new code
- No `any` types — use proper interfaces
- Tests live beside the code they cover, either as a sibling `foo.test.ts` or in
  a `__tests__/` directory — follow whichever the package already uses
- Use `@golems/shared` for Supabase, LLM, and notification utilities

## Reporting Issues

Open an issue with: what you expected, what happened, steps to reproduce, and your environment (OS, Bun version).

## License

By contributing, you agree that your contributions will be licensed under the Apache License, Version 2.0.
