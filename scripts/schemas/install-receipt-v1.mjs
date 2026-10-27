// Closed objects intentionally reject extra payloads (secrets, transcripts, memory content).
const text = { type: 'string', minLength: 1 };
const sha = { type: 'string', pattern: '^[0-9a-f]{40}$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const time = { type: 'string', format: 'utc-time' };
const component = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = items => ({ type: 'array', items });
export default {
  $schema: 'http://json-schema.org/draft-07/schema#', $id: 'install-receipt/v1',
  ...object({
    schema: { const: 'install-receipt/v1' },
    receipt_id: { type: 'string', pattern: '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }, written_at: time,
    writer: object({ agent: text, thread_or_session: text }, ['agent', 'thread_or_session']),
    host: object({ alias: { enum: ['m4-max', 'm1-pro', 'mbp', 'm1'] }, hostname: text, user: text }, ['alias', 'hostname', 'user']),
    product: component, artifact_kind: { enum: ['brew-formula', 'brew-cask', 'pypi', 'npm', 'source-checkout', 'skills-sync', 'hooks-sync'] },
    target: object({ version: component, tag: text, merge_sha: sha, released_sha: sha,
      ancestry: object({ method: { enum: ['gh-compare', 'git-merge-base'] },
        status: { enum: ['identical', 'ahead', 'behind', 'diverged'] }, checked_at: time }, ['method', 'status', 'checked_at']),
      release_asset: object({ name: text, sha256: digest }, ['name', 'sha256']),
      tap: object({ commit: sha, file: text, url: text, sha256: digest }, ['commit', 'file', 'url', 'sha256']) }, ['version', 'merge_sha', 'released_sha']),
    installed: object({ version: text, path: text, embedded_commit: sha, content_sha256: digest,
      lockfile_sha256: digest, signing_identity: text, install_finished_at: time }, ['version', 'path', 'install_finished_at']),
    install_source: object({ mode: { enum: ['release-channel', 'worktree-pin', 'checkout'] }, path: text, pin_sha: sha,
      roots: { ...array(object({ path: { type: 'string', pattern: '^/' }, tree_sha256: digest }, ['path', 'tree_sha256'])), minItems: 1 },
      root_commits: array(object({ path: { type: 'string', pattern: '^/' }, commits: array(sha), unresolved: { type: 'boolean' } }, ['path', 'commits', 'unresolved'])),
      excluded: array({ ...object({ path: { type: 'string', pattern: '^/' }, resolved_target: { type: 'string', pattern: '^/' }, kind: { enum: ['symlink', 'directory', 'file', 'vendor'] }, count: { type: 'integer', minimum: 1 } }, ['path', 'kind', 'count']),
        if: { properties: { kind: { const: 'vendor' } } }, then: { required: ['resolved_target'] } }),
      owner_status: object({ pin_sha: sha, command: text, exit: { type: 'integer' }, drift: { type: 'boolean' }, settings_drift: { type: 'boolean' } },
        ['command', 'exit', 'drift', 'settings_drift']) }, ['mode', 'path']),
    prior: object({ version: text, embedded_commit: sha }),
    activation: object({ method: { enum: ['launchctl-kickstart', 'app-relaunch', 'new-session', 'none'] },
      skill_parity: object({ command: text, exit: { type: 'integer' }, pass: { type: 'boolean' }, measurement: { enum: ['live', 'fixture'] } }, ['command', 'exit', 'pass', 'measurement']),
      processes: array(object({ pid: { type: 'integer', minimum: 1 }, path: text, started_at: time }, ['pid', 'path', 'started_at'])),
      self_report: object({ command: text, version: text, commit: sha }, ['command', 'version']),
      mcp_probe: object({ server: text, request: text, ok: { type: 'boolean' }, summary: text }, ['server', 'request', 'ok', 'summary']),
      seat_scan: {
        ...object({ method: { enum: ['t3-threads', 'list_agents', 'client-processes'] }, checked_at: time,
          active_seats: array(text),
          clients: array(object({ pid: { type: 'integer', minimum: 1 },
            started_at: { ...time, pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ$' },
            argv: { ...array(text), minItems: 1 }, argv_source: { enum: ['ps-split', 'procargs2'] },
            thread_id: { type: ['string', 'null'], minLength: 1 } }, ['pid', 'started_at', 'argv', 'argv_source', 'thread_id'])),
          excluded: array(object({ rule: { enum: ['socat-relay', 'daemon-process'] }, reason: text,
            count: { type: 'integer', minimum: 0 } }, ['rule', 'reason', 'count'])),
          bridge_diff: object({ from_tag: text, to_sha: sha, paths: array(text), changed: { type: 'boolean' } },
            ['from_tag', 'to_sha', 'paths', 'changed']),
        }, ['method', 'checked_at', 'active_seats']),
        allOf: [{ if: { properties: { method: { const: 'client-processes' } } },
          then: { required: ['clients', 'excluded', 'bridge_diff'] },
          else: { not: { anyOf: [{ required: ['clients'] }, { required: ['excluded'] }, { required: ['bridge_diff'] }] } } }],
      },
      reconnected_seats: array(text) }, ['method', 'processes']),
    verdict: { enum: ['LIVE', 'INSTALLED_NOT_ACTIVE', 'MISMATCH', 'FAILED'] }, reasons: array(text),
  }, ['schema', 'receipt_id', 'written_at', 'writer', 'host', 'product', 'artifact_kind', 'target', 'installed', 'activation', 'verdict', 'reasons']),
  allOf: [{ if: { properties: { artifact_kind: { not: { enum: ['skills-sync', 'hooks-sync'] } } } }, then: { properties: { target: { required: ['ancestry'] } } } },
    { if: { properties: { artifact_kind: { const: 'hooks-sync' } } }, then: { required: ['install_source'], properties: {
      product: { const: 'golems' }, installed: { required: ['embedded_commit'] },
      install_source: { required: ['pin_sha', 'owner_status'], properties: { mode: { const: 'worktree-pin' } } } } } },
    { if: { properties: { artifact_kind: { const: 'skills-sync' } } }, then: {
    properties: { product: { const: 'golems' }, installed: { required: ['embedded_commit', 'content_sha256'] },
      install_source: { required: ['roots', 'owner_status', 'excluded'], properties: { mode: { enum: ['checkout', 'release-channel'] } } } } } },
    { if: { properties: { artifact_kind: { enum: ['source-checkout', 'skills-sync'] } } }, then: { required: ['install_source'] } },
    { if: { required: ['install_source'], properties: { install_source: { properties: { mode: { const: 'worktree-pin' } } } } },
      then: { properties: { install_source: { required: ['pin_sha', 'owner_status'],
        properties: { owner_status: { required: ['pin_sha'] } } } } } }],
};
