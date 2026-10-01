# repoGolem varlock adapter

Copy `plugin.cjs` into private configuration and implement `fetchBatch`. Register
`secrets.backend: plugin:/absolute/path/to/plugin.cjs`. An installed npm package
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

Adapters must be CommonJS (`.cjs`): use `require('varlock/plugin-lib')` so the
loader supplies the active plugin context. Bundle third-party dependencies. Provider code is trusted operator code and
must emit no values or credential-bearing errors to logs or files. Use fake
providers derived from actual output formats, including failures, and canary
non-leak tests. Test source and scratch-HOME installed CLIs under Bun.

References: [varlock plugins](https://varlock.dev/guides/plugins/),
[upstream CONTRIBUTING](https://github.com/dmno-dev/varlock/blob/main/CONTRIBUTING.md).

A plugin executes as your OS user with full privileges during generation.
`secrets.backend` in private config is the trust boundary: select only trusted
code. Pin npm adapters to exact versions with a lockfile; optional
`secrets.pluginVersion` also checks the installed package version. Package
exports must stay inside their installed package directory. No Bun automatic
installation or varlock package download is allowed. 1Password credentials are
excluded for file/BYO backends. Those children receive only HOME, PATH, LANG,
USER, scratch TMPDIR and forced telemetry/debug controls; obtain provider
credentials explicitly inside your trusted adapter.
