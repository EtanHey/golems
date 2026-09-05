# Profile Source Contract

`PROFILE SOURCE` is the private, user-supplied input for candidate facts. The
public skill ships only this contract; it never supplies a person's data or a
machine-specific default path.

## Configure It

Resolve the source in this order:

1. an explicit `PROFILE SOURCE: <path>` in the current request;
2. `CONFERENCE_RECRUITING_PROFILE_SOURCE` from the environment;
3. unset.

An explicit path wins. If it is invalid, do not silently fall back to the
environment variable. Expand `~`, resolve the result to an absolute path, and
require a readable regular YAML or JSON file. On unset, unreadable, or invalid:
stop before fit judgment or worker dispatch, name the failed check, and ask the
user for a valid source.

## Contract v1

```yaml
contract_version: 1

profile:
  positioning: "Full-stack engineer building developer tools"
  tenure_years: 3.5
  location: "Europe or remote"

artifacts:
  - path: "/absolute/path/to/full-stack-resume.pdf"
    headline: "Full Stack Engineer | Developer Tools & AI Infrastructure"
    fit:
      - full-stack
      - developer-tools

connectors:
  - name: "Example Connector"
    company: null
    status: unknown
    last_contacted: null

prohibited:
  - "Do not claim production experience with technologies used only in prototypes."

# Optional. Include both fields or omit the entire block.
generated_from:
  path: "/absolute/path/to/canonical-source.yaml"
  sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

Required validation:

- `contract_version` is exactly `1`.
- `profile.positioning` and `profile.location` are non-empty strings;
  `profile.tenure_years` is a non-negative number.
- `artifacts`, `connectors`, and `prohibited` are arrays. The first two may be
  empty, but every present record must validate completely.
- Each artifact has an absolute `path`, a non-empty `headline`, and a non-empty
  string array `fit`. Path existence is checked when that artifact is selected
  for a send, not when a source is used only for role ranking.
- Each connector has a non-empty `name`; `company` is a non-empty string or
  `null`; `status` is one of `unknown`, `active`, `reachable`, `stale`, or
  `none`; and `last_contacted` is an ISO `YYYY-MM-DD` date or `null`.
- Every `prohibited` entry is a non-empty string.
- If `generated_from` exists, both `path` and `sha256` are required. The path
  must be an absolute readable regular file, and `sha256` must be 64 lowercase
  hexadecimal characters matching that file's current SHA-256 digest. A missing
  source or mismatch is stale input and fails closed.

Unknown fields may be retained for a user's own tooling, but the skill must not
infer required facts from them or use them to bypass a failed required field.

## Runtime Rules

- Read the source before using BrainLayer or a handoff to make candidate claims.
- Quote worker-profile facts from the source with exact file-and-line provenance.
- Treat `connectors` as a relationship roster. `unknown` never means `unworked`;
  promote it only from current recorded evidence or user confirmation.
- Identify resume variants by `headline`, not by folder name. Before sending,
  verify the selected `artifacts[].path` is a readable regular file.
- Treat the profile source as an input snapshot. If it is generated, update the
  owning canonical workflow and regenerate it; do not hand-edit the export.

## Fresh-Machine Onboarding Check

1. Copy the example to any private path and replace every example value with
   truthful data. Empty `artifacts` or `connectors` arrays are valid when those
   capabilities are not yet configured.
2. Pass the absolute path as `PROFILE SOURCE: ...` or export
   `CONFERENCE_RECRUITING_PROFILE_SOURCE` once in the agent's environment.
3. Start a sweep. The agent must report that it read and validated contract v1
   before making a fit judgment.
4. Unset the argument and environment variable once. The expected result is a
   stop-and-ask message, not a guessed profile or a machine-specific path probe.

That unset check is intentional: fail-closed behavior is part of the public
contract, not a setup surprise.
