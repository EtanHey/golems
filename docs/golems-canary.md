# Golems plugin canary

Status: source-only experiment. Installation, refresh, and T3 acceptance are separate lead-run steps. This package moves no existing skills or guards.

Formats: [Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces) and [manifest](https://code.claude.com/docs/en/plugins-reference); [OpenAI plugin packaging and marketplace](https://developers.openai.com/plugins/build/plugins). The two catalogs point to one skill directory. The payload token is changed in that skill alone; manifest versions are deliberately omitted to test refresh behavior, not to assert that refresh will work.

## Lead-run installation, after publication and authorization

Run in the intended provider home on each machine. Record the marketplace commit, provider instance and home, installed cache path and skill hash. Do not copy or symlink the skill into another discovery root.

```sh
claude plugin marketplace add EtanHey/golems
claude plugin install golems-canary@golems
claude plugin enable golems-canary@golems
claude plugin list
claude plugin details golems-canary

codex plugin marketplace add EtanHey/golems
codex plugin add golems-canary@golems
```

For Codex, verify the plugin is installed and enabled with `codex plugin list --marketplace golems --available --json`. Verify the actual provider home and its overlays rather than assuming the CLI and T3 share a home.

In a fresh official T3 Claude session, verify the catalog lists `golems-canary:golems-canary`, invoke it explicitly, and capture the skill expansion and exact payload response. In a fresh official T3 Codex session, verify the catalog lists the skill, invoke it explicitly, and capture its actual skill file read and exact payload response. Record session identifiers and cache paths. Listing alone is not a pass.

## Update experiment

Publish a one-line payload token change. First start fresh sessions without an update and record the returned token and cached file hash, including stale results. Then run:

```sh
claude plugin marketplace update golems
claude plugin update golems-canary@golems
codex plugin marketplace upgrade golems
```

Start fresh sessions again and repeat the listing, invocation, cache-path and hash checks. Codex's marketplace upgrade refreshes the catalog; it does not by itself prove the installed cache refreshed. Record any additional native install/refresh step needed and its result. Do not call an unobserved automatic update a pass.

Stage 1 delivery passes only when the intended version is listed and invoked from the native plugin cache in both providers on both Macs. Record fresh-session and explicit-update results separately for each cell. M1 execution requires its separate authorization; the picker must show no unintended duplicates and hooks and guards must remain unaffected before stage 2.
