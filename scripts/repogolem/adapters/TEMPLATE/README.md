# repoGolem varlock adapter

Copy `plugin.ts` into private configuration and implement `fetchBatch`. Register
`secrets.backend: plugin:/absolute/path/to/plugin.ts`. An installed npm package
may export `./plugin`; use `plugin:package-name`. Relative plugin paths resolve
from the private config directory. npm adapters must already be installed there
or in an ancestor; generate never downloads dependencies.

The default resolver is `repoGolemBatch`; `secrets.resolver` selects another
identifier with the same contract. Its one static base64-encoded UTF-8 JSON argument carries `refs`
and the named `values` declarations, never resolved values. Return a JSON string
containing all declared schema keys: the name for `varlock://NAME`, or
`REPOGOLEM_SECRET_<first 32 hex of sha256(ref)>` for an `op://` ref. Missing,
empty, unresolved, masked and NUL-bearing values fail before cache writes.

The worked 1Password implementation is
[`repogolem-1password-plugin.ts`](../../repogolem-1password-plugin.ts): it registers
through `varlock/plugin-lib`, returns a JSON bulk result, wraps the shipped
single-batch resolver, preserves child-only manual sessions, disables op debug
and caching, and never retries. Its root resolver additionally accepts an
`aliases` map for named values sourced from the same op batch.

Bundle third-party dependencies. Provider code is trusted operator code and
must emit no values or credential-bearing errors to logs or files. Use fake
providers derived from actual output formats, including failures, and canary
non-leak tests. Test source and scratch-HOME installed CLIs under Bun.

References: [varlock plugins](https://varlock.dev/guides/plugins/),
[upstream CONTRIBUTING](https://github.com/dmno-dev/varlock/blob/main/CONTRIBUTING.md).
