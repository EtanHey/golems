# Shared docs.local publication guard

Golems is the source template. Copy `scripts/guard-no-docslocal.sh` and
`.github/workflows/docs-local-guard.yml` into another repository; adjust the
workflow's push branch to its default branch. Fetch full history (`fetch-depth: 0`).
Run the script locally to check the index, or with `--range <base>..<head>` to
also reject additions anywhere in that history, even if later deleted. PRs use
base/head SHAs; pushes use before/after SHAs. An empty, zero, missing, or
non-ancestor base scans all reachable history, including after a force push.
Malformed ranges, invalid heads, and non-repository invocations fail closed.
A `docs.local` component at any depth is private; similarly named components are allowed.

Existing `.docslocal-baseline` entries remain grandfathered in both modes.
When upgrading a copy, the guard also reports nested `*/docs.local/*` paths;
an old root-only baseline does not cover them. Review existing nested debt
explicitly before adopting the template.
For a new repository, start with no baseline and no tracked private paths.
Do not generate a baseline to approve new additions. NarrationLayer,
etanheyman.com, and VoiceLayer owners update their copies separately.
